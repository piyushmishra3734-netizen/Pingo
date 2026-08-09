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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useT } from '../features/i18n/useT.js';
import { useMutuals } from '../features/profile/useMutuals.js';

/**
 * Making a group.
 *
 * ## Only friends are listed, and the screen says why
 *
 * Adding somebody to a group reaches into their app without asking, so it takes
 * a mutual follow - the same test stories use. The alternative would be a full
 * contact list with two thirds of it refusing to be tapped, which teaches
 * nothing except that the app is unreliable.
 *
 * The cost of that rule is that the people you have not met yet cannot be added
 * at all, and half the reason groups exist is those people. That is what the
 * invite link is for, and the empty state points at it rather than leaving
 * somebody stuck: make the group, then share the link.
 *
 * ## The name is required, and the screen has to say so
 *
 * A group cannot be created without one, so the cursor starts in that field.
 * That is not enough on its own: people go to the list first, pick somebody,
 * and press the button - and the first version answered by staying `disabled`
 * under a label that read "Create with 1", which is a control that looks
 * finished and does nothing. The button is now always pressable and says what
 * it is missing.
 */
export function NewGroupScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { service } = useChat();
  const mutuals = useMutuals();

  const [people, setPeople] = useState<User[] | undefined>();
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** Focused when the button is pressed without one, so the ask has a target. */
  const nameRef = useRef<HTMLInputElement>(null);

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
   * load - which reads as having no friends rather than as loading.
   */
  const friends = useMemo(() => {
    if (!people || !mutuals) return undefined;
    return people.filter((person) => mutuals.has(person.id));
  }, [people, mutuals]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^@/u, '');
    if (!friends) return undefined;
    if (!term) return friends;
    return friends.filter(
      (person) =>
        person.name.toLowerCase().includes(term) ||
        person.handle.toLowerCase().includes(term) ||
        person.id.toLowerCase().includes(term),
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
    if (busy) return;

    const name = title.trim();

    /*
     * Say why, rather than going quiet.
     *
     * This button used to be `disabled` until the group had a name, while its
     * label still counted the people you had picked - so choosing somebody made
     * it read "Create with 1" and do nothing, with no hint anywhere that a name
     * was what it was waiting for. Picking people is the part that feels like
     * the work, so it is exactly the moment you press it and find it dead.
     *
     * Same rule as the call buttons in a thread: present and pressable even
     * when it cannot proceed, because a greyed-out control cannot explain
     * itself. Pressing it now points at the field it needs.
     */
    if (!name) {
      setError('Give the group a name first.');
      nameRef.current?.focus();
      return;
    }

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
          <h1 className="text-h2 text-ink">{t('chats.newGroup')}</h1>
        </div>

        <div className="mt-3 px-1">
          <label htmlFor="group-name" className="sr-only">
            Group name
          </label>
          <input
            id="group-name"
            ref={nameRef}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              // Cleared on the first keystroke: a complaint that outlives the
              // thing it complained about reads as a second, unrelated problem.
              if (error) setError(undefined);
            }}
            maxLength={60}
            placeholder="Group name"
            autoFocus
            className={cn(
              'w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-body',
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
        {matches === undefined ? (
          <LoadingState label="Loading friends" />
        ) : matches.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={28} />}
            title={query.trim() ? 'Nobody by that name' : 'No friends to add yet'}
            /*
             * Not a dead end. A group can be made empty and filled from a link,
             * which is the only route open to someone whose friends list is
             * empty - saying so here is the difference between a rule and a wall.
             */
            description={
              query.trim()
                ? 'Only friends can be added directly.'
                : 'Make the group anyway, then share its invite link, anyone can join with it, friend or not.'
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
                          : 'border-line text-transparent',
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
        {/*
          Beside the button, not at the top of the list.

          It used to render above the friends, which is a scrolling region - so
          the answer to "why did nothing happen?" could be sitting several
          screens above the button that did nothing. This footer is pinned, so
          the reason appears exactly where the press did.
        */}
        {error && (
          <p role="alert" className="mb-2 text-caption text-danger">
            {error}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={busy}
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
