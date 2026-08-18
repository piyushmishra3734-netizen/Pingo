import {
  formatDayDivider,
  formatPresence,
  formatTime,
  formatTypingLabel,
  useChat,
  useMessages,
  type CallKind,
  type Conversation,
  type Message,
  type VideoEdit,
} from '@pingo/core';
import {
  Avatar,
  AvatarStack,
  CheckIcon,
  ChevronLeftIcon,
  IconButton,
  ImageIcon,
  LoadingState,
  MoreIcon,
  PhoneIcon,
  PingoDot,
  VideoIcon,
  cn,
} from '@pingo/ui';
import { CloseIcon } from '@pingo/ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useSharedElement } from '../../hooks/useSharedElement.js';
import { primeMessageSounds } from '../../lib/audio/message-sounds.js';
import { OLDER_THRESHOLD, shouldLoadOlder } from '../../lib/egress-rules.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { PINGO_AI_USER_ID } from '../ai/ai-mentions.js';
import { AiOnboardingSheet } from '../ai/AiOnboardingSheet.js';
import { AiPrivacyNotice } from '../ai/AiPrivacyNotice.js';
import { AiProfileSheet } from '../ai/AiProfileSheet.js';
import { VoiceCall } from '../ai/VoiceCall.js';
import { useCall } from '../calls/CallProvider.js';
import { useMutuals } from '../profile/useMutuals.js';
import { MessageMenu } from './context-menu/MessageMenu.js';
import { ReactionPills } from './context-menu/ReactionPills.js';
import { Composer, type MentionOption } from './Composer.js';
import { EncryptionNotice } from './EncryptionNotice.js';
import { GroupInfoSheet } from './GroupInfoSheet.js';
import { ConversationMenu } from './ConversationMenu.js';
import { mediaTooLarge, type MediaKind } from '@pingo/core';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { MessageBubble, quoteText } from './MessageBubble.js';
import { MessageSelectionBar } from './MessageSelectionBar.js';
import { startRain } from './rain.js';
import { startRainSound } from './rain-sound.js';
import {
  chosenWallpaperId,
  customWallpaperPhoto,
  hydrateWallpaper,
  onWallpaperChange,
  rainScene,
  wallpaperCss,
  wallpaperIsDark,
  wallpaperIsLive,
  type WallpaperScope,
} from './wallpaper.js';
import { ContactSheet, EventSheet, LocationSheet } from './AttachSheets.js';
import { useBackStep } from '../navigation/useBackStep.js';
import { NewMessagesDivider } from './NewMessagesDivider.js';
import { PhotoComposer } from './PhotoComposer.js';
import { probeKind, retypedAsAudio, type PickedKind } from './picked-media.js';
import { SwipeableMessage } from './SwipeableMessage.js';
import { ThreadJumpChip } from './ThreadJumpChip.js';
import { ThreadSearchBar } from './ThreadSearchBar.js';
import { SharedMediaSheet } from './SharedMediaSheet.js';
import { DisappearingSheet } from './DisappearingSheet.js';
import { VideoTrimSheet } from './VideoTrimSheet.js';

/**
 * An open conversation: header, scrolling thread, composer.
 *
 * Layout is a three-part column with a single scroll region in the middle, so the
 * header and composer stay fixed while messages move. This is what lets the
 * composer sit against the keyboard on a phone without JavaScript measuring
 * anything.
 *
 * Autoscroll is intentionally conditional: it follows new messages only when the
 * user is already near the bottom. Yanking someone away from history they are
 * reading to show them a new arrival is one of the rudest things a chat app can
 * do.
 */

export interface ChatThreadProps {
  conversation: Conversation;
  /** Renders the back button. Off in the desktop two-pane layout. */
  showBack?: boolean;
  className?: string;
}

/** How close to the bottom counts as "following the conversation", in px. */
const FOLLOW_THRESHOLD = 120;


/**
 * After jumping to the first unread, keep the divider visible this long so the
 * eye can register the boundary before it fades.
 */
const DIVIDER_HOLD_MS = 600;

/**
 * A microphone that breathes, for "recording a voice note".
 *
 * Deliberately not the typing dots. Dots mean words are on the way; this is a
 * different promise, and a receiver who reads it as text will keep waiting for
 * text. The pulse is CSS rather than a timer so it costs nothing and stops with
 * the element.
 *
 * `motion-reduce` drops the animation and leaves the icon, because the
 * information is the microphone, not the movement.
 */
/**
 * @param size in pixels. Small beside the name in the header, larger where it
 * stands alone in the thread - with no bubble and no words around it, the mark
 * has to carry the meaning by itself, and at 12px it reads as a speck.
 */
/**
 * What the assistant is doing right now, in one line that changes as it does.
 *
 * Answering is the longest thing PINGO does on somebody's behalf - seconds, not
 * the instant before a sentence lands - and the typing dots spend all of it
 * promising words. This says the true thing instead, in a shape nobody has to
 * learn: a mark, and a sweep of light crossing the words the way every loading
 * state on the web has for a decade.
 *
 * The words come from the server as each stage is reached, so the line is a
 * report and not a story told by a timer here.
 *
 * The sweep is the one place a shimmer is right. `Skeleton` deliberately
 * refuses one because it cannot know about progress; here the wait is real,
 * bounded and already under way, and movement is what separates "working" from
 * "stuck".
 *
 * `motion-reduce` drops the sweep and leaves the words, because the
 * information is the sentence, not the light.
 */
/**
 * What each stage is called, in words somebody waiting would use.
 *
 * Plain and present tense. "Invoking inference endpoint" is the app admiring
 * its own plumbing; "thinking" is what a person wants to know. 'reconsidering'
 * earns its place - it is a second complete model call, two thirds of a slow
 * turn, and without a name for it the wait looks like nothing happening.
 */
const AI_STAGES = {
  remembering: 'saving that for later',
  reading: 'catching up on our chat',
  thinking: 'thinking',
  reconsidering: 'thinking that through again',
  reading_reply: 'reading it back',
  polishing: 'tidying that up',
  drawing: 'drawing your picture',
  uploading: 'sending it over',
  writing: 'writing',
} as const;

function AiActivity({ label = 'drawing your picture' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <ImageIcon size={16} className="shrink-0 text-brand" aria-hidden />
      <span
        className={cn(
          'bg-clip-text text-transparent',
          'bg-[linear-gradient(100deg,var(--color-text-secondary)_35%,var(--color-brand)_50%,var(--color-text-secondary)_65%)]',
          'bg-[length:220%_100%] animate-ai-sweep',
          'motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-text-secondary',
        )}
      >
        {label}
      </span>
      {/*
        The visible words are already the whole message, so this only adds who
        is doing it - a screen reader meets "thinking…" with no idea whose.
      */}
      <span className="sr-only">PINGO is {label}.</span>
    </span>
  );
}

function RecordingPulse({ size = 12 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex items-center justify-center text-brand"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inline-flex animate-mic-breath rounded-full bg-brand/40 motion-reduce:hidden"
        style={{ width: size, height: size }}
      />
      <svg
        viewBox="0 0 24 24"
        className="relative animate-mic-settle motion-reduce:animate-none"
        style={{ width: size, height: size }}
        fill="currentColor"
      >
        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
        <path d="M18 11a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.94V22h2v-3.06A8 8 0 0 0 20 11h-2Z" />
      </svg>
    </span>
  );
}

export function ChatThread({
  conversation,
  showBack = false,
  className,
}: ChatThreadProps) {
  const { currentUser, users, service } = useChat();
  const confirm = useConfirm();

  /**
   * Refuses a file that is too large, out loud.
   *
   * Said before the upload starts rather than after it fails, and it names the
   * limit and the file's own size - "too large" with neither is a dead end. The
   * service checks again before uploading, because not every path into it comes
   * through this screen; this is the one that can explain itself.
   */
  const refuseIfTooLarge = async (file: File, kind: MediaKind): Promise<boolean> => {
    const complaint = mediaTooLarge(file.size, kind);
    if (!complaint) return false;
    await confirm({
      title: 'That file is too large',
      description: complaint,
      confirmLabel: 'OK',
    });
    return true;
  };
  const {
    messages,
    receipts,
    groups,
    loading,
    loadingOlder,
    hasOlder,
    loadOlder,
    send,
    sendSticker,
  } = useMessages(conversation.id);
  const { startCall, startGroupCall, joinGroupCall, call: activeCall } = useCall();
  const navigate = useNavigate();
  const galleryRef = useRef<HTMLInputElement>(null);
  /** Pictures chosen but not yet sent - the composer owns them until then. */
  const [pending, setPending] = useState<File[]>();
  /** One chosen video, held while the sender decides where it starts and ends. */
  const [trimming, setTrimming] = useState<File>();
  const documentRef = useRef<HTMLInputElement>(null);
  /** Which of the three small attach sheets is open, if any. */
  const [sheet, setSheet] = useState<'location' | 'contact' | 'event'>();
  const mutuals = useMutuals();

  /**
   * What the next send answers, if anything.
   *
   * Held here rather than in the composer because Reply is chosen from a menu
   * over the thread, and the composer would otherwise need to be told about a
   * gesture that happens nowhere near it.
   */
  const [replyTo, setReplyTo] = useState<Message>();

  /**
   * Ask again, with the message that produced this answer.
   *
   * The prompt is the last thing a person said before the assistant spoke, so
   * that is what is searched for - walking back past the assistant's own
   * bubbles, since one turn can produce several. Nothing happens when there is
   * nothing to re-ask, which is the opening greeting and only that.
   */
  const regenerate = useCallback(
    (reply: Message) => {
      const index = messages.findIndex((m) => m.id === reply.id);
      if (index < 0) return;
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = messages[i]!;
        if (candidate.authorId === PINGO_AI_USER_ID) continue;
        const body = candidate.body.trim();
        if (body) void service.regenerateAiReply?.(conversation.id, body).catch(() => undefined);
        return;
      }
    },
    [messages, service, conversation.id],
  );

  /**
   * Message ids picked out, or undefined when the thread is being read normally.
   *
   * Undefined rather than an empty set, so "am I selecting?" and "have I picked
   * anything?" stay separate questions - a selection you have emptied is still
   * a selection, and dropping out of the mode the moment the last message is
   * unticked would take the header away mid-decision.
   */
  const [selection, setSelection] = useState<Set<string> | undefined>();

  /** Whether the header is currently a search over this thread. */
  const [searching, setSearching] = useState(false);

  /** Whether the media/docs/links sheet is open over the thread. */
  const [sharedMedia, setSharedMedia] = useState(false);

  /** Whether the disappearing-messages timer is being changed. */
  const [disappearing, setDisappearing] = useState(false);

  const toggleSelected = (id: string) =>
    setSelection((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Leaving the thread, or the conversation changing underneath it, ends the
  // selection - ids from one conversation mean nothing in another.
  useEffect(() => {
    setSelection(undefined);
    setSearching(false);
    setSharedMedia(false);
    setDisappearing(false);
  }, [conversation.id]);

  /*
   * Selecting messages is a mode the thread is in, and replying is a state the
   * composer is in. Back leaves the innermost of them rather than the
   * conversation - the same thing their own × does, and what Back does in
   * every other app that has a selection mode.
   */
  useBackStep(selection !== undefined, () => setSelection(undefined));
  useBackStep(searching, () => setSearching(false));
  useBackStep(replyTo !== undefined, () => setReplyTo(undefined));

  /**
   * The wallpaper, and a repaint when it is changed elsewhere.
   *
   * Scoped to this conversation: DMs/AI read localStorage (and IndexedDB for
   * photos); groups/communities read the shared fields on the conversation so
   * one member's pick repaints every open client via realtime.
   */
  const wallpaperScope = useMemo((): WallpaperScope => {
    const shared =
      conversation.kind === 'group' || conversation.kind === 'community';
    return {
      conversationId: conversation.id,
      shared,
      ...(conversation.wallpaperId ? { serverWallpaperId: conversation.wallpaperId } : {}),
      ...(conversation.wallpaperPhotoUrl
        ? { serverWallpaperPhotoUrl: conversation.wallpaperPhotoUrl }
        : {}),
    };
  }, [
    conversation.id,
    conversation.kind,
    conversation.wallpaperId,
    conversation.wallpaperPhotoUrl,
  ]);

  const [wallpaperTick, setWallpaperTick] = useState(0);
  useEffect(() => {
    // Groups: also pull the shared photo into IndexedDB so GIF display matches DMs
    // (blob URL of original bytes, not a frozen CSS/server still).
    hydrateWallpaper(
      conversation.id,
      conversation.kind === 'group' || conversation.kind === 'community'
        ? conversation.wallpaperPhotoUrl
        : undefined,
    );
    return onWallpaperChange((changedId) => {
      if (!changedId || changedId === conversation.id) {
        setWallpaperTick((n) => n + 1);
      }
    });
  }, [conversation.id, conversation.kind, conversation.wallpaperPhotoUrl]);

  const wallpaper = useMemo(() => {
    const id = chosenWallpaperId(wallpaperScope);
    const photo = id === 'custom' ? customWallpaperPhoto(wallpaperScope) : undefined;
    return {
      css: wallpaperCss(wallpaperScope),
      /** Custom photo URL for an <img> layer (GIF-safe). Absent on presets. */
      photo,
      dark: wallpaperIsDark(wallpaperScope),
      live: wallpaperIsLive(wallpaperScope),
      scene: rainScene(wallpaperScope),
    };
  }, [wallpaperTick, wallpaperScope]);

  /*
   * The rain, when it is raining.
   *
   * Its own canvas behind everything, started and stopped with the choice. The
   * effect owns its frame loop and stops itself when the tab is hidden or the
   * thread scrolls out of view - see `rain.ts` - so there is nothing to
   * coordinate here beyond handing it a canvas and taking it away again.
   */
  const rainRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!wallpaper.live || !rainRef.current) return;
    const handle = startRain(rainRef.current, { image: wallpaper.scene });
    // The sound belongs to the same lifetime: it starts with the rain and it
    // stops when you leave the conversation, not when you leave the app.
    const sound = startRainSound();
    return () => {
      handle.stop();
      sound.stop();
    };
  }, [wallpaper.live, wallpaper.scene, wallpaperTick]);

  /*
   * The avatar that was pressed, arriving.
   *
   * The header's own avatar is transformed back to where the row's was and the
   * transform animated away, so there is one avatar rather than a clone flying
   * over everything. Silent when nothing was pressed - a thread opened from a
   * notification or a reload has nothing to travel from.
   */
  const headerAvatar = useRef<HTMLSpanElement>(null);
  /*
   * The ref goes on a wrapper rather than on `Avatar` itself, which is not a
   * forwardRef - and making it one to satisfy a navigation transition would
   * push a concern about routing down into a primitive that has nothing to do
   * with it.
   */
  useSharedElement(headerAvatar, `chat-avatar:${conversation.id}`);

  /** Group info: the roster, the roles and the invite link. */
  const [groupInfo, setGroupInfo] = useState(false);

  // Cleared when the thread changes: a reply aimed at another conversation
  // would attach to whatever is open now.
  useEffect(() => setReplyTo(undefined), [conversation.id]);

  /*
   * Open the audio path on the first touch anywhere in the thread.
   *
   * A browser starts an `AudioContext` suspended until a gesture, and the first
   * use after that costs a few milliseconds of device setup. Spending it here
   * means the first message is not the one that sounds late — which is the one
   * an impression is formed on. Once is enough, so it removes itself.
   */
  useEffect(() => {
    const prime = () => primeMessageSounds();
    window.addEventListener('pointerdown', prime, { once: true, passive: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  // Reset jump / new-message session when switching threads.
  useEffect(() => {
    setAwayFromBottom(false);
    setNewSession(undefined);
    setDividerAtId(undefined);
    lastTrackedNewestRef.current = undefined;
    followingRef.current = true;
    if (dividerHoldTimer.current !== undefined) {
      window.clearTimeout(dividerHoldTimer.current);
      dividerHoldTimer.current = undefined;
    }
  }, [conversation.id]);

  useEffect(() => {
    return () => {
      if (dividerHoldTimer.current !== undefined) {
        window.clearTimeout(dividerHoldTimer.current);
      }
    };
  }, []);

  /** Resolves a quoted message against the loaded page. */
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const nameOf = (userId: string) =>
    userId === currentUser?.id ? 'You' : users.find((u) => u.id === userId)?.name;

  const personOf = (userId: string) => users.find((u) => u.id === userId);

  const prefersReducedMotion = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  /** Scrolls the original into view and marks it, for a beat. */
  const jumpTo = useCallback(
    (messageId: string) => {
      const target = document.getElementById(`message-${messageId}`);
      if (!target) return;
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
      // A flash rather than a lasting highlight: it answers "which one" and then
      // gets out of the way.
      if (!prefersReducedMotion()) {
        target.animate(
          [{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }],
          { duration: 600, easing: 'ease-in-out' },
        );
      }
    },
    [prefersReducedMotion],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Whether the user was at the bottom *before* this render's new content. */
  const followingRef = useRef(true);
  /** React state mirror of followingRef so the jump chip can re-render. */
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  /**
   * New-messages session: one pin, one count, while the reader is away.
   * Cleared at the bottom or after jump-to-unread (divider may linger briefly).
   */
  const [newSession, setNewSession] = useState<
    { firstId: string; count: number } | undefined
  >();
  /** Message id that currently hosts the in-thread "New Messages" divider. */
  const [dividerAtId, setDividerAtId] = useState<string | undefined>();
  const lastTrackedNewestRef = useRef<string | undefined>(undefined);
  const dividerHoldTimer = useRef<number | undefined>(undefined);

  const partner =
    conversation.kind === 'direct'
      ? users.find(
          (u) => conversation.participantIds.includes(u.id) && u.id !== currentUser?.id,
        )
      : undefined;

  /**
   * PINGO AI is a person-shaped thread: no calls, no E2EE lock line, settings
   * instead of a profile. Everything else reuses the same chat chrome.
   */
  const isAi = conversation.kind === 'ai';
  const [aiOnboarding, setAiOnboarding] = useState(false);
  const [aiProfileOpen, setAiProfileOpen] = useState(false);

  useEffect(() => {
    if (!isAi || !currentUser) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await getSupabaseClient()
          .from('ai_profiles')
          .select('onboarded_at')
          .eq('user_id', currentUser.id)
          .maybeSingle();
        // Missing table / offline: skip the sheet rather than block chat.
        if (cancelled || error) return;
        if (!data?.onboarded_at) setAiOnboarding(true);
      } catch {
        /* offline / not configured */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAi, currentUser?.id, conversation.id]);

  /*
   * A direct call needs a mutual follow; a group call does not.
   *
   * `mutuals` is undefined while loading, so the buttons are not briefly
   * disabled on first render - a control that flickers to disabled reads as
   * broken rather than as loading.
   *
   * The rule for a direct call is that a stranger must not be able to make your
   * phone ring. Being in a group is already the answer to that: you were either
   * added by a friend or you walked in through a link, and either way you
   * agreed to be in the room. Requiring friendship *inside* the room would mean
   * a group of six where four people can be called and two cannot, which is not
   * a privacy rule - it is a broken button.
   *
   * AI has no ringing - the call buttons are omitted entirely, not greyed out.
   */
  const isGroup = conversation.kind !== 'direct' && !isAi;
  const [voiceCall, setVoiceCall] = useState(false);

  /*
   * The current messages, readable from inside an async loop.
   *
   * `askByVoice` waits for a reply that arrives after it started, and a closure
   * over `messages` would be looking at the list as it was when the turn began -
   * which never contains the answer.
   */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /**
   * A spoken turn, sent the way a typed one is.
   *
   * The transcript goes through `sendMessage`, so it lands in the thread, gets
   * the same model routing, the same memory and the same filters - and the
   * conversation is still there afterwards to scroll back through. A separate
   * path for voice would be a second assistant to keep in step with the first.
   *
   * The reply is then waited for rather than returned, because the send does
   * not carry one: the answer arrives as a message like any other. Polling the
   * rendered list is the honest way to see it - that is the same list the
   * person would be reading.
   */
  const askByVoice = useCallback(
    async (spoken: string): Promise<string | undefined> => {
      const before = Date.now();
      await service.sendMessage({ conversationId: conversation.id, body: spoken });

      // Generous, because a heavy question routes to the 120B and can take a
      // retry on top. Giving up early would look like PINGO ignoring them.
      const deadline = before + 60_000;
      while (Date.now() < deadline) {
        const reply = messagesRef.current.find(
          (m) => m.authorId === PINGO_AI_USER_ID && m.createdAt >= before && m.body.trim(),
        );
        if (reply) return reply.body;
        await new Promise((r) => setTimeout(r, 400));
      }
      return undefined;
    },
    [service, conversation.id],
  );

  const canCall = isAi
    ? true
    : isGroup
      ? conversation.participantIds.length > 1
      : Boolean(partner && mutuals?.has(partner.id));

  /**
   * Why calling is unavailable, in a sentence. Undefined when it is available.
   *
   * The rule itself is not new, calls have always needed a mutual follow, but
   * it was expressed only as a greyed-out icon, which reads as the feature
   * being broken rather than as a condition the user can do something about.
   */
  const callBlockedReason = canCall
    ? undefined
    : isGroup
      ? 'There is nobody else in this group yet.'
      : mutuals === undefined
        ? 'Checking whether you can call…'
        : `You and ${partner?.name ?? 'they'} need to follow each other before you can call.`;

  /** Shown when someone presses a call button that cannot do anything. */
  const [callNotice, setCallNotice] = useState<string>();

  /**
   * Places the call this thread is for - one person, or the whole room.
   *
   * One function rather than a ternary at each of the three call sites, because
   * the three sites are the voice button, the video button and the menu, and
   * they must never disagree about what "call" means here.
   */
  const placeCall = (kind: CallKind) => {
    if (!canCall) {
      setCallNotice(callBlockedReason);
      return;
    }

    if (isGroup) {
      void startGroupCall(
        conversation.id,
        conversation.title,
        conversation.participantIds,
        kind,
      );
      return;
    }

    // The conversation authorises the room token - see `startCall`.
    /*
     * The assistant's call is not a call.
     *
     * There is no room, no ringing and nobody to answer - it is the microphone,
     * two models and a speaker, all on this device and two edge functions. So
     * it opens its own screen rather than going anywhere near LiveKit, and only
     * audio: there is nothing to look at.
     */
    if (isAi) {
      setVoiceCall(true);
      return;
    }
    if (partner) void startCall(partner.id, partner.name, kind, conversation.id);
  };

  useEffect(() => {
    if (!callNotice) return;
    const timer = window.setTimeout(() => setCallNotice(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [callNotice]);

  const members = users.filter((u) => conversation.participantIds.includes(u.id));
  const isTyping = conversation.typingUserIds.length > 0;
  const isRecording = isTyping && conversation.typingActivity === 'recording';
  /*
   * Everything the assistant reports about itself, as opposed to the two
   * things a person can be doing. One list, so adding a stage is one edit.
   */
  const aiStage =
    isTyping && conversation.typingActivity && conversation.typingActivity in AI_STAGES
      ? (conversation.typingActivity as keyof typeof AI_STAGES)
      : undefined;
  /** AI has no contact row - still show a normal typing line, not a blank. */
  const typingLabel = isAi
    ? 'typing…'
    : formatTypingLabel(conversation.typingUserIds, users, conversation.typingActivity);

  /*
   * The "Seen" line, the way Instagram does it.
   *
   * Only under the *last* message, and only while it is still mine. A reply is
   * a stronger acknowledgement than a receipt, so once they answer, the line
   * goes - leaving it there would be telling you something their own message
   * already told you, and it would stack up down a long thread as a row of
   * receipts for messages nobody is waiting on any more.
   *
   * Ticks are unaffected: those stay on every message, which is where you look
   * when you want the history rather than the latest word.
   */
  const seen = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.authorId !== currentUser?.id || last.status !== 'read') return undefined;

    const readers = receipts.filter((r) => r.readAt >= last.createdAt);
    if (readers.length === 0) return undefined;

    // A direct chat has one reader, so counting them would only ever say "1".
    // The moment is the interesting fact there; in a group it is the tally.
    if (conversation.kind === 'direct') {
      return `Seen ${formatTime(Math.min(...readers.map((r) => r.readAt)))}`;
    }

    const everyone = conversation.participantIds.length - 1;
    return readers.length >= everyone
      ? 'Seen by everyone'
      : `Seen by ${readers.length}`;
  }, [messages, receipts, currentUser?.id, conversation.kind, conversation.participantIds.length]);

  // Track scroll position continuously; the value is read after new messages land.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = (fromScroll: boolean) => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const following = distanceFromBottom < FOLLOW_THRESHOLD;
      followingRef.current = following;
      setAwayFromBottom(!following);

      /*
       * Back at the bottom: clear the new-messages session and divider.
       * The jump chip hides because awayFromBottom is false.
       */
      if (following) {
        setNewSession(undefined);
        setDividerAtId(undefined);
        if (dividerHoldTimer.current !== undefined) {
          window.clearTimeout(dividerHoldTimer.current);
          dividerHoldTimer.current = undefined;
        }
      }

      /*
       * Reaching the top asks for the page before.
       *
       * `loadOlder` is a no-op while one is in flight or once history has run
       * out, so this can fire on every scroll frame without being guarded here.
       *
       * ## Only from a real scroll, and only from a real top
       *
       * This used to run from the synthetic first call below as well, and at
       * that moment the container is empty: `scrollTop` is 0, 0 is less than
       * the threshold, and every conversation open therefore fetched a second
       * page of fifty messages nobody had scrolled to. Measured at 251 kB per
       * open, on a device that already held the whole thread.
       *
       * The height test is the other half. A thread shorter than its own
       * viewport sits at `scrollTop` 0 for ever, so without it any scroll
       * event at all would keep asking for history that is not there.
       */
      if (
        shouldLoadOlder({
          fromScroll,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        })
      ) {
        void loadOlder();
      }
    };

    // The first call is for the follow state only - see above.
    onScroll(false);
    const listener = () => onScroll(true);
    el.addEventListener('scroll', listener, { passive: true });
    return () => el.removeEventListener('scroll', listener);
  }, [loadOlder]);

  /*
   * Keep the reader where they were when older messages arrive.
   *
   * Prepending content pushes everything down by its height, so without this
   * the thread jumps and the message being read shoots off the bottom. The
   * anchor is the distance from the *bottom*, which prepending does not change.
   */
  const anchorRef = useRef<number | undefined>(undefined);
  if (loadingOlder && anchorRef.current === undefined && scrollRef.current) {
    anchorRef.current = scrollRef.current.scrollHeight - scrollRef.current.scrollTop;
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || anchor === undefined || loadingOlder) return;
    el.scrollTop = el.scrollHeight - anchor;
    anchorRef.current = undefined;
  }, [loadingOlder, messages.length]);

  /*
   * Reading a thread is what clears its unread count, and what tells the other
   * person you have seen them. Fires on open, and again each time something new
   * lands while the thread is in front of you.
   *
   * ## Keyed on the newest message, not on the cluster count
   *
   * This used to depend on `groups.length`, which is the number of *clusters*  - 
   * and consecutive messages from one person inside five minutes are one
   * cluster. So a burst of four moved this number once. The reader's cursor
   * advanced for the first message and then stopped, and the sender watched one
   * message turn to "Seen" while the next three stayed on a single tick
   * forever. Leaving the chat and coming back fixed it, because that remounts
   * and re-runs this - which is exactly the workaround people found.
   *
   * The last message's id is the honest key: it changes when, and only when,
   * something new arrives at the bottom. `messages.length` would also do it,
   * but it moves when older history is paged in at the *top* as well, which is
   * a write with nothing new to acknowledge.
   */
  const newestMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    if (loading) return;
    void service.markConversationRead(conversation.id);
  }, [service, conversation.id, loading, newestMessageId]);

  /*
   * New-messages session while the reader is away from the bottom.
   *
   * Pins the first foreign message once, then only increments count. Never
   * rescans the full thread for "first unread" on each render.
   */
  useEffect(() => {
    if (loading || !newestMessageId) return;

    const previous = lastTrackedNewestRef.current;
    if (previous === newestMessageId) return;

    if (previous === undefined) {
      // First paint / open: establish the watermark without treating history as new.
      lastTrackedNewestRef.current = newestMessageId;
      return;
    }

    const prevIndex = messages.findIndex((m) => m.id === previous);
    const start = prevIndex >= 0 ? prevIndex + 1 : Math.max(0, messages.length - 1);
    const incoming = messages.slice(start);
    lastTrackedNewestRef.current = newestMessageId;

    if (followingRef.current) return;

    const foreign = incoming.filter(
      (m) => m.authorId !== currentUser?.id && !m.system && !m.deleted,
    );
    if (foreign.length === 0) return;

    setNewSession((session) => {
      if (!session) {
        const firstId = foreign[0]!.id;
        setDividerAtId(firstId);
        return { firstId, count: foreign.length };
      }
      return { ...session, count: session.count + foreign.length };
    });
  }, [messages, newestMessageId, loading, currentUser?.id]);

  // Jump to the newest message when the thread opens, then follow smoothly.
  const openedRef = useRef(false);
  useEffect(() => {
    openedRef.current = false;
  }, [conversation.id]);

  useEffect(() => {
    if (loading) return;

    if (!openedRef.current) {
      openedRef.current = true;
      bottomRef.current?.scrollIntoView({ block: 'end' });
      return;
    }

    if (followingRef.current) {
      bottomRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'end',
      });
    }
  }, [groups, loading, isTyping, prefersReducedMotion]);

  const jumpChipMode =
    newSession && newSession.count > 0
      ? ('new' as const)
      : awayFromBottom
        ? ('latest' as const)
        : undefined;

  const jumpToLatest = useCallback(() => {
    bottomRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [prefersReducedMotion]);

  const jumpToNewMessages = useCallback(() => {
    const session = newSession;
    if (!session) return;

    jumpTo(session.firstId);
    // Chip becomes Latest (if still away) or Hidden once at bottom.
    setNewSession(undefined);

    // Keep the divider long enough to read the boundary, then fade it out.
    if (dividerHoldTimer.current !== undefined) {
      window.clearTimeout(dividerHoldTimer.current);
    }
    dividerHoldTimer.current = window.setTimeout(() => {
      setDividerAtId(undefined);
      dividerHoldTimer.current = undefined;
    }, DIVIDER_HOLD_MS);
  }, [jumpTo, newSession]);

  /**
   * Day dividers, computed once per render of the thread. Placed before the first
   * cluster of each calendar day.
   */
  const clustersWithDividers = useMemo(() => {
    let lastDay: string | undefined;
    return groups.map((cluster) => {
      const first = cluster[0]!;
      const day = formatDayDivider(first.createdAt);
      const divider = day === lastDay ? undefined : day;
      lastDay = day;
      return { cluster, divider };
    });
  }, [groups]);

  const presenceLine = isAi
    ? 'Always here'
    : partner
      ? formatPresence(partner)
      : `${members.length} members`;

  const PINGO_AI_ID = 'a1000000-0000-4000-8000-0000000000a1';
  /**
   * @ autocomplete for groups (and AI DMs).
   * AI is listed when it is a member of the room so @pingoai is discoverable.
   */
  const mentionOptions = useMemo((): MentionOption[] | undefined => {
    if (isAi) {
      return [
        {
          id: PINGO_AI_ID,
          handle: 'pingoai',
          name: 'PINGO AI',
          kind: 'ai',
        },
      ];
    }
    if (!isGroup) return undefined;

    const options: MentionOption[] = [];
    const hasAi = conversation.participantIds.includes(PINGO_AI_ID);
    if (hasAi) {
      options.push({
        id: PINGO_AI_ID,
        handle: 'pingoai',
        name: 'PINGO AI',
        kind: 'ai',
      });
    }

    for (const person of members) {
      if (person.id === currentUser?.id) continue;
      if (person.id === PINGO_AI_ID) continue;
      options.push({
        id: person.id,
        handle: person.handle || person.id.slice(0, 8),
        name: person.name,
        ...(person.avatarUrl ? { avatarUrl: person.avatarUrl } : {}),
        kind: 'person',
      });
    }

    return options.length > 0 ? options : undefined;
  }, [isAi, isGroup, conversation.participantIds, members, currentUser?.id]);

  /*
   * The call replaces what this renders, not this.
   *
   * `ChatThread` stays mounted and its subscriptions keep running, so the reply
   * the call is waiting for still arrives in `messages` and `messagesRef` stays
   * current. Showing the call from somewhere else - a route, a portal above the
   * thread - would have meant unmounting the thing the call is listening to.
   */
  if (voiceCall) {
    return (
      <VoiceCall
        conversationId={conversation.id}
        onEnd={() => setVoiceCall(false)}
        ask={askByVoice}
      />
    );
  }

  return (
    <div
      className={cn('chat-wallpaper relative flex h-full min-h-0 flex-col', className)}
      /*
        The chosen wallpaper, read straight rather than through a provider.
        It has to be right in the first painted frame - a thread that starts
        plain and changes under you a moment later is worse than not having
        the feature.
      */
      style={{
        /*
          A live wallpaper *is* the background, so the element must not paint
          one of its own underneath it - see the canvas below for what that
          cost the first time.

          Custom photos use a real <img> (see below). CSS background-image freezes
          GIFs in Android WebView; the img path keeps them moving for everyone.
        */
        ...(wallpaper.live
          ? { backgroundImage: 'none', backgroundColor: '#0d0e13' }
          : wallpaper.photo
            ? {
                backgroundImage: 'none',
                backgroundColor: wallpaper.dark ? '#14151d' : 'var(--color-page)',
              }
            : {
                ...(wallpaper.css
                  ? { backgroundImage: wallpaper.css }
                  : { backgroundImage: 'none' }),
                ...(wallpaper.dark ? { backgroundColor: '#14151d' } : {}),
              }),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      data-wallpaper-dark={wallpaper.dark ? '' : undefined}
    >
      {wallpaper.photo && !wallpaper.live ? (
        <img
          src={wallpaper.photo}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {wallpaper.live && (
        /*
          First in the DOM, and no z-index at all.

          It was `-z-10`, which puts an element behind its own parent's
          background - and this parent paints one. So the rain was drawn, every
          frame, underneath an opaque sheet of page colour: the canvas measured
          as animating and the screen was flat black. Painting order alone does
          the job, because everything after it in the flow paints over it, and
          giving the thread's children z-indexes is how a scrolling list starts
          painting in the wrong order.
        */
        <canvas
          ref={rainRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
        />
      )}
      {/* ---- Header ------------------------------------------------------- */}
      <header
        className={cn(
          'z-100 flex shrink-0 items-center gap-3',
          /*
            A panel that floats, not a bar that spans.

            This was full width with square corners and a rule along the
            bottom - a wall across the top of the screen. Every liquid-glass
            reference does the opposite: the chrome is an object sitting over
            the content with space all round it, and the content runs behind
            and past it. A slab of glass has edges on all four sides; drawn
            edge to edge it has two, and reads as a painted strip rather than
            as a thing lying on top.

            The composer already floats. This is the header catching up, and
            it is most of what was still missing.
          */
          'glass-water mx-2 mt-2 rounded-xl',
          'px-3 py-2.5',
          'mt-[max(0.5rem,env(safe-area-inset-top))]',
        )}
      >
      {selection ? (
        /*
          The header becomes the selection rather than growing a second bar
          beneath it. There is only ever one thing to do with this strip, and
          two of them stacked would push the conversation down the screen every
          time somebody started picking messages.
        */
        <MessageSelectionBar
          selected={messages.filter((message) => selection.has(message.id))}
          mine={(message) => message.authorId === currentUser?.id}
          onCancel={() => setSelection(undefined)}
          onCopy={() => {
            const text = messages
              .filter((message) => selection.has(message.id) && message.body.trim())
              .map((message) => message.body)
              .join('\n\n');
            void navigator.clipboard?.writeText(text).catch(() => undefined);
            setSelection(undefined);
          }}
          onDelete={(forEveryone) => {
            void (async () => {
              const ids = [...selection];
              const go = await confirm({
                title:
                  ids.length === 1
                    ? forEveryone
                      ? 'Delete for everyone?'
                      : 'Delete for you?'
                    : forEveryone
                      ? `Delete ${ids.length} messages for everyone?`
                      : `Delete ${ids.length} messages for you?`,
                description: forEveryone
                  ? 'They go from this chat for both of you. They will see that messages were deleted.'
                  : 'They go from your side only. The other person still has their copies.',
                confirmLabel: 'Delete',
              });
              if (!go) return;
              /*
               * One at a time, and failures ignored one at a time with them.
               * A batch endpoint would be better and does not exist; what
               * matters is that message nineteen failing does not leave the
               * other eighteen undeleted.
               */
              for (const id of ids) {
                await service.deleteMessage(id, forEveryone).catch(() => undefined);
              }
              setSelection(undefined);
            })();
          }}
        />
      ) : searching ? (
        /*
          Search takes the header the same way selection does. Both are things
          you are doing to this conversation, and only one of them can be
          happening at a time.
        */
        <ThreadSearchBar
          messages={messages}
          onJump={jumpTo}
          onClose={() => setSearching(false)}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          onLoadOlder={() => void loadOlder()}
        />
      ) : (
        <>
        {showBack && (
          <Link
            to="/chats"
            aria-label="Back to conversations"
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full',
              'focus-ring text-text-secondary transition-colors duration-instant',
              'hover:bg-hover hover:text-ink active:scale-[0.96]',
            )}
          >
            <ChevronLeftIcon size={22} />
          </Link>
        )}

        {/*
          The identity block goes wherever "who is this?" is answered: a
          person's profile in a direct chat, the group's own info in a group,
          or AI prefs (name/vibe) for the AI person.
          It used to be a link in both cases, and in a group it pointed at
          `/chats` - so the one place a group's roster could plausibly be
          reached bounced you back to the list you came from.
        */}
        <Identity
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1',
            'focus-ring transition-colors duration-instant hover:bg-hover',
          )}
          {...(conversation.kind === 'direct' && partner
            ? { to: `/profile/${partner.handle}` }
            : isAi
              ? { onClick: () => setAiProfileOpen(true) }
              : { onClick: () => setGroupInfo(true) })}
        >
          {conversation.kind === 'direct' || isAi ? (
            /*
              inline-grid + fixed box: a bare inline wrapper becomes a line
              box and the presence ring paints as an oval around the face.
            */
            <span
              ref={headerAvatar}
              className="inline-grid size-10 shrink-0 place-items-center"
            >
              <Avatar
                name={conversation.title}
                id={partner?.id ?? conversation.id}
                src={partner?.avatarUrl ?? conversation.avatarUrl}
                size="sm"
                presence={
                  isAi
                    ? 'online'
                    : partner?.presence.state === 'online'
                      ? 'online'
                      : undefined
                }
              />
            </span>
          ) : conversation.avatarUrl ? (
            <Avatar
              name={conversation.title}
              id={conversation.id}
              src={conversation.avatarUrl}
              size="sm"
            />
          ) : (
            <AvatarStack
              people={members.map((m) => ({ id: m.id, name: m.name, src: m.avatarUrl }))}
              size="sm"
              max={2}
            />
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-ink">
              {conversation.title}
            </span>
            {/*
              Typing replaces the presence line rather than sitting beside it  - 
              same rule as the conversation list.
            */}
            {isTyping ? (
              <span className="flex items-center gap-1.5 text-caption text-brand">
                {/*
                  A microphone, not the typing dots.

                  The dots mean "words are coming"; a voice note is a different
                  promise and a different wait. Reusing the same mark would make
                  the receiver read it as text on the way.
                */}
                {aiStage ? (
                  <AiActivity label={`${AI_STAGES[aiStage]}…`} />
                ) : (
                  <>
                    {isRecording ? <RecordingPulse /> : <PingoDot state="typing" size={4} />}
                    {typingLabel}
                  </>
                )}
              </span>
            ) : (
              <span className="block truncate text-caption text-text-secondary">
                {presenceLine}
              </span>
            )}
          </span>
        </Identity>

        <div className="flex shrink-0 items-center gap-0.5">
          {/*
            Present and pressable even when calling is not available, because a
            dimmed icon cannot say *why*. Pressing one states the reason where
            there is room for a sentence - the menu - which is the difference
            between "this app's calling is broken" and "you two do not follow
            each other yet". Hiding them instead would make the feature look
            absent rather than conditional.

            AI gets the phone and not the camera. There is still nobody to ring -
            pressing it opens the microphone and talks to the model - but there
            is genuinely nothing to look at, and a video icon that produced an
            audio call would be a promise the screen breaks.
          */}
          <IconButton
            label={isAi ? 'Talk to PINGO' : 'Voice call'}
            size="sm"
            className={cn(!canCall && 'text-text-tertiary')}
            onClick={() => placeCall('voice')}
          >
            <PhoneIcon size={20} />
          </IconButton>
          {!isAi && (
            <IconButton
              label="Video call"
              size="sm"
              className={cn(!canCall && 'text-text-tertiary')}
              onClick={() => placeCall('video')}
            >
              <VideoIcon size={20} />
            </IconButton>
          )}
          <ConversationMenu
            conversation={conversation}
            {...(canCall
              ? {
                  onCall: (kind: 'audio' | 'video') =>
                    placeCall(kind === 'audio' ? 'voice' : 'video'),
                }
              : {})}
            {...(callBlockedReason && !isAi ? { callBlockedReason } : {})}
            {...(isAi ? { onAiSettings: () => setAiProfileOpen(true) } : {})}
            onSelectMessages={() => setSelection(new Set())}
            onSearchMessages={() => setSearching(true)}
            onSharedMedia={() => setSharedMedia(true)}
            onDisappearing={() => setDisappearing(true)}
          />
        </div>
        </>
      )}
      </header>

      {callNotice && (
        <p
          role="status"
          className="shrink-0 border-b border-line bg-surface px-4 py-2 text-caption text-text-secondary"
        >
          {callNotice}
        </p>
      )}

      {/* ---- Thread ------------------------------------------------------- */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState label="Loading messages" />
        ) : (
          <div
            className={cn(
              'mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-4',
              // Anchors a short thread to the bottom, against the composer, rather
              // than leaving it stranded at the top under a large void. Long
              // threads overflow past `min-h-full` and scroll as normal.
              'min-h-full justify-end',
            )}
          >
            {/*
              Says which of the two silences this is: more history being
              fetched, or the actual beginning of the conversation. Without it,
              a thread that stops scrolling looks identical to one that ran out.
            */}
            {hasOlder ? (
              <div className="flex justify-center py-3">
                {loadingOlder && <PingoDot state="loading" size={5} label="Loading earlier messages" />}
              </div>
            ) : (
              messages.length > 0 && (
                <p className="py-3 text-center text-caption text-text-tertiary">
                  This is the beginning of your conversation
                </p>
              )
            )}

            {clustersWithDividers.map(({ cluster, divider }) => (
              <div key={cluster[0]!.id} className="flex flex-col gap-0.5">
                {divider && (
                  <div className="py-3 text-center">
                    {/*
                      A pill of the same glass, not bare text.

                      Loose words floating on a wallpaper are the first thing
                      that stops being readable when somebody sets a
                      photograph, and the day marker is exactly the kind of
                      small grey text that disappears first.
                    */}
                    <span
                      className={cn(
                        'glass-water inline-block rounded-full px-3 py-1',
                        'text-caption text-text-secondary',
                      )}
                    >
                      {divider}
                    </span>
                  </div>
                )}

                {cluster.map((message, index) => {
                  const showNewDivider = dividerAtId === message.id;
                  const position =
                    cluster.length === 1
                      ? ('single' as const)
                      : index === 0
                        ? ('first' as const)
                        : index === cluster.length - 1
                          ? ('last' as const)
                          : ('middle' as const);

                  const picked = selection?.has(message.id) ?? false;
                  const mine = message.authorId === currentUser?.id;
                  const author = personOf(message.authorId);
                  /*
                   * Groups only: who said it.
                   *
                   * Direct chats have one other person (header). In a group of
                   * ten, colour-alone bubbles are unreadable — name on the first
                   * of a cluster, face on the last (WhatsApp-style).
                   */
                  const groupTheirs = isGroup && !mine && !message.system;
                  const authorName = groupTheirs
                    ? nameOf(message.authorId) ?? author?.handle ?? 'Member'
                    : undefined;
                  const showFace =
                    groupTheirs && (position === 'last' || position === 'single');

                  const bubbleProps = {
                    message,
                    mine,
                    position,
                    /*
                     * The assistant's action row. Reply lands in the same place
                     * the swipe and the menu do; "try again" re-sends the
                     * message that produced this answer, which the thread knows
                     * and a bubble cannot.
                     */
                    onReply: () => setReplyTo(message),
                    ...(message.authorId === PINGO_AI_USER_ID
                      ? { onRegenerate: () => regenerate(message) }
                      : {}),
                    showMeta: index === cluster.length - 1,
                    ...(authorName ? { authorName } : {}),
                    replyTo: message.replyToId ? byId.get(message.replyToId) : undefined,
                    replyToAuthor: message.replyToId
                      ? nameOf(byId.get(message.replyToId)?.authorId ?? '')
                      : undefined,
                    /*
                     * Tapping a call that is still running walks into it.
                     *
                     * Offered only while the entry carries a `callId`, which is
                     * what `endCallLog` clears when the room empties - so a
                     * finished call is a record and cannot be tapped into a
                     * room that is not there. Absent while already on a call,
                     * because joining the one you are in is not a thing.
                     */
                    ...(message.call?.callId && !activeCall
                      ? {
                          onJoinCall: () =>
                            void joinGroupCall(
                              message.call!.callId!,
                              conversation.id,
                              conversation.title,
                              conversation.participantIds,
                              message.call!.callKind,
                            ),
                        }
                      : {}),
                  };

                  const withGroupChrome = (node: ReactNode) =>
                    groupTheirs ? (
                      <div className="flex w-full items-end gap-2">
                        <div className="mb-0.5 w-8 shrink-0">
                          {showFace ? (
                            <Avatar
                              name={authorName ?? 'Member'}
                              id={message.authorId}
                              src={author?.avatarUrl}
                              size="xs"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">{node}</div>
                      </div>
                    ) : (
                      node
                    );

                  return (
                    <div key={message.id}>
                      {showNewDivider && <NewMessagesDivider />}
                      {selection ? (
                        /*
                          While selecting, the whole row is one control and
                          nothing inside it is.

                          A bubble carries a reaction bar, a swipe to reply, a
                          photo that opens and a voice note that plays. Leaving
                          those live during a selection means every attempt to
                          tick a message risks doing something else instead, so
                          the row is covered rather than each of them disabled -
                          one place that decides, instead of a rule every
                          bubble has to remember.
                        */
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={picked}
                          onClick={() => toggleSelected(message.id)}
                          className={cn(
                            'relative flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left',
                            'transition-colors duration-instant',
                            /*
                              The tick sits beside the bubble, on the bubble's
                              own side. Fixed to the left it ended up a hand's
                              width away from a message you sent, with nothing
                              between them - two unrelated marks rather than a
                              message and its checkbox.
                            */
                            mine && 'flex-row-reverse',
                            picked ? 'bg-brand-soft' : 'hover:bg-hover',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'grid size-5 shrink-0 place-items-center rounded-full border-2',
                              'transition-[background-color,border-color] duration-instant',
                              picked ? 'border-brand bg-brand text-on-brand' : 'border-line',
                            )}
                          >
                            {picked && <CheckIcon size={12} />}
                          </span>

                          {/* Inert: the row above is what receives the tap. */}
                          <span className="pointer-events-none min-w-0 flex-1">
                            {withGroupChrome(<MessageBubble {...bubbleProps} />)}
                          </span>
                        </button>
                      ) : (
                      <SwipeableMessage
                        mine={mine}
                        // Nothing to answer on a tombstone, so the track stays inert.
                        enabled={!message.deleted && !message.system}
                        onReply={() => setReplyTo(message)}
                      >
                      {withGroupChrome(
                      <MessageMenu
                        message={message}
                        mine={mine}
                        onReply={setReplyTo}
                        onForward={() => undefined}
                        children={<MessageBubble {...bubbleProps} />}
                        render={({ hidden, ...trigger }) => (
                          <MessageBubble
                            {...bubbleProps}
                            onJumpToReply={
                              message.replyToId && byId.has(message.replyToId)
                                ? () => jumpTo(message.replyToId!)
                                : undefined
                            }
                            trigger={{
                              ...trigger,
                              // Hidden, not unmounted: the menu holds a copy at
                              // the same coordinates, and removing this one would
                              // collapse the thread underneath it.
                              style: hidden ? { opacity: 0 } : undefined,
                            }}
                            reactions={
                              <ReactionPills
                                reactions={message.reactions}
                                me={currentUser?.id}
                                onToggle={(emoji) =>
                                  void service.toggleReaction(message.id, emoji).catch(() => undefined)
                                }
                              />
                            }
                          />
                        )}
                      />,
                      )}
                      </SwipeableMessage>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {seen && (
              <p
                className="pr-1 pt-0.5 text-right text-caption text-text-tertiary"
                /*
                 * Announced when it changes rather than on every render. A
                 * screen reader user gets told once that the message landed,
                 * which is the same single beat a sighted user gets.
                 */
                aria-live="polite"
              >
                {seen}
              </p>
            )}

            {isTyping &&
              /*
                Recording gets the mark alone: no bubble, no words.

                A bubble is the shape of a message, and a bubble that says
                "recording a voice note" is the app narrating itself - the
                pulsing microphone already says the whole thing, and saying it
                twice is what makes an interface feel padded. Typing keeps its
                bubble because dots inside one read as a message being formed,
                which is exactly what they mean.
              */
              (aiStage ? (
                /*
                  Inside a bubble, unlike the microphone.

                  The microphone stands bare because the mark *is* the whole
                  message. This is a sentence, and a sentence with no bubble
                  behind it reads as part of the wallpaper.
                */
                <div className="flex justify-start pt-1">
                  <div className="glass-water rounded-lg px-4 py-3 text-caption">
                    <AiActivity label={`${AI_STAGES[aiStage]}…`} />
                  </div>
                </div>
              ) : isRecording ? (
                <div className="flex justify-start pt-1 pl-1">
                  <RecordingPulse size={22} />
                </div>
              ) : (
                <div className="flex justify-start pt-1">
                  <div className="glass-water rounded-lg px-4 py-3">
                    <PingoDot state="typing" size={7} label={typingLabel || 'typing'} />
                  </div>
                </div>
              ))}

            {/*
              Sits under the typing indicator (never above it). Human threads
              get the quiet lock line; AI gets honesty that this chat is
              processed for replies - not an E2EE claim.
            */}
            {isAi ? <AiPrivacyNotice /> : <EncryptionNotice />}

            {/* Scroll anchor. */}
            <div ref={bottomRef} className="h-0" />
          </div>
        )}
      </div>

      {/*
        Jump control lives between thread and composer - not inside the
        bordered composer strip, so it never rides a full-width "patti".
        One slot: New Messages wins over Latest.
      */}
      {jumpChipMode && (
        <div className="pointer-events-none relative z-20 -mt-3 mb-1 flex justify-center px-3">
          <div className="pointer-events-auto">
            {jumpChipMode === 'new' && newSession ? (
              <ThreadJumpChip
                mode="new"
                count={newSession.count}
                onClick={jumpToNewMessages}
              />
            ) : (
              <ThreadJumpChip mode="latest" onClick={jumpToLatest} />
            )}
          </div>
        </div>
      )}

      {/* ---- Composer ----------------------------------------------------- */}
      <div
        className={cn(
          /*
            No bar behind the bar.

            This used to be a full-width translucent strip with its own blur
            and a rule along the top, and the composer sat inside it - two
            stacked surfaces where there is one object. Now the composer pill
            is the surface, and this is only the space it floats in, so the
            conversation runs behind it the way it does behind the header.
          */
          'shrink-0',
          'px-3 py-3',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="mx-auto w-full max-w-3xl">
          {replyTo && (
            /*
             * Sits directly on the composer, not floating over the thread: what
             * you are answering has to be visible while you type it, and a
             * banner that scrolls away with the messages is not.
             */
            <div
              className={cn(
                'animate-panel-in mb-2 flex items-start gap-2 rounded-lg',
                'border-l-2 border-brand bg-surface py-2 pr-1 pl-2.5 shadow-sm',
              )}
            >
              <button
                type="button"
                onClick={() => jumpTo(replyTo.id)}
                className="focus-ring min-w-0 flex-1 rounded-md text-left"
              >
                <span className="block text-caption font-medium text-brand">
                  Replying to {nameOf(replyTo.authorId) ?? 'message'}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-caption text-text-secondary">
                  {quoteText(replyTo)}
                </span>
              </button>
              <IconButton
                label="Cancel reply"
                variant="ghost"
                onClick={() => setReplyTo(undefined)}
              >
                <CloseIcon size={16} />
              </IconButton>
            </div>
          )}

          <Composer
            mentions={mentionOptions}
            onSend={async (body) => {
              // Captured before the await: a reply cleared mid-flight must not
              // turn this into a plain message.
              const target = replyTo?.id;
              setReplyTo(undefined);

              /*
               * Sending makes no sound, on purpose.
               *
               * It was tried on the tap and again on the acknowledgement, and
               * neither earned its place: the sender already knows they sent it,
               * they are looking at the screen when it happens, and the ticks
               * say the rest. Arrival is the only event here the user is not
               * already watching, so it is the only one worth a sound.
               *
               * `SENT` stays designed and tested in `message-sounds.ts` — the
               * decision here is about when to use a sound, not about whether
               * PINGO has one.
               */
              await send(body, target);
            }}
            onSendSticker={(sticker) =>
              sendSticker({ id: sticker.id, url: sticker.url, body: sticker.emoji ?? sticker.name })
            }
            onSendVoice={async (take) => {
              await service.sendMessage({
                conversationId: conversation.id,
                body: '',
                voice: { audio: take.blob, seconds: take.seconds, waveform: take.waveform },
              });
            }}
            attach={{
              gallery: () => galleryRef.current?.click(),
              /*
                Pass this thread so the camera send stage already has a
                recipient. Without it, open-from-chat lands on an empty picker
                and Send stays disabled.
              */
              camera: () =>
                navigate('/camera', { state: { conversationId: conversation.id } }),
              document: () => documentRef.current?.click(),
              location: () => setSheet('location'),
              contact: () => setSheet('contact'),
              event: () => setSheet('event'),
            }}
            onTyping={(typing) => void service.setTyping(conversation.id, typing)}
            onRecording={(recording) => void service.setRecording(conversation.id, recording)}
            // A GIF or sticker from the keyboard lands where a gallery pick
            // lands: same preview, caption and send. The file is passed through
            // untouched, which is what keeps an animated GIF animated.
            onPasteFiles={(files) => setPending(files)}
            draftKey={conversation.id}
            ariaLabel={`Message ${conversation.title}`}
          />
        </div>
      </div>

      {/*
        The real picker, hidden. The attach menu's rows have to look like the
        other rows, and a file input cannot be one of those.
      */}
      <input
        ref={galleryRef}
        type="file"
        /*
          Audio is here because it is in the gallery.

          A song, a recording, a voice memo saved from somewhere else: on a
          phone those live alongside the photos, and leaving them out of the
          filter did not stop people picking them - some pickers ignore the
          accept list entirely - it only meant they arrived unannounced.
        */
        accept="image/*,video/*,audio/*"
        multiple
        hidden
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          // Cleared first, so picking the same photo twice still fires.
          event.target.value = '';
          if (chosen.length === 0) return;

          void (async () => {
            /*
             * Asked, not assumed.
             *
             * This used to be `type.startsWith('video/')` and *everything else*
             * is a picture, which was wrong in both directions: a song went to
             * the photo composer to be drawn onto a canvas, and an audio-only
             * `.m4a` - which Android hands back as `video/mp4`, because that is
             * genuinely the container - opened the video trimmer and was sent
             * as a video with no picture in it. `probeKind` decodes it and
             * looks.
             */
            const kinds = await Promise.all(chosen.map((file) => probeKind(file)));
            const of = (want: PickedKind) => chosen.filter((_, index) => kinds[index] === want);

            const images = of('image');
            const videos = of('video');
            /*
             * Audio and anything unrecognised travel the document path: whole
             * bytes, original filename. What each one *looks* like in the
             * thread is `FileBubble`'s decision, not this picker's - which is
             * why the audio-in-a-video-container case is retyped here. The mime
             * travels with the upload and is what the receiver branches on, so
             * routing it correctly and storing it as `video/mp4` would draw a
             * black rectangle on the other side.
             */
            const files = [...of('audio').map(retypedAsAudio), ...of('file')];

            // Checked here, once, for every branch below.
            const oversized = [
              ...videos.filter((file) => mediaTooLarge(file.size, 'file')),
              ...files.filter((file) => mediaTooLarge(file.size, 'file')),
              ...images.filter((file) => mediaTooLarge(file.size, 'photo')),
            ];
            if (oversized[0]) {
              void refuseIfTooLarge(
                oversized[0],
                images.includes(oversized[0]) ? 'photo' : 'file',
              );
              return;
            }

            /*
             * One video opens the trimmer; several go straight out.
             *
             * Trimming is a decision about one clip, and a queue of sheets is a
             * queue of decisions nobody asked to make - picking five videos is
             * "send these five", not "let me edit each of them".
             *
             * Sending the `File` untouched is also the only way to keep the
             * original quality, since nothing on this path re-encodes it - the
             * bytes that leave the phone are the bytes the camera wrote.
             */
            if (videos.length === 1 && videos[0]) setTrimming(videos[0]);
            else {
              for (const file of videos) {
                void service.sendMessage({
                  conversationId: conversation.id,
                  body: '',
                  document: { file },
                });
              }
            }

            for (const file of files) {
              void service.sendMessage({
                conversationId: conversation.id,
                body: '',
                document: { file },
              });
            }

            if (images.length > 0) setPending(images);
          })();
        }}
      />

      {/* Any file type, since a document is whatever the sender calls one. */}
      <input
        ref={documentRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void (async () => {
            if (await refuseIfTooLarge(file, 'file')) return;
            /*
             * Probed here too, for the one thing that survives this path.
             *
             * A document keeps its type all the way to the recipient's bubble,
             * so an audio-only `.m4a` picked here - which the system reports as
             * `video/mp4` - would open a video player over a file with no
             * picture in it. Everything else is sent exactly as chosen.
             */
            const sending =
              (await probeKind(file)) === 'audio' ? retypedAsAudio(file) : file;
            await service.sendMessage({
              conversationId: conversation.id,
              body: '',
              document: { file: sending },
            });
          })();
        }}
      />

      {sheet === 'location' && (
        <LocationSheet
          onClose={() => setSheet(undefined)}
          onSend={(location) => {
            setSheet(undefined);
            void service.sendMessage({ conversationId: conversation.id, body: '', location });
          }}
        />
      )}

      {sheet === 'contact' && (
        <ContactSheet
          onClose={() => setSheet(undefined)}
          onSend={(contact) => {
            setSheet(undefined);
            void service.sendMessage({ conversationId: conversation.id, body: '', contact });
          }}
        />
      )}

      {sheet === 'event' && (
        <EventSheet
          onClose={() => setSheet(undefined)}
          onSend={(event) => {
            setSheet(undefined);
            void service.sendMessage({ conversationId: conversation.id, body: '', event });
          }}
        />
      )}

      {trimming && (
        <TrimGate
          file={trimming}
          onClose={() => setTrimming(undefined)}
          onSend={(videoEdit) => {
            void service.sendMessage({
              conversationId: conversation.id,
              body: '',
              document: { file: trimming },
              ...(videoEdit ? { videoEdit } : {}),
            });
            setTrimming(undefined);
          }}
        />
      )}

      {pending && (
        <PhotoComposer
          files={pending}
          onCancel={() => setPending(undefined)}
          onSend={async (blobs, caption, viewLimit) => {
            /*
             * Sent in order, awaited one at a time. In parallel they would race
             * for `created_at` and land shuffled, which for a set of photos is
             * the one thing the sender notices immediately.
             */
            for (const [position, image] of blobs.entries()) {
              await service.sendMessage({
                conversationId: conversation.id,
                // The caption rides on the first picture only, so a set of four
                // does not repeat one sentence four times.
                body: position === 0 ? caption : '',
                photo: { image, ...(viewLimit ? { viewLimit } : {}) },
              });
            }
            setPending(undefined);
          }}
        />
      )}

      {groupInfo && (
        <GroupInfoSheet conversation={conversation} onClose={() => setGroupInfo(false)} />
      )}

      {sharedMedia && (
        <SharedMediaSheet
          conversationId={conversation.id}
          onClose={() => setSharedMedia(false)}
          onJump={jumpTo}
        />
      )}

      {disappearing && (
        <DisappearingSheet
          conversation={conversation}
          onClose={() => setDisappearing(false)}
        />
      )}

      {isAi && aiOnboarding && (
        <AiOnboardingSheet
          onDone={() => setAiOnboarding(false)}
          onClose={() => setAiOnboarding(false)}
        />
      )}

      {isAi && aiProfileOpen && (
        <AiProfileSheet
          conversationId={conversation.id}
          onClose={() => setAiProfileOpen(false)}
          onChanged={() => {
            // ensure re-hydrates AI title/avatar and emits conversation:updated.
            void service.ensureAiConversation().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

/**
 * The header's identity block: a link to a profile, or a button to group info.
 *
 * One component rather than two branches at the call site, because the two
 * differ only in what happens when you press them - everything visual, the
 * avatar, the name, the presence line, is shared, and duplicating it to change
 * the wrapper is how the two drift apart.
 */
function Identity({
  to,
  onClick,
  className,
  children,
}: {
  to?: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (to) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cn(className, 'text-left')}>
      {children}
    </button>
  );
}

/**
 * Holds the object URL a trim sheet reads from, for exactly as long as it is open.
 *
 * The sheet takes a `src` and does not own it, because a component that creates
 * a blob URL in a render is a component that leaks one on every re-render. This
 * makes it once, hands it over, and revokes it on the way out - which is also
 * why the sheet is behind a wrapper rather than rendered inline.
 */
function TrimGate({
  file,
  onClose,
  onSend,
}: {
  file: File;
  onClose: () => void;
  onSend: (edit: VideoEdit | undefined) => void;
}) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!src) return null;

  return (
    <VideoTrimSheet
      src={src}
      onDone={(edit) => {
        // Cancelling closes without sending; anything else is a send, including
        // an edit with no marks in it - that is somebody saying "as it is".
        if (edit === undefined) onClose();
        else onSend(edit);
      }}
    />
  );
}
