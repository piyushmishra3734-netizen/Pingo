import { useChat, type User } from '@pingo/core';
import {
  Avatar,
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

/**
 * Start a new direct conversation.
 *
 * Until this existed there was no way to message anyone you had not already
 * messaged: `startDirectConversation` lived only on the Supabase implementation
 * and never reached the `ChatService` interface, so no screen could see it.
 * That one omission is why chats, calls and snaps were all unreachable for a
 * new contact — every one of them needs a conversation to hang off.
 *
 * ## Filtering happens here, not on the server
 *
 * `listContacts()` is fetched once and narrowed as you type. A round trip per
 * keystroke would make the list flicker and lag behind the field for a roster
 * this size, and `search()` caps at ten results — fine for finding someone by
 * name, wrong for browsing everyone.
 *
 * ## Tapping is idempotent
 *
 * The database decides whether a thread already exists. Two quick taps cannot
 * make two conversations, and reopening someone you have spoken to lands in the
 * thread you already have rather than an empty one beside it.
 */
export function NewChatScreen() {
  const navigate = useNavigate();
  const { service } = useChat();

  const [people, setPeople] = useState<User[] | undefined>();
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string>();
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

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!people) return undefined;
    if (!term) return people;
    return people.filter(
      (person) =>
        person.name.toLowerCase().includes(term) ||
        person.handle.toLowerCase().includes(term),
    );
  }, [people, query]);

  const open = async (person: User) => {
    if (opening) return;
    setOpening(person.id);
    setError(undefined);
    try {
      const conversationId = await service.startDirectConversation(person.id);
      // `replace`, so Back returns to the chat list rather than to this picker —
      // reopening it after landing in the thread is never what someone means.
      navigate(`/chats/${conversationId}`, { replace: true });
    } catch {
      setError(`Couldn't open a chat with ${person.name}.`);
      setOpening(undefined);
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
          <h1 className="text-h2 text-ink">New chat</h1>
        </div>

        <div className="mt-3 px-1">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or @username"
            aria-label="Search people"
            autoFocus
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error && (
          <p role="alert" className="mb-2 px-1 text-caption text-danger">
            {error}
          </p>
        )}

        {!matches ? (
          <LoadingState label="Loading people" />
        ) : matches.length === 0 ? (
          <EmptyState
            title={query ? 'Nobody by that name' : 'Nobody here yet'}
            description={
              query
                ? 'Check the spelling, or try their @username.'
                : 'When other people join PINGO they will show up here.'
            }
            icon={<UsersIcon size={26} />}
          />
        ) : (
          <ul className="space-y-0.5">
            {matches.map((person, index) => (
              <li
                key={person.id}
                className="animate-row-in"
                style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
              >
                <button
                  type="button"
                  onClick={() => void open(person)}
                  disabled={Boolean(opening)}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                    'transition-colors duration-instant hover:bg-hover',
                    // Only the row being opened dims; the rest stay legible.
                    opening && opening !== person.id && 'opacity-50',
                  )}
                >
                  <Avatar name={person.name} id={person.id} src={person.avatarUrl} size="md" />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{person.name}</span>
                    <span className="block truncate text-caption text-text-secondary">
                      @{person.handle}
                    </span>
                  </span>

                  {opening === person.id && (
                    <span className="text-caption text-text-tertiary">Opening…</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
