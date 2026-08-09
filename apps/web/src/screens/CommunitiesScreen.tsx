import { formatPresence, useChat, useProfile, type User } from '@pingo/core';
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
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { canAccessCommunities } from '../lib/community-access.js';

/**
 * Communities and contacts.
 *
 * Allowlisted only (`canAccessCommunities`). Everyone else is sent home; the
 * dock slot that used to open this screen now opens Notifications.
 *
 * Two sections, one screen. Group and community conversations come first as cards,
 * because they are destinations; individual contacts follow as a plain list,
 * because they are a directory you scan for a name.
 *
 * Search is name, @handle, *or* user / group id. Local contacts are narrowed
 * immediately; when that is empty (or partial) the server is asked the same way
 * New Chat is - otherwise typing a real id for someone outside the first 100
 * contacts looked broken.
 */
export function CommunitiesScreen() {
  const { service, conversations, users, currentUser } = useChat();
  const { profile, service: profiles } = useProfile();
  const [query, setQuery] = useState('');
  const allowed = canAccessCommunities(profile?.username);

  /*
   * The whole directory, not just people already in a conversation.
   *
   * `useChat().users` is a cache built from threads that exist, so searching it
   * could only ever find someone you had already messaged - which made the
   * search field look broken for exactly the case it is for. `listContacts()`
   * reads `profiles`, so everyone on PINGO is findable (within its limit);
   * server `search` fills in the rest when you type.
   */
  const [directory, setDirectory] = useState<User[]>();
  const [directoryError, setDirectoryError] = useState<string>();
  const [found, setFound] = useState<User[]>([]);

  useEffect(() => {
    if (!allowed) return;
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
  }, [service, allowed]);

  const people = directory ?? users;
  const q = query.trim().toLowerCase().replace(/^@/u, '');

  useEffect(() => {
    const term = query.trim().replace(/^@/u, '');
    setFound([]);
    if (!allowed || term.length < 2) return;

    let active = true;
    const timer = window.setTimeout(() => {
      void profiles
        .search(term)
        .then((results) => {
          if (!active) return;
          setFound(
            results.map((p) => ({
              id: p.id,
              name: p.displayName,
              handle: p.username,
              ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}),
              presence: { state: 'offline' as const, lastSeenAt: 0 },
            })),
          );
        })
        .catch(() => undefined);
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [profiles, query, allowed]);

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

  const personMatches = (u: User) =>
    !q ||
    u.name.toLowerCase().includes(q) ||
    u.handle.toLowerCase().includes(q) ||
    u.id.toLowerCase().includes(q);

  const groups = useMemo(
    () =>
      conversations.filter((c) => {
        if (c.kind !== 'group' && c.kind !== 'community') return false;
        if (!q) return true;
        if (c.title.toLowerCase().includes(q)) return true;
        if (c.id.toLowerCase().includes(q)) return true;
        // Member name / handle / id - searching for a friend finds their groups.
        return c.participantIds.some((id) => {
          if (id.toLowerCase().includes(q)) return true;
          const person = people.find((u) => u.id === id) ?? users.find((u) => u.id === id);
          if (!person) return false;
          return (
            person.name.toLowerCase().includes(q) ||
            person.handle.toLowerCase().includes(q) ||
            person.id.toLowerCase().includes(q)
          );
        });
      }),
    [conversations, q, people, users],
  );

  const contacts = useMemo(() => {
    const local = people.filter(
      (u) => u.id !== currentUser?.id && personMatches(u),
    );
    const known = new Set(local.map((u) => u.id));
    if (currentUser) known.add(currentUser.id);
    const remote = found.filter((u) => !known.has(u.id));
    return [...local, ...remote];
    // personMatches closes over q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, currentUser, q, found]);

  const loadingPeople = directory === undefined && !directoryError && users.length === 0;
  const nothingFound = !loadingPeople && groups.length === 0 && contacts.length === 0;

  if (!allowed) {
    return <Navigate to="/chats" replace />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <ScreenHeader title="Communities" />

      <div className="mx-auto w-full max-w-2xl px-5 py-4">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, @username, or id"
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
              q
                ? `Nothing found for "${query.trim()}". Try their @username or full user id.`
                : 'Groups and contacts will appear here.'
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
                              people={members.map((m) => ({
                                id: m.id,
                                name: m.name,
                                src: m.avatarUrl,
                              }))}
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
                            @{user.handle}
                            {q && user.id.toLowerCase().includes(q)
                              ? ` · ${user.id.slice(0, 8)}…`
                              : ` · ${formatPresence(user)}`}
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
