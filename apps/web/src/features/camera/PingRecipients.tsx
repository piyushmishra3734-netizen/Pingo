import { useChat, useProfile, type Conversation } from '@pingo/core';
import { Avatar, CheckIcon, PinIcon, SearchField, SendIcon, UsersIcon, cn } from '@pingo/ui';
import { useMemo, useState } from 'react';

import { useMutuals } from '../profile/useMutuals.js';

/**
 * Who the Ping goes to.
 *
 * ## Why this is one screen and not a tap-to-send list
 *
 * The old version sent on every tap: three friends meant three sends, three
 * spinners and three chances to mis-tap something irreversible. Sending a Ping
 * is one decision about one picture, so the picture is chosen once, the people
 * are chosen together, and one button commits all of it.
 *
 * ## The order is the whole feature
 *
 * Pinned first, then whoever you have spoken to most recently, then groups.
 * That is not a preference — it is what makes the screen disappear. The person
 * you are about to Ping is almost always somebody you were talking to a minute
 * ago, and if they are the first row nobody ever reaches the search box.
 *
 * ## Why some chats are missing
 *
 * A Ping needs a mutual follow, so a thread you can message is not necessarily
 * one you can Ping. Those are filtered out rather than shown disabled: a list
 * of greyed-out names is a roster of people who have not followed you back, and
 * that is not something to put on somebody's screen.
 */

export interface PingRecipientsProps {
  selected: Set<string>;
  onToggle: (conversationId: string) => void;
}

export function PingRecipients({ selected, onToggle }: PingRecipientsProps) {
  const { conversations, users } = useChat();
  const { profile } = useProfile();
  const mutuals = useMutuals();

  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();

    const partnerOf = (conversation: Conversation) =>
      users.find(
        (user) => conversation.participantIds.includes(user.id) && user.id !== profile?.id,
      );

    return conversations
      .filter((conversation) => {
        if (conversation.archived) return false;

        // Groups are open to anyone in them; a direct chat needs the follow.
        if (conversation.kind !== 'direct') return true;
        const other = conversation.participantIds.find((id) => id !== profile?.id);
        return Boolean(other && mutuals?.has(other));
      })
      .map((conversation) => {
        const partner = partnerOf(conversation);
        return {
          id: conversation.id,
          name: partner?.name ?? conversation.title,
          group: conversation.kind !== 'direct',
          pinned: conversation.pinned,
          at: conversation.updatedAt,
          avatarId: partner?.id ?? conversation.id,
          avatarUrl: partner?.avatarUrl ?? conversation.avatarUrl,
        };
      })
      .filter((row) => !term || row.name.toLowerCase().includes(term))
      .sort((a, b) => {
        // Anything already chosen stays put at the top, so a long list cannot
        // scroll a selection out of sight and make it look undone.
        const picked = Number(selected.has(b.id)) - Number(selected.has(a.id));
        if (picked !== 0) return picked;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.group !== b.group) return a.group ? 1 : -1;
        return b.at - a.at;
      });
  }, [conversations, users, profile?.id, mutuals, query, selected]);

  return (
    <>
      <SearchField
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search"
        aria-label="Search people and groups"
      />

      {rows.length === 0 ? (
        <p className="py-8 text-center text-caption text-text-tertiary">
          {query.trim()
            ? 'Nobody matching that.'
            : 'No one to Ping yet. A Ping needs you and the other person to follow each other.'}
        </p>
      ) : (
        <ul className="mt-2 space-y-0.5" aria-label="Send to">
          {rows.map((row) => {
            const on = selected.has(row.id);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => onToggle(row.id)}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                    'transition-colors duration-instant hover:bg-hover active:bg-pressed',
                  )}
                >
                  <Avatar name={row.name} id={row.avatarId} src={row.avatarUrl} size="sm" />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-body text-ink">{row.name}</span>
                      {row.pinned && (
                        <PinIcon size={12} className="shrink-0 text-text-tertiary" />
                      )}
                    </span>
                    {row.group && (
                      <span className="flex items-center gap-1 text-caption text-text-secondary">
                        <UsersIcon size={11} /> Group
                      </span>
                    )}
                  </span>

                  <span
                    aria-hidden
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full border-2',
                      'transition-[background-color,border-color,transform] duration-instant',
                      on ? 'scale-110 border-brand bg-brand text-white' : 'border-line',
                    )}
                  >
                    {on && <CheckIcon size={14} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * The commit button.
 *
 * Deliberately large, deliberately fixed to the bottom, and deliberately
 * counting: "Send to 3" is the difference between a button and a decision you
 * can check before you make it.
 */
export function PingSendButton({
  count,
  busy,
  onSend,
}: {
  count: number;
  busy: boolean;
  onSend: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSend}
      disabled={count === 0 || busy}
      className={cn(
        'focus-ring flex w-full items-center justify-center gap-2 rounded-full',
        'bg-brand-gradient py-4 text-body font-medium text-white shadow-brand',
        'transition-transform duration-instant ease-standard active:scale-[0.98]',
        (count === 0 || busy) && 'opacity-45',
      )}
    >
      <SendIcon size={19} />
      {busy ? 'Sending…' : count === 0 ? 'Select someone' : `Send to ${count}`}
    </button>
  );
}
