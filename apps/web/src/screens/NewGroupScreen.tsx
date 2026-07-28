import { useChat, type User } from '@pingo/core';
import {
  Avatar,
  Button,
  CheckIcon,
  ChevronLeftIcon,
  EmptyState,
  IconButton,
  LoadingState,
  SearchField,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useMutuals } from '../features/profile/useMutuals.js';

/**
 * Making a group.
 *
 * ## Only friends are listed, and the screen says why
 *
 * Adding somebody to a group reaches into their app without asking, so it takes
 * a mutual follow — the same test stories use. The alternative would be a full
 * contact list with two thirds of it refusing to be tapped, which teaches
 * nothing except that the app is unreliable.
 *
 * The cost of that rule is that the people you have not met yet cannot be added
 * at all, and half the reason groups exist is those people. That is what the
 * invite link is for, and the empty state points at it rather than leaving
 * somebody stuck: make the group, then share the link.
 *
 * ## Name first, people second
 *
 * A group with no name cannot be created, so the field that blocks the button
 * is the field the cursor starts in. Picking eight people and then discovering
 * you owe the form a name is the order that wastes the effort.
 */
export function NewGroupScreen() {
  const navigate = useNavigate();
  const { service } = useChat();
  const mutuals = useMutuals();

  const [people, setPeople] = useState<User[] | undefined>();
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void service
      .listContacts()
      .then((list) => {
        if (active) setPeople(list);
      })
      .catch(() => {
        if (active) setPeople([]);
      });
    return () => {
      active = false;
    };
  }, [service]);

  /*
   * Friends only, and not until we know who they are.
   *
   * `useMutuals` returns `undefined` while it is still asking, and treating
   * that as "no friends" would flash the empty state at everybody on every
   * load — which reads as having no friends rather than as loading.
   */
  const friends = useMemo(() => {
    if (!people || !mutuals) return undefined;
    return people.filter((person) => mutuals.has(person.id));
  }, [people, mutuals]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!friends) return undefined;
    if (!term) return friends;
    return friends.filter(
      (person) =>
        person.name.toLowerCase().includes(term) ||
        person.handle.toLowerCase().includes(term),
    );
  }, [friends, query]);

  const toggle = (id: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    const name = title.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(undefined);
    try {
      const conversationId = await service.createGroup({
        title: name,
        memberIds: [...picked],
      });
      // `replace`, so Back goes to the chat list rather than back into a form
      // for a group that now exists.
      navigate(`/chats/${conversationId}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <header
        className={cn(
          'sticky top-0 z-100 shrink-0',
          'glass-surface border-x-0 border-t-0 border-b-line',
          'px-3 pt-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]',
        )}
      >
        <div className="flex items-center gap-1">
          <IconButton label="Back" variant="ghost" onClick={() => navigate('/chats')}>
            <ChevronLeftIcon size={22} />
          </IconButton>
          <h1 className="text-h2 text-ink">New group</h1>
        </div>

        <div className="mt-3 px-1">
          <label htmlFor="group-name" className="sr-only">
            Group name
          </label>
          <input
            id="group-name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={60}
            placeholder="Group name"
            autoFocus
            className={cn(
              'w-full rounded-md border border-border bg-surface px-3.5 py-2.5 text-body',
              'placeholder:text-text-tertiary',
              'transition-colors duration-quick',
              'focus:border-brand focus:outline-none',
            )}
          />
        </div>

        <div className="mt-2.5 px-1">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search friends"
            aria-label="Search friends"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error && (
          <p role="alert" className="mb-2 px-1 text-caption text-danger">
            {error}
          </p>
        )}

        {matches === undefined ? (
          <LoadingState label="Loading friends" />
        ) : matches.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={28} />}
            title={query.trim() ? 'Nobody by that name' : 'No friends to add yet'}
            /*
             * Not a dead end. A group can be made empty and filled from a link,
             * which is the only route open to someone whose friends list is
             * empty — saying so here is the difference between a rule and a wall.
             */
            description={
              query.trim()
                ? 'Only friends can be added directly.'
                : 'Make the group anyway, then share its invite link — anyone can join with it, friend or not.'
            }
          />
        ) : (
          <ul className="flex flex-col">
            {matches.map((person) => {
              const on = picked.has(person.id);
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(person.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left',
                      'transition-colors duration-quick',
                      'hover:bg-surface-hover active:bg-surface-active',
                    )}
                  >
                    <Avatar
                      name={person.name}
                      id={person.id}
                      src={person.avatarUrl}
                      size="md"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body">{person.name}</span>
                      <span className="block truncate text-caption text-text-tertiary">
                        @{person.handle}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full border',
                        'transition-colors duration-quick',
                        on
                          ? 'border-brand bg-brand text-on-brand'
                          : 'border-border text-transparent',
                      )}
                    >
                      <CheckIcon size={14} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div
        className={cn(
          'shrink-0 border-t border-line bg-surface px-4 py-3',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        )}
      >
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!title.trim() || busy}
          onClick={() => void create()}
        >
          {busy
            ? 'Creating…'
            : picked.size === 0
              ? 'Create group'
              : `Create with ${picked.size}`}
        </Button>
      </div>
    </div>
  );
}
