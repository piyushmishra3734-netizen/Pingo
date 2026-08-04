import {
  messagePreview,
  useChat,
  type Conversation,
  type Message,
  type User,
} from '@pingo/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { useCall } from '../calls/CallProvider.js';
import { usePreferences } from '../settings/SettingsContext.js';
import {
  MESSAGE_TOAST_DURATION_MS,
  MESSAGE_TOAST_EXIT_MS,
  MESSAGE_TOAST_GAP_MS,
  MessageToast,
  type MessageToastData,
  type MessageToastMotion,
} from './MessageToast.js';
import { isQuietHoursActive } from './quiet-hours.js';
import {
  FRESH_THROTTLE,
  decide,
  playMessageSound,
  type ThrottleState,
} from '../../lib/audio/message-sounds.js';

/**
 * Floating in-app message banner for PINGO.
 *
 * ## One at a time (Instagram-style sequence)
 *
 * 1. Current slides **up** fully (exit animation)
 * 2. **500ms** empty gap
 * 3. Next slides **down**
 *
 * Never mounts the next banner while the previous is still on screen.
 * Same conversation while visible: update copy in place (no re-slide).
 * Different conversation while visible: start leave now, queue latest, then gap + enter.
 */

interface LiveToast extends MessageToastData {
  motion: MessageToastMotion;
}

export function MessageToastProvider({ children }: { children: ReactNode }) {
  const { service, ready, currentUser, users, conversations } = useChat();
  const { preferences } = usePreferences();
  const { call } = useCall();
  const navigate = useNavigate();
  const location = useLocation();

  const [active, setActive] = useState<LiveToast | undefined>();

  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Latest message waiting for the current banner to fully leave (+ gap). */
  const pendingRef = useRef<MessageToastData | undefined>(undefined);

  const usersRef = useRef(users);
  const conversationsRef = useRef(conversations);
  const currentUserRef = useRef(currentUser);
  const prefsRef = useRef(preferences.notifications);
  const locationRef = useRef(location.pathname);
  const callRef = useRef(call);
  const activeRef = useRef(active);
  /** Burst state for the arrival sound. Lives here because arrivals do. */
  const soundThrottle = useRef<ThrottleState>(FRESH_THROTTLE);

  usersRef.current = users;
  conversationsRef.current = conversations;
  currentUserRef.current = currentUser;
  prefsRef.current = preferences.notifications;
  locationRef.current = location.pathname;
  callRef.current = call;
  activeRef.current = active;

  const clearGapTimer = useCallback(() => {
    if (gapTimerRef.current !== undefined) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = undefined;
    }
  }, []);

  const showNext = useCallback((data: MessageToastData) => {
    // Never mount while a banner is still on screen (visible or mid-exit).
    if (activeRef.current) return;
    const live: LiveToast = { ...data, motion: 'enter' };
    activeRef.current = live;
    setActive(live);
  }, []);

  const scheduleNextAfterGap = useCallback(() => {
    // Already waiting to show the next - do not stack timers.
    if (gapTimerRef.current !== undefined) return;
    if (!pendingRef.current) return;

    // Read pending when the gap ends so a newer message during the pause still wins.
    gapTimerRef.current = setTimeout(() => {
      gapTimerRef.current = undefined;
      const next = pendingRef.current;
      pendingRef.current = undefined;
      if (next) showNext(next);
    }, MESSAGE_TOAST_GAP_MS);
  }, [showNext]);

  /**
   * Banner finished leaving (gesture or animation). Unmount and maybe show next.
   * Idempotent - toast transitionend + safety timer may both call this.
   */
  const clearActive = useCallback(
    (id: string) => {
      if (exitTimerRef.current !== undefined) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = undefined;
      }

      const current = activeRef.current;
      if (current && current.id === id) {
        activeRef.current = undefined;
        setActive(undefined);
      }

      // Only advance the queue when this banner is gone (or already gone).
      if (!current || current.id === id) {
        scheduleNextAfterGap();
      }
    },
    [scheduleNextAfterGap],
  );

  /** Parent-driven leave (new message queued, etc.) - toast plays continuous exit. */
  const beginExit = useCallback(
    (id: string) => {
      const current = activeRef.current;
      if (!current || current.id !== id) return;
      if (current.motion === 'exit') return;

      clearGapTimer();

      const leaving: LiveToast = { ...current, motion: 'exit' };
      activeRef.current = leaving;
      setActive(leaving);

      // Safety if the toast never reports transition end.
      if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = undefined;
        clearActive(id);
      }, MESSAGE_TOAST_EXIT_MS + 120);
    },
    [clearActive, clearGapTimer],
  );

  const present = useCallback(
    (data: MessageToastData) => {
      const current = activeRef.current;

      // Same conversation while fully visible: update copy, refresh timer, no re-slide.
      if (current && current.motion !== 'exit' && current.conversationId === data.conversationId) {
        const live: LiveToast = {
          ...current,
          ...data,
          id: current.id,
          unreadCount: Math.max(current.unreadCount + 1, data.unreadCount),
          motion: 'update',
        };
        activeRef.current = live;
        setActive(live);
        return;
      }

      // Merge into pending if it is the same conversation already queued.
      if (
        pendingRef.current &&
        pendingRef.current.conversationId === data.conversationId
      ) {
        pendingRef.current = {
          ...pendingRef.current,
          ...data,
          id: pendingRef.current.id,
          unreadCount: Math.max(pendingRef.current.unreadCount + 1, data.unreadCount),
        };
        return;
      }

      // Visible banner (not leaving): queue latest and start slide-up now.
      // The next toast must not mount until leave + gap finish.
      if (current && current.motion !== 'exit') {
        pendingRef.current = data;
        beginExit(current.id);
        return;
      }

      // Currently sliding out: only update who is next; do not interrupt leave.
      if (current && current.motion === 'exit') {
        pendingRef.current = data;
        return;
      }

      // Empty slot (and not mid-gap): slide down immediately.
      // If a gap timer is running, retarget pending and wait for it.
      if (gapTimerRef.current !== undefined) {
        pendingRef.current = data;
        return;
      }

      if (exitTimerRef.current !== undefined) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = undefined;
      }
      pendingRef.current = undefined;
      showNext(data);
    },
    [beginExit, showNext],
  );

  // Drop the banner when the user opens that conversation; show pending after leave.
  useEffect(() => {
    const openId = conversationIdFromPath(location.pathname);
    if (!openId) return;

    const current = activeRef.current;
    if (current && current.conversationId === openId && current.motion !== 'exit') {
      beginExit(current.id);
    }

    // Do not surface a toast for the chat they just opened.
    if (pendingRef.current?.conversationId === openId) {
      pendingRef.current = undefined;
    }
  }, [location.pathname, beginExit]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== undefined) clearTimeout(exitTimerRef.current);
      if (gapTimerRef.current !== undefined) clearTimeout(gapTimerRef.current);
      pendingRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const unsubscribe = service.subscribe((event) => {
      if (event.type !== 'message:new') return;
      const message = event.message;
      const me = currentUserRef.current;
      if (!me) return;

      if (message.authorId === me.id) return;
      if (message.system || message.deleted) return;

      const conversation =
        conversationsRef.current.find((c) => c.id === message.conversationId) ??
        undefined;

      const conv: Conversation = conversation ?? {
        id: message.conversationId,
        kind: 'direct',
        title: 'Message',
        participantIds: [message.authorId, me.id],
        unreadCount: 1,
        pinned: false,
        muted: false,
        favorite: false,
        archived: false,
        listIds: [],
        typingUserIds: [],
        updatedAt: message.createdAt,
      };

      /*
       * Sound and toast are gated together but not identically.
       *
       * Everything that silences a notification silences the sound — muted
       * chat, mute-all, quiet hours, a call in progress, the per-kind
       * preferences. The one condition they part on is having the conversation
       * already open: a toast there would cover the message you are reading,
       * while the sound is the whole point, because it is what tells you a reply
       * landed without looking away from the keyboard.
       */
      const gate = {
        message,
        conversation: conv,
        prefs: prefsRef.current,
        pathname: locationRef.current,
        inCall: Boolean(callRef.current),
      };

      if (shouldPlayMessageSound({ ...gate, open: isConversationOpen(locationRef.current, message) })) {
        const decision = decide(soundThrottle.current, Date.now());
        soundThrottle.current = decision.state;
        if (decision.play) playMessageSound('received', decision.gain);
      }

      if (!shouldShowMessageToast(gate)) return;

      const sender =
        usersRef.current.find((u) => u.id === message.authorId) ??
        syntheticSender(message.authorId, conv);

      present(buildToastData(message, conv, sender, me.id, usersRef.current));
    });

    return unsubscribe;
  }, [service, ready, present]);

  /**
   * Toast finished its open glide (tap / swipe-down). Navigate immediately;
   * the banner is already off-screen so we only clear state.
   */
  const onOpen = useCallback(
    (conversationId: string) => {
      if (pendingRef.current?.conversationId === conversationId) {
        pendingRef.current = undefined;
      }

      const current = activeRef.current;
      if (current && current.conversationId === conversationId) {
        if (exitTimerRef.current !== undefined) {
          clearTimeout(exitTimerRef.current);
          exitTimerRef.current = undefined;
        }
        activeRef.current = undefined;
        setActive(undefined);
      }

      navigate(`/chats/${conversationId}`);
      // Other chats may still be pending.
      scheduleNextAfterGap();
    },
    [navigate, scheduleNextAfterGap],
  );

  /** Toast finished its dismiss glide (swipe-up / auto). */
  const onDismiss = useCallback(
    (id: string) => {
      clearActive(id);
    },
    [clearActive],
  );

  return (
    <>
      {children}
      {active && (
        <Overlay>
          <div
            className="pointer-events-none fixed inset-x-0 z-[280] flex justify-center px-3"
            style={{
              top: 'calc(0.5rem + env(safe-area-inset-top, 0px))',
            }}
            aria-live="polite"
            aria-relevant="additions text"
            aria-atomic="true"
          >
            <div className="w-full max-w-[26rem] md:max-w-[28rem]">
              <MessageToast
                key={active.id}
                toast={active}
                motion={active.motion}
                onOpen={onOpen}
                onDismiss={onDismiss}
                durationMs={MESSAGE_TOAST_DURATION_MS}
              />
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function shouldShowMessageToast(args: {
  message: Message;
  conversation: Conversation;
  prefs: {
    messages: boolean;
    groups: boolean;
    muteAll: boolean;
    quietHours: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
  pathname: string;
  inCall: boolean;
}): boolean {
  const { message, conversation, prefs, pathname, inCall } = args;

  if (prefs.muteAll) return false;
  if (isQuietHoursActive(prefs)) return false;

  if (conversation.kind === 'direct' || conversation.kind === 'group') {
    if (conversation.kind === 'direct' && !prefs.messages) return false;
    if (conversation.kind === 'group' && !prefs.groups) return false;
  } else if (conversation.kind === 'community') {
    if (!prefs.groups) return false;
  }

  if (conversation.muted) return false;
  if (conversationIdFromPath(pathname) === message.conversationId) return false;
  if (inCall) return false;
  if (hasBlockingOverlay()) return false;

  return true;
}

function hasBlockingOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[aria-modal="true"]')) return true;
  return false;
}

/** Is the thread this message belongs to the one on screen? */
function isConversationOpen(pathname: string, message: Message): boolean {
  return conversationIdFromPath(pathname) === message.conversationId;
}

/**
 * Whether this arrival should make a sound.
 *
 * Deliberately built on the toast gate rather than beside it, so there is one
 * definition of "this account is muted" and no way for the two to drift into
 * disagreeing about it. The single difference is stated where it is made: an
 * open conversation suppresses the toast and keeps the sound.
 */
function shouldPlayMessageSound(args: Parameters<typeof shouldShowMessageToast>[0] & { open: boolean }): boolean {
  if (args.open) {
    return shouldShowMessageToast({ ...args, pathname: "/" });
  }
  return shouldShowMessageToast(args);
}

function conversationIdFromPath(pathname: string): string | undefined {
  const match = /^\/chats\/([^/]+)$/.exec(pathname);
  if (!match) return undefined;
  const id = match[1];
  if (id === 'new' || id === 'new-group') return undefined;
  return id;
}

// ---------------------------------------------------------------------------
// Toast assembly
// ---------------------------------------------------------------------------

function buildToastData(
  message: Message,
  conversation: Conversation,
  sender: User,
  currentUserId: string,
  users: User[],
): MessageToastData {
  const firstName = sender.name.split(' ')[0] || sender.name;
  const title =
    conversation.kind === 'direct'
      ? sender.name
      : `${firstName} · ${conversation.title}`;

  const preview = messagePreview(message, {
    conversation: { ...conversation, kind: 'direct' },
    currentUserId,
    users,
  });

  return {
    id: conversation.id,
    conversationId: conversation.id,
    title,
    preview,
    createdAt: message.createdAt,
    senderName: sender.name,
    senderId: sender.id,
    senderAvatarUrl: sender.avatarUrl,
    unreadCount: Math.max(1, conversation.unreadCount || 1),
    generation: message.createdAt,
  };
}

function syntheticSender(authorId: string, conversation: Conversation): User {
  return {
    id: authorId,
    name: conversation.kind === 'direct' ? conversation.title : 'Someone',
    handle: '',
    avatarUrl: conversation.kind === 'direct' ? conversation.avatarUrl : undefined,
    presence: { state: 'offline', lastSeenAt: 0 },
  };
}
