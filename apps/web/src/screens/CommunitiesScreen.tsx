import { formatPresence, useChat } from '@pingo/core';
import {
  Avatar,
  AvatarStack,
  Badge,
  Card,
  EmptyState,
  SearchField,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

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
  const { conversations, users, currentUser } = useChat();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

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
      users.filter(
        (u) =>
          u.id !== currentUser?.id &&
          (!q || u.name.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q)),
      ),
    [users, currentUser, q],
  );

  const nothingFound = groups.length === 0 && contacts.length === 0;

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

        {nothingFound ? (
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
                              people={members.map((m) => ({ id: m.id, name: m.name }))}
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
                    <Link
                      key={user.id}
                      to={`/profile/${user.handle}`}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-2 py-2.5',
                        'focus-ring transition-colors duration-instant ease-standard',
                        'hover:bg-hover active:bg-pressed',
                      )}
                    >
                      <Avatar
                        name={user.name}
                        id={user.id}
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
