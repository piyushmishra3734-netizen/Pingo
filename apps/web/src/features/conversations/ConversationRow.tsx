import {
  formatConversationTimestamp,
  formatMuteUntil,
  formatTypingLabel,
  messagePreview,
  useChat,
  type Conversation,
} from '@pingo/core';
import {
  Avatar,
  Badge,
  CheckDoubleIcon,
  CheckIcon,
  MuteIcon,
  PinIcon,
  PingoDot,
  StarIcon,
  cn,
} from '@pingo/ui';
import { Link } from 'react-router-dom';

import { useLongPress } from '../chat/context-menu/useLongPress.js';

/**
 * One row in the conversation list.
 *
 * The information hierarchy is doing real work here. A row has to answer three
 * questions at a glance — who, what, and does it need me — so:
 *
 *   - Unread rows set the title to medium weight and the preview to full-strength
 *     ink. Read rows drop the preview to secondary. Weight carries the state, not
 *     a coloured background, which would make a busy list look alarming.
 *   - A typing indicator *replaces* the preview. It is strictly newer information,
 *     and showing both would be two truths competing.
 *   - Read receipts appear on the preview only when the last message is ours,
 *     because that is the only case where they mean anything.
 */

export interface ConversationRowProps {
  conversation: Conversation;
  active?: boolean;
  /**
   * Selection mode. Absent means the row is an ordinary link.
   *
   * Passed in rather than read from context because the row is also rendered in
   * the archived shelf, and only the list that owns a selection can say whether
   * this row is part of one.
   */
  selectable?: boolean;
  selected?: boolean;
  /** A tap while selecting toggles the row instead of opening the chat. */
  onToggleSelect?: () => void;
  /** A hold on an ordinary row is what starts a selection. */
  onEnterSelection?: () => void;
}

export function ConversationRow({
  conversation,
  active = false,
  selectable = false,
  selected = false,
  onToggleSelect,
  onEnterSelection,
}: ConversationRowProps) {
  const { currentUser, users } = useChat();

  const isTyping = conversation.typingUserIds.length > 0;
  const hasUnread = conversation.unreadCount > 0;
  const lastMessage = conversation.lastMessage;
  const lastMessageIsMine = lastMessage?.authorId === currentUser?.id;

  // Only direct chats have a single "other person" whose presence we can show.
  const partner =
    conversation.kind === 'direct'
      ? users.find((u) => conversation.participantIds.includes(u.id) && u.id !== currentUser?.id)
      : undefined;

  const preview = messagePreview(lastMessage, {
    conversation,
    currentUserId: currentUser?.id ?? '',
    users,
  });

  /*
   * A hold enters selection mode; once in it, a tap toggles instead of opening.
   * The same 500ms as the message menu, so "hold to choose" means one thing
   * everywhere in the app rather than two slightly different things.
   */
  const longPress = useLongPress(() => onEnterSelection?.());

  const body = (
    <>
      {/*
        Groups get a single avatar, not a stack. A stack is wider than one circle,
        which would push the title and preview of group rows right and break the
        alignment of the whole column. Member faces belong on the Communities
        cards, where horizontal space is free.
      */}
      <Avatar
        name={conversation.title}
        id={partner?.id ?? conversation.id}
        /*
          The partner's photo for a direct chat, the conversation's own for a
          group. Without this every row rendered a monogram even for people who
          had set a picture — the avatar was there, its source was not.
        */
        src={partner?.avatarUrl ?? conversation.avatarUrl}
        size="md"
        // Presence only. Typing is already carried by the preview line below, and
        // saying it twice in one row is two signals competing for the same glance.
        presence={
          conversation.kind === 'direct' && partner?.presence.state === 'online'
            ? 'online'
            : undefined
        }
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-body',
              hasUnread ? 'font-medium text-ink' : 'text-ink',
            )}
          >
            {conversation.title}
          </span>

          {/*
            The streak sits beside the name, so who you are keeping one with is
            answered in the same glance as who the row is.

            Rendered only when there is one. `streak` is absent rather than 0
            when there is no streak, so this is a presence check and there is no
            empty badge to design around.
          */}
          {conversation.streak !== undefined && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-caption font-medium text-ink tabular-nums"
              title={`${conversation.streak}-day streak`}
            >
              <span aria-hidden>🔥</span>
              {conversation.streak}
              <span className="sr-only">day streak</span>
            </span>
          )}

          {/*
            Three markers in a fixed order, all at tertiary weight so none of
            them competes with the title or the unread badge. A favourite is the
            quietest of the three — it is a filter you set once, not a state
            that changes, so it is a hollow star rather than a filled one and it
            sits first, furthest from the timestamp the eye lands on.
          */}
          {conversation.favorite && (
            <StarIcon size={12} className="shrink-0 text-text-tertiary" title="Favourite" />
          )}
          {conversation.pinned && (
            <PinIcon size={13} className="shrink-0 text-text-tertiary" title="Pinned" />
          )}
          {conversation.muted && (
            <MuteIcon
              size={13}
              className="shrink-0 text-text-tertiary"
              // Says how long, not just that. The row has no space for the
              // sentence, so it is the tooltip and the accessible name.
              title={formatMuteUntil(conversation.mutedUntil) ?? 'Muted'}
            />
          )}

          <span
            className={cn(
              'shrink-0 text-caption',
              hasUnread ? 'font-medium text-brand' : 'text-text-tertiary',
            )}
          >
            {formatConversationTimestamp(conversation.updatedAt)}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1.5">
          {isTyping ? (
            <span className="flex items-center gap-2 text-caption text-brand">
              <PingoDot state="typing" size={5} />
              {formatTypingLabel(conversation.typingUserIds, users)}
            </span>
          ) : (
            <>
              {/*
                Delivery state for our own last message. Read is brand-coloured;
                everything earlier stays grey, so "they've seen it" is the only
                state that draws the eye.
              */}
              {lastMessageIsMine &&
                lastMessage &&
                (lastMessage.status === 'read' ? (
                  <CheckDoubleIcon size={14} className="shrink-0 text-brand" title="Read" />
                ) : lastMessage.status === 'delivered' ? (
                  <CheckDoubleIcon
                    size={14}
                    className="shrink-0 text-text-tertiary"
                    title="Delivered"
                  />
                ) : (
                  <CheckIcon size={14} className="shrink-0 text-text-tertiary" title="Sent" />
                ))}

              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-caption',
                  hasUnread ? 'text-ink' : 'text-text-secondary',
                )}
              >
                {preview}
              </span>
            </>
          )}

          {hasUnread && (
            <Badge
              count={conversation.unreadCount}
              // Muted threads still count, but quietly — that is what mute means.
              tone={conversation.muted ? 'neutral' : 'brand'}
              className="shrink-0"
              srSuffix="unread messages"
            />
          )}
        </div>
      </div>
    </>
  );

  const shell = cn(
    'group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left',
    'focus-ring transition-colors duration-instant ease-standard',
    selected
      ? 'bg-selected'
      : active
        ? 'bg-selected'
        : 'hover:bg-hover active:bg-pressed',
  );

  /*
   * A tick on the left, and the row lifts slightly.
   *
   * The lift is what stops a selected row reading as merely "hovered" — the
   * tint alone is the same colour the active desktop row already uses, so
   * without it the two states would be indistinguishable in the two-pane layout.
   */
  const marker = selectable && (
    <span
      aria-hidden
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full border',
        'transition-colors duration-instant',
        selected ? 'border-brand bg-brand text-white' : 'border-line-strong',
      )}
    >
      {selected && <CheckIcon size={13} />}
    </span>
  );

  if (selectable) {
    return (
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onToggleSelect}
        className={cn(shell, selected && 'shadow-sm ring-1 ring-brand/25')}
      >
        {marker}
        {body}
      </button>
    );
  }

  return (
    <Link
      to={`/chats/${conversation.id}`}
      aria-current={active ? 'page' : undefined}
      {...longPress}
      className={shell}
    >
      {body}
    </Link>
  );
}
