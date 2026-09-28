import { useChat, useProfile, type User } from '@pingo/core';
import { Avatar, CheckIcon, SearchField, cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';

/**
 * A searchable list of people with ticks.
 *
 * Three sheets need exactly this - close friends, hide-my-story-from, and the
 * audience for a specific-people story - and they differ only in what a tick
 * means. Building it three times would be three subtly different search boxes
 * and three chances for one of them to forget the empty state.
 *
 * ## Why it does not own the selection
 *
 * The caller does. Close friends and hidden-from write to the server on every
 * tick, because they are settings; the audience picker holds its selection
 * until the story is posted, because nothing exists to attach it to yet. A
 * component that owned the set would have to grow a mode for that difference.
 */

export function PeoplePicker({
  selected,
  onToggle,
  /** Narrows the list; absent shows everybody the user knows. */
  only,
  ids,
  emptyLabel,
  busy,
}: {
  selected: Set<string>;
  onToggle: (userId: string, next: boolean) => void;
  only?: (user: User) => boolean;
  /**
   * Exactly these people, looked up by id.
   *
   * The chat's own list of users only holds people this device has chatted
   * with and loaded, so a friend you have never messaged was missing - and on
   * a fresh install the story settings showed nobody at all. Given the ids,
   * anybody the chat does not know is fetched from their profile.
   */
  ids?: readonly string[];
  emptyLabel: string;
  busy?: boolean;
}) {
  const { users: known } = useChat();
  const { service: profiles } = useProfile();
  const [query, setQuery] = useState('');
  const [fetched, setFetched] = useState<User[]>([]);

  const idsKey = ids?.join(',') ?? '';
  useEffect(() => {
    if (!ids) return;
    let active = true;
    const missing = ids.filter((id) => !known.some((u) => u.id === id));
    void Promise.all(missing.map((id) => profiles.find(id).catch(() => null))).then((found) => {
      if (!active) return;
      setFetched(
        found
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .map((p) => ({ id: p.id, name: p.displayName || p.username, handle: p.username, presence: { state: 'offline', lastSeenAt: 0 }, ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}) })),
      );
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids
  }, [idsKey, profiles]);

  const users = useMemo(() => {
    if (!ids) return known;
    const wanted = new Set(ids);
    const byId = new Map<string, User>();
    for (const user of [...fetched, ...known]) if (wanted.has(user.id)) byId.set(user.id, user);
    return [...byId.values()];
  }, [ids, known, fetched]);

  const people = useMemo(() => {
    const term = query.trim().toLowerCase();
    return users
      .filter((user) => (only ? only(user) : true))
      .filter(
        (user) =>
          !term ||
          user.name.toLowerCase().includes(term) ||
          user.handle.toLowerCase().includes(term),
      )
      /*
       * Chosen people first, and then alphabetically.
       *
       * A list of forty where the six that are ticked are scattered through it
       * makes "who is on this list?" a scrolling exercise. Floating them keeps
       * the answer at the top, which is the question the sheet exists to
       * answer.
       */
      .sort((a, b) => {
        const picked = Number(selected.has(b.id)) - Number(selected.has(a.id));
        if (picked !== 0) return picked;
        return a.name.localeCompare(b.name);
      });
  }, [users, query, only, selected]);

  return (
    <>
      <div className="mt-3">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people"
          aria-label="Search people"
        />
      </div>

      {people.length === 0 ? (
        <p className="py-8 text-center text-caption text-text-tertiary">
          {query.trim() ? `Nobody matching “${query.trim()}”.` : emptyLabel}
        </p>
      ) : (
        <ul className="mt-2 max-h-[45vh] space-y-0.5 overflow-y-auto">
          {people.map((user) => {
            const on = selected.has(user.id);
            return (
              <li key={user.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  disabled={busy}
                  onClick={() => onToggle(user.id, !on)}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left',
                    'transition-colors duration-instant hover:bg-hover active:bg-pressed',
                    busy && 'opacity-60',
                  )}
                >
                  <Avatar name={user.name} id={user.id} src={user.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{user.name}</span>
                    <span className="block truncate text-caption text-text-secondary">
                      @{user.handle}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full border-2',
                      'transition-colors duration-instant',
                      on ? 'border-brand bg-brand text-on-brand' : 'border-line',
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
