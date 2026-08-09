import { useChat, type Story } from '@pingo/core';
import { Avatar, CheckIcon, SearchField, cn } from '@pingo/ui';
import { useMemo, useState } from 'react';

import { Sheet, SheetCancel } from '../../components/Sheet.js';
import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * Passing a story on to a friend or a group.
 *
 * ## Why this sends a link and not the picture
 *
 * Forwarding the media would make a copy that outlives the story - the whole
 * point of which is that it does not outlive the day. Worse, it would route
 * round the audience: a close-friends story handed to somebody outside the list
 * would arrive as bytes with no rule attached. So a share is a message pointing
 * at the author, and whoever receives it sees the story only if the story's own
 * audience already allowed it.
 *
 * That is also why there are no repost chains. There is nothing to re-share  - 
 * only the same link, which anybody could have sent.
 *
 * ## What "the audience permits it" means here
 *
 * A story to specific people, or to close friends, is not shareable at all: it
 * was addressed, and passing the address on is not the sender's to do. Friends
 * and public stories can be shared, because both are already visible to a group
 * the author did not enumerate.
 */

export function ShareStorySheet({ story, onClose }: { story: Story; onClose: () => void }) {
  const { conversations, users, service } = useChat();

  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  const restricted = story.audience === 'close' || story.audience === 'custom';

  const targets = useMemo(() => {
    const term = query.trim().toLowerCase();

    return conversations
      .filter((conversation) => !conversation.archived)
      .map((conversation) => {
        // A direct chat is titled after the other person, so its name comes
        // from the roster rather than from the row.
        const partnerId = conversation.participantIds.find((id) => id !== story.authorId);
        const partner =
          conversation.kind === 'direct'
            ? users.find((user) => conversation.participantIds.includes(user.id))
            : undefined;

        return {
          id: conversation.id,
          name: partner?.name ?? conversation.title,
          kind: conversation.kind,
          avatarId: partner?.id ?? partnerId ?? conversation.id,
          avatarUrl: partner?.avatarUrl ?? conversation.avatarUrl,
        };
      })
      .filter((target) => !term || target.name.toLowerCase().includes(term));
  }, [conversations, users, query, story.authorId]);

  const send = async () => {
    if (chosen.size === 0 || sending) return;
    setSending(true);
    setError(undefined);
    try {
      const link = publicAppUrl(`/profile/${story.authorUsername}`);
      await Promise.all(
        [...chosen].map((conversationId) =>
          service.sendMessage({
            conversationId,
            body: `${story.authorName}'s story - ${link}`,
          }),
        ),
      );
      setSent(true);
      window.setTimeout(onClose, 900);
    } catch {
      setError('That did not send. Try again.');
      setSending(false);
    }
  };

  if (restricted) {
    return (
      <Sheet
        title="This story cannot be shared"
        description={
          story.audience === 'close'
            ? 'It went to close friends only. Passing it on is not yours to do.'
            : 'It was sent to specific people. Passing it on is not yours to do.'
        }
        onClose={onClose}
        elevated
      >
        <div className="mt-4">
          <SheetCancel onClick={onClose} label="Done" />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title="Share this story"
      description="Sends a link to their profile - not a copy of the picture."
      onClose={onClose}
      elevated
    >
      <div className="mt-3">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
        />
      </div>

      {targets.length === 0 ? (
        <p className="py-8 text-center text-caption text-text-tertiary">
          {query.trim() ? 'No chats matching that.' : 'No chats to share with yet.'}
        </p>
      ) : (
        <ul className="mt-2 max-h-[40vh] space-y-0.5 overflow-y-auto">
          {targets.map((target) => {
            const on = chosen.has(target.id);
            return (
              <li key={target.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() =>
                    setChosen((previous) => {
                      const next = new Set(previous);
                      if (on) next.delete(target.id);
                      else next.add(target.id);
                      return next;
                    })
                  }
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left',
                    'transition-colors duration-instant hover:bg-hover active:bg-pressed',
                  )}
                >
                  <Avatar
                    name={target.name}
                    id={target.avatarId}
                    src={target.avatarUrl}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{target.name}</span>
                    <span className="block truncate text-caption text-text-secondary">
                      {target.kind === 'direct' ? 'Chat' : 'Group'}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full border-2',
                      'transition-colors duration-instant',
                      on ? 'border-brand bg-brand text-white' : 'border-line',
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

      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void send()}
          disabled={chosen.size === 0 || sending || sent}
          className={cn(
            'focus-ring w-full rounded-full px-5 py-3 text-body font-medium',
            'bg-brand-gradient text-white shadow-brand',
            'transition-transform duration-instant active:scale-[0.98]',
            (chosen.size === 0 || sending || sent) && 'opacity-50',
          )}
        >
          {sent ? 'Sent' : sending ? 'Sending…' : `Send${chosen.size ? ` to ${chosen.size}` : ''}`}
        </button>
        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}
