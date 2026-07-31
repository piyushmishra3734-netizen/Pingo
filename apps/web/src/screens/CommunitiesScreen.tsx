import { formatPresence, useChat, type User } from '@pingo/core';
import {
  Avatar,
  AvatarStack,
  Badge,
  Card,
  EmptyState,
  LoadingState,
  SearchField,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';

/**
 * Communities and contacts.
 *
 * Two sections, one screen. Group and community conversations come first as cards,
 * because they are destinations; individual contacts follow as a plain list,
 * because they are a directory you scan for a name.
 *
 * Notably absent: member counts as a badge of importance, activity graphs, "top
 * community" ranking. Nothing here is designed to make a user feel they are
 * missing out on a place they are not in.
 */
export function CommunitiesScreen() {
  const { service, conversations, users, currentUser } = useChat();
  const [query, setQuery] = useState('');

  /*
   * The whole directory, not just people already in a conversation.
   *
   * `useChat().users` is a cache built from threads that exist, so searching it
   * could only ever find someone you had already messaged - which made the
   * search field look broken for exactly the case it is for. `listContacts()`
   * reads `profiles`, so everyone on PINGO is findable.
   */
  const [directory, setDirectory] = useState<User[]>();
  const [directoryError, setDirectoryError] = useState<string>();

  useEffect(() => {
    let active = true;
    void service
      .listContacts()
      .then((list) => {
        if (active) setDirectory(list);
      })
      .catch((cause: unknown) => {
        /*
         * Reported, not swallowed.
         *
         * This used to fall back to the cached roster silently. When the fetch
         * failed the Contacts section simply did not render, which looks
         * exactly like "there is nobody here" and exactly like "search is
         * broken" - three different causes, one indistinguishable screen.
         */
        if (active) {
          setDirectoryError(cause instanceof Error ? cause.message : 'Could not load people.');
        }
      });
    return () => {
      active = false;
    };
  }, [service]);

  const people = directory ?? users;
  const q = query.trim().toLowerCase();

  const [opening, setOpening] = useState<string>();
  const [openError, setOpenError] = useState<string>();
  const navigate = useNavigate();

  const messageUser = async (user: User) => {
    if (opening) return;
    setOpening(user.id);
    setOpenError(undefined);
    try {
      // Idempotent in the database, so this lands in the existing thread when
      // there is one rather than making a second empty one beside it.
      const conversationId = await service.startDirectConversation(user.id);
      navigate(`/chats/${conversationId}`);
    } catch (cause) {
      /*
       * Shown, not swallowed.
       *
       * This had only a `finally`, so a failing RPC cleared the spinner and
       * left the screen exactly as it was - indistinguishable from the button
       * doing nothing at all, which is how it was reported. The reason is
       * surfaced because it is the difference between "not signed in",
       * "function missing" and "network", and guessing between those from a
       * blank screen is impossible.
       */
      setOpenError(
        cause instanceof Error ? cause.message : `Couldn't open a chat with ${user.name}.`,
      );
    } finally {
      setOpening(undefined);
    }
  };

  const groups = useMemo(
    () =>
      conversations.filter(
        (c) =>
          (c.kind === 'group' || c.kind === 'community') &&
          (!q || c.title.toLowerCase().includes(q)),
      ),
    [conversations, q],
  );

  const contacts = useMemo(
    () =>
      people.filter(
        (u) =>
          u.id !== currentUser?.id &&
          (!q || u.name.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q)),
      ),
    [people, currentUser, q],
  );

  const loadingPeople = directory === undefined && !directoryError && users.length === 0;
  const nothingFound = !loadingPeople && groups.length === 0 && contacts.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <ScreenHeader title="Communities" />

      <div className="mx-auto w-full max-w-2xl px-5 py-4">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people and groups"
          aria-label="Search people and groups"
        />

        {directoryError && (
          <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger">
            Could not load people: {directoryError}
          </p>
        )}

        {openError && (
          <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger">
            {openError}
          </p>
        )}

        {loadingPeople ? (
          <LoadingState label="Loading people" />
        ) : nothingFound ? (
          <EmptyState
            title={q ? 'No matches' : 'Nothing here yet'}
            description={
              q ? `Nothing found for "${query.trim()}".` : 'Groups and contacts will appear here.'
            }
            icon={<UsersIcon size={26} />}
          />
        ) : (
          <>
            {groups.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-3 px-1 text-caption font-medium uppercase tracking-wider text-text-tertiary">
                  Groups
                </h2>

                <div className="grid gap-3 sm:grid-cols-2">
                  {groups.map((conversation) => {
                    const members = users.filter((u) =>
                      conversation.participantIds.includes(u.id),
                    );

                    return (
                      <Link
                        key={conversation.id}
                        to={`/chats/${conversation.id}`}
                        className="focus-ring rounded-lg"
                      >
                        <Card interactive elevation="sm" className="h-full">
                          <div className="flex items-start justify-between gap-3">
                            <AvatarStack
                              people={members.map((m) => ({ id: m.id, name: m.name, src: m.avatarUrl }))}
                              size="sm"
                              max={3}
                            />
                            {conversation.unreadCount > 0 && (
                              <Badge
                                count={conversation.unreadCount}
                                srSuffix="unread messages"
                              />
                            )}
                          </div>

                          <p className="mt-3 truncate text-body font-medium text-ink">
                            {conversation.title}
                          </p>
                          <p className="mt-0.5 text-caption text-text-secondary">
                            {members.length} members
                            {conversation.kind === 'community' && ' · Community'}
                          </p>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {contacts.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-2 px-1 text-caption font-medium uppercase tracking-wider text-text-tertiary">
                  Contacts
                </h2>

                <div className="space-y-0.5">
                  {contacts.map((user) => (
                    <div
                      key={user.id}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-2',
                        'transition-colors duration-instant ease-standard hover:bg-hover',
                      )}
                    >
                      <Link
                        to={`/profile/${user.handle}`}
                        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg py-2.5"
                      >
                        <Avatar
                          name={user.name}
                          id={user.id}
                          src={user.avatarUrl}
                          size="md"
                          presence={user.presence.state === 'online' ? 'online' : undefined}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body text-ink">{user.name}</p>
                          <p className="mt-0.5 truncate text-caption text-text-secondary">
                            {formatPresence(user)}
                          </p>
                        </div>
                      </Link>

                      {/*
                        Finding someone and then having no way to reach them is
                        the whole reason this screen felt broken. The row still
                        opens their profile; this is the shortcut past it.
                      */}
                      <button
                        type="button"
                        onClick={() => void messageUser(user)}
                        disabled={Boolean(opening)}
                        className={cn(
                          'focus-ring shrink-0 rounded-full px-3 py-1.5',
                          'text-caption font-medium text-brand',
                          'hover:bg-selected disabled:opacity-50',
                        )}
                      >
                        {opening === user.id ? 'Opening…' : 'Message'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
