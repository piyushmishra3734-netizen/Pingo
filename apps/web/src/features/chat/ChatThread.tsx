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
} from '@pingo/core';
import {
  Avatar,
  AvatarStack,
  ChevronLeftIcon,
  IconButton,
  LoadingState,
  MoreIcon,
  PhoneIcon,
  PingoDot,
  VideoIcon,
  cn,
} from '@pingo/ui';
import { CloseIcon } from '@pingo/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useCall } from '../calls/CallProvider.js';
import { useMutuals } from '../profile/useMutuals.js';
import { MessageMenu } from './context-menu/MessageMenu.js';
import { ReactionPills } from './context-menu/ReactionPills.js';
import { Composer } from './Composer.js';
import { GroupInfoSheet } from './GroupInfoSheet.js';
import { ConversationMenu } from './ConversationMenu.js';
import { MessageBubble, quoteText } from './MessageBubble.js';
import { ContactSheet, EventSheet, LocationSheet } from './AttachSheets.js';
import { PhotoComposer } from './PhotoComposer.js';
import { SwipeableMessage } from './SwipeableMessage.js';

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

/** How close to the top starts fetching the page before, in px. */
const OLDER_THRESHOLD = 200;

export function ChatThread({
  conversation,
  showBack = false,
  className,
}: ChatThreadProps) {
  const { currentUser, users, service } = useChat();
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
  const { startCall, startGroupCall } = useCall();
  const navigate = useNavigate();
  const galleryRef = useRef<HTMLInputElement>(null);
  /** Pictures chosen but not yet sent — the composer owns them until then. */
  const [pending, setPending] = useState<File[]>();
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

  /** Group info: the roster, the roles and the invite link. */
  const [groupInfo, setGroupInfo] = useState(false);

  // Cleared when the thread changes: a reply aimed at another conversation
  // would attach to whatever is open now.
  useEffect(() => setReplyTo(undefined), [conversation.id]);

  /** Resolves a quoted message against the loaded page. */
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const nameOf = (userId: string) =>
    userId === currentUser?.id ? 'You' : users.find((u) => u.id === userId)?.name;

  /** Scrolls the original into view and marks it, for a beat. */
  const jumpTo = (messageId: string) => {
    const target = document.getElementById(`message-${messageId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // A flash rather than a lasting highlight: it answers "which one" and then
    // gets out of the way.
    target.animate(
      [{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }],
      { duration: 600, easing: 'ease-in-out' },
    );
  };


  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Whether the user was at the bottom *before* this render's new content. */
  const followingRef = useRef(true);

  const partner =
    conversation.kind === 'direct'
      ? users.find(
          (u) => conversation.participantIds.includes(u.id) && u.id !== currentUser?.id,
        )
      : undefined;

  /*
   * A direct call needs a mutual follow; a group call does not.
   *
   * `mutuals` is undefined while loading, so the buttons are not briefly
   * disabled on first render — a control that flickers to disabled reads as
   * broken rather than as loading.
   *
   * The rule for a direct call is that a stranger must not be able to make your
   * phone ring. Being in a group is already the answer to that: you were either
   * added by a friend or you walked in through a link, and either way you
   * agreed to be in the room. Requiring friendship *inside* the room would mean
   * a group of six where four people can be called and two cannot, which is not
   * a privacy rule — it is a broken button.
   */
  const isGroup = conversation.kind !== 'direct';
  const canCall = isGroup
    ? conversation.participantIds.length > 1
    : Boolean(partner && mutuals?.has(partner.id));

  /**
   * Why calling is unavailable, in a sentence. Undefined when it is available.
   *
   * The rule itself is not new — calls have always needed a mutual follow — but
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
   * Places the call this thread is for — one person, or the whole room.
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

    if (partner) void startCall(partner.id, partner.name, kind);
  };

  useEffect(() => {
    if (!callNotice) return;
    const timer = window.setTimeout(() => setCallNotice(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [callNotice]);

  const members = users.filter((u) => conversation.participantIds.includes(u.id));
  const isTyping = conversation.typingUserIds.length > 0;

  /*
   * The "Seen" line, the way Instagram does it.
   *
   * Only under the *last* message, and only while it is still mine. A reply is
   * a stronger acknowledgement than a receipt, so once they answer, the line
   * goes — leaving it there would be telling you something their own message
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

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      followingRef.current = distanceFromBottom < FOLLOW_THRESHOLD;

      /*
       * Reaching the top asks for the page before.
       *
       * `loadOlder` is a no-op while one is in flight or once history has run
       * out, so this can fire on every scroll frame without being guarded here.
       */
      if (el.scrollTop < OLDER_THRESHOLD) void loadOlder();
    };

    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
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
   * Reading a thread is what clears its unread count, and nothing called this —
   * so the badge only ever grew, on the list and on the dock. Fires on open and
   * again as messages land while the thread is in front of you.
   */
  useEffect(() => {
    if (loading) return;
    void service.markConversationRead(conversation.id);
  }, [service, conversation.id, loading, groups.length]);

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
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [groups, loading, isTyping]);

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

  const presenceLine = partner
    ? formatPresence(partner)
    : `${members.length} members`;

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-page', className)}>
      {/* ---- Header ------------------------------------------------------- */}
      <header
        className={cn(
          'z-100 flex shrink-0 items-center gap-3',
          'glass-surface border-x-0 border-t-0 border-b-line',
          'px-3 py-2.5',
          'pt-[max(0.625rem,env(safe-area-inset-top))]',
        )}
      >
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
          person's profile in a direct chat, the group's own info in a group.
          It used to be a link in both cases, and in a group it pointed at
          `/chats` — so the one place a group's roster could plausibly be
          reached bounced you back to the list you came from.
        */}
        <Identity
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1',
            'focus-ring transition-colors duration-instant hover:bg-hover',
          )}
          {...(conversation.kind === 'direct' && partner
            ? { to: `/profile/${partner.handle}` }
            : { onClick: () => setGroupInfo(true) })}
        >
          {conversation.kind === 'direct' ? (
            <Avatar
              name={conversation.title}
              id={partner?.id ?? conversation.id}
              src={partner?.avatarUrl ?? conversation.avatarUrl}
              size="sm"
              presence={partner?.presence.state === 'online' ? 'online' : undefined}
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
              Typing replaces the presence line rather than sitting beside it —
              same rule as the conversation list.
            */}
            {isTyping ? (
              <span className="flex items-center gap-1.5 text-caption text-brand">
                <PingoDot state="typing" size={4} />
                {formatTypingLabel(conversation.typingUserIds, users)}
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
            there is room for a sentence — the menu — which is the difference
            between "this app's calling is broken" and "you two do not follow
            each other yet". Hiding them instead would make the feature look
            absent rather than conditional.
          */}
          <IconButton
            label="Voice call"
            size="sm"
            className={cn(!canCall && 'text-text-tertiary')}
            onClick={() => placeCall('voice')}
          >
            <PhoneIcon size={20} />
          </IconButton>
          <IconButton
            label="Video call"
            size="sm"
            className={cn(!canCall && 'text-text-tertiary')}
            onClick={() => placeCall('video')}
          >
            <VideoIcon size={20} />
          </IconButton>
          <ConversationMenu
            conversation={conversation}
            {...(canCall
              ? {
                  onCall: (kind: 'audio' | 'video') =>
                    placeCall(kind === 'audio' ? 'voice' : 'video'),
                }
              : {})}
            {...(callBlockedReason ? { callBlockedReason } : {})}
          />
        </div>
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
                    <span className="text-caption text-text-tertiary">{divider}</span>
                  </div>
                )}

                {cluster.map((message, index) => {
                  const position =
                    cluster.length === 1
                      ? ('single' as const)
                      : index === 0
                        ? ('first' as const)
                        : index === cluster.length - 1
                          ? ('last' as const)
                          : ('middle' as const);

                  return (
                    <SwipeableMessage
                      key={message.id}
                      mine={message.authorId === currentUser?.id}
                      // Nothing to answer on a tombstone, so the track stays inert.
                      enabled={!message.deleted}
                      onReply={() => setReplyTo(message)}
                    >
                    <MessageMenu
                      message={message}
                      mine={message.authorId === currentUser?.id}
                      onReply={setReplyTo}
                      onForward={() => undefined}
                      children={
                        <MessageBubble
                          message={message}
                          mine={message.authorId === currentUser?.id}
                          position={position}
                          showMeta={index === cluster.length - 1}
                          replyTo={
                            message.replyToId ? byId.get(message.replyToId) : undefined
                          }
                          replyToAuthor={
                            message.replyToId
                              ? nameOf(byId.get(message.replyToId)?.authorId ?? '')
                              : undefined
                          }
                        />
                      }
                      render={({ hidden, ...trigger }) => (
                        <MessageBubble
                          message={message}
                          mine={message.authorId === currentUser?.id}
                          position={position}
                          // One timestamp per cluster, on its final message.
                          showMeta={index === cluster.length - 1}
                          replyTo={
                            message.replyToId ? byId.get(message.replyToId) : undefined
                          }
                          replyToAuthor={
                            message.replyToId
                              ? nameOf(byId.get(message.replyToId)?.authorId ?? '')
                              : undefined
                          }
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
                    />
                    </SwipeableMessage>
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

            {isTyping && (
              <div className="flex justify-start pt-1">
                <div className="rounded-lg bg-surface px-4 py-3 shadow-sm">
                  <PingoDot
                    state="typing"
                    size={7}
                    label={formatTypingLabel(conversation.typingUserIds, users)}
                  />
                </div>
              </div>
            )}

            {/* Scroll anchor. */}
            <div ref={bottomRef} className="h-0" />
          </div>
        )}
      </div>

      {/* ---- Composer ----------------------------------------------------- */}
      <div
        className={cn(
          'shrink-0 border-t border-line bg-page/80 backdrop-blur-glass',
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
            onSend={async (body) => {
              // Captured before the await: a reply cleared mid-flight must not
              // turn this into a plain message.
              const target = replyTo?.id;
              setReplyTo(undefined);
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
              camera: () => navigate('/camera'),
              document: () => documentRef.current?.click(),
              location: () => setSheet('location'),
              contact: () => setSheet('contact'),
              event: () => setSheet('event'),
            }}
            onTyping={(typing) => void service.setTyping(conversation.id, typing)}
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
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          // Cleared first, so picking the same photo twice still fires.
          event.target.value = '';
          if (chosen.length > 0) setPending(chosen);
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
          void service.sendMessage({
            conversationId: conversation.id,
            body: '',
            document: { file },
          });
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
    </div>
  );
}

/**
 * The header's identity block: a link to a profile, or a button to group info.
 *
 * One component rather than two branches at the call site, because the two
 * differ only in what happens when you press them — everything visual, the
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
