import {
  formatDayDivider,
  formatPresence,
  formatTypingLabel,
  useChat,
  useMessages,
  type Conversation,
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
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import { useCall } from '../calls/CallProvider.js';
import { useMutuals } from '../profile/useMutuals.js';
import { Composer } from './Composer.js';
import { MessageBubble } from './MessageBubble.js';

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

export function ChatThread({
  conversation,
  showBack = false,
  className,
}: ChatThreadProps) {
  const { currentUser, users, service } = useChat();
  const { groups, loading, send, sendSticker } = useMessages(conversation.id);
  const { startCall } = useCall();
  const mutuals = useMutuals();


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
   * Calls need a mutual follow.  is undefined while loading, so the
   * buttons are not briefly disabled on first render — a control that flickers
   * to disabled reads as broken rather than as loading.
   */
  const canCall = Boolean(partner && mutuals?.has(partner.id));

  const members = users.filter((u) => conversation.participantIds.includes(u.id));
  const isTyping = conversation.typingUserIds.length > 0;

  // Track scroll position continuously; the value is read after new messages land.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      followingRef.current = distanceFromBottom < FOLLOW_THRESHOLD;
    };

    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

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

        {/* The identity block links through to the profile, as on the board. */}
        <Link
          to={partner ? `/profile/${partner.handle}` : '/chats'}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1',
            'focus-ring transition-colors duration-instant hover:bg-hover',
          )}
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
        </Link>

        <div className="flex shrink-0 items-center gap-0.5">
          {/*
            Disabled in groups rather than hidden: the affordance is real and
            coming, and a button that vanishes on some threads is worse to learn
            than one that is visibly not available yet.
          */}
          <IconButton
            label="Voice call"
            size="sm"
            disabled={!canCall}
            onClick={() => partner && void startCall(partner.id, partner.name, 'voice')}
          >
            <PhoneIcon size={20} />
          </IconButton>
          <IconButton
            label="Video call"
            size="sm"
            disabled={!canCall}
            onClick={() => partner && void startCall(partner.id, partner.name, 'video')}
          >
            <VideoIcon size={20} />
          </IconButton>
          <IconButton label="Conversation options" size="sm">
            <MoreIcon size={20} />
          </IconButton>
        </div>
      </header>

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
            {clustersWithDividers.map(({ cluster, divider }) => (
              <div key={cluster[0]!.id} className="flex flex-col gap-0.5">
                {divider && (
                  <div className="py-3 text-center">
                    <span className="text-caption text-text-tertiary">{divider}</span>
                  </div>
                )}

                {cluster.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    mine={message.authorId === currentUser?.id}
                    position={
                      cluster.length === 1
                        ? 'single'
                        : index === 0
                          ? 'first'
                          : index === cluster.length - 1
                            ? 'last'
                            : 'middle'
                    }
                    // One timestamp per cluster, on its final message.
                    showMeta={index === cluster.length - 1}
                  />
                ))}
              </div>
            ))}

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
          <Composer
            onSend={send}
            onSendSticker={(sticker) =>
              sendSticker({ id: sticker.id, url: sticker.url, body: sticker.emoji ?? sticker.name })
            }
            onTyping={(typing) => void service.setTyping(conversation.id, typing)}
            ariaLabel={`Message ${conversation.title}`}
          />
        </div>
      </div>
    </div>
  );
}
