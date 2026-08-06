import { useChat, type User, useProfile } from '@pingo/core';
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
 * That one omission is why chats, calls and Pings were all unreachable for a
 * new contact - every one of them needs a conversation to hang off.
 *
 * ## Nothing is listed until you search
 *
 * This screen used to open with every account on PINGO scrolling down it. That
 * is a user directory, and publishing one is a decision nobody made: it hands
 * any new sign-up the full membership list, and it puts people who have no wish
 * to be browsed in front of strangers. You reach somebody here because you
 * already know who you are looking for, so an empty screen with a search field
 * is not a missing feature - it is the correct starting state.
 *
 * ## Filtering happens here; finding happens on the server
 *
 * `listContacts()` is still fetched once and narrowed as you type, because a
 * round trip per keystroke would make the results flicker and lag behind the
 * field. It just no longer renders on its own.
 *
 * And a list can only be narrowed to what is in it. Typing somebody's exact
 * @username or pasting their id said "nobody by that name" whenever they were
 * not already a contact - which is precisely when you would be typing it. So
 * when the local filter comes up empty the server is asked, once the typing
 * settles, and whoever it returns is appended to the results.
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
  const { service: profiles } = useProfile();

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

  /** Whether there is anything to show at all. Blank field means blank screen. */
  const searching = query.trim().length > 0;

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!people) return undefined;
    if (!term) return [];
    return people.filter(
      (person) =>
        person.name.toLowerCase().includes(term) ||
        person.handle.toLowerCase().includes(term),
    );
  }, [people, query]);

  /**
   * Somebody the roster has never heard of.
   *
   * Narrowing a list can only ever find what is already in it, so typing an
   * exact @handle for a person you have not spoken to returned "no matches" —
   * about somebody who exists, spelled correctly, whom the database would have
   * returned instantly. Asked for only when the local filter comes up empty,
   * and only once the typing settles: one request at the end of a word rather
   * than one per keystroke. `find` takes a handle *or* an id, which is why
   * pasting somebody's id works too.
   */
  const [found, setFound] = useState<User[]>([]);

  useEffect(() => {
    const term = query.trim().replace(/^@/u, '');
    setFound([]);
    /*
     * Two characters, and always asked.
     *
     * This used to require three and to give up entirely as soon as the local
     * filter matched anything - so typing two letters of a stranger's name
     * found nobody, and typing a name shared with one of your own contacts
     * found only the contact. Both are the search saying "no such person"
     * about people who exist.
     */
    if (term.length < 2) return;

    let active = true;
    const timer = window.setTimeout(() => {
      void profiles
        .search(term)
        .then((results) => {
          if (!active) return;
          setFound(
            results.map((profile) => ({
              id: profile.id,
              name: profile.displayName,
              handle: profile.username,
              ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
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
    // `matches` is deliberately not a dependency any more: the search runs
    // whatever the local filter found, so re-running it when that list changes
    // would only repeat the same request.
  }, [profiles, query]);

  /*
   * Contacts first, then everybody else the search turned up.
   *
   * Appended rather than replacing, so a search matching one contact and three
   * strangers shows all four - and de-duplicated, because somebody you have
   * spoken to before is in both lists and should appear once, in the place
   * that knows whether they are online.
   */
  const shown = useMemo(() => {
    if (!matches) return undefined;
    const known = new Set(matches.map((person) => person.id));
    return [...matches, ...found.filter((person) => !known.has(person.id))];
  }, [matches, found]);

  const open = async (person: User) => {
    if (opening) return;
    setOpening(person.id);
    setError(undefined);
    try {
      const conversationId = await service.startDirectConversation(person.id);
      // `replace`, so Back returns to the chat list rather than to this picker  - 
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

        {/*
          The resting state is a prompt, not a spinner and not a roster. The
          roster may still be loading behind this, and nobody needs to know:
          there is nothing to wait for until something is typed.
        */}
        {!searching ? (
          <EmptyState
            title="Who are you looking for?"
            description="Search by name, @username, or paste their ID."
            icon={<UsersIcon size={26} />}
          />
        ) : !shown ? (
          <LoadingState label="Searching" />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nobody by that name"
            description="Check the spelling, or try their @username."
            icon={<UsersIcon size={26} />}
          />
        ) : (
          <ul className="space-y-0.5">
            {shown.map((person, index) => (
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
