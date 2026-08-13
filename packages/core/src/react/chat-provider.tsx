/**
 * ChatProvider - the composition root for data.
 *
 * This is the *only* place in the product that knows which ChatService
 * implementation is in use. Screens receive a `ChatService`; they never import
 * `MockChatService`. Swapping in a real backend is a one-line change here.
 *
 * The provider owns the state that more than one screen needs - the signed-in
 * user, the conversation list, connection status - and keeps it current from the
 * push event stream. Per-thread message state is deliberately *not* here; it
 * lives in `useMessages` so that opening a conversation doesn't re-render the
 * whole app.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ChatEvent, ChatService, ConnectionState } from '../chat-service.js';
import { MockChatService } from '../mock-chat-service.js';
import type { Conversation, CurrentUser, User } from '../types.js';

interface ChatContextValue {
  service: ChatService;
  currentUser: CurrentUser | undefined;
  /** Everyone the signed-in user knows. Needed to resolve names and presence. */
  users: User[];
  conversations: Conversation[];
  connection: ConnectionState;
  /** False until the first load of user + conversations settles. */
  ready: boolean;
  /** Total unread across all conversations - drives the dock badge. */
  totalUnread: number;
  refresh: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

interface ChatProviderProps {
  children: ReactNode;
  /** Injectable for tests and for the eventual real implementation. */
  service?: ChatService;
}

export function ChatProvider({ children, service: injected }: ChatProviderProps) {
  // Created once per provider lifetime. A ref rather than state because the
  // service is an identity, not a value that renders.
  const serviceRef = useRef<ChatService | undefined>(undefined);
  serviceRef.current ??= injected ?? new MockChatService();
  const service = serviceRef.current;

  const [currentUser, setCurrentUser] = useState<CurrentUser | undefined>();
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [connection, setConnection] = useState<ConnectionState>(() =>
    service.connectionState(),
  );
  const [ready, setReady] = useState(false);
  /** Whether the last thing we saw was a loss, so a `connected` means recovery. */
  const wasDisconnected = useRef(false);

  const load = useCallback(async () => {
    const [user, contacts, list] = await Promise.all([
      service.getCurrentUser(),
      service.listContacts(),
      service.listConversations(),
    ]);
    setCurrentUser(user);
    setUsers(contacts);
    setConversations(list);

    // Recorded for the next cold launch. Deliberately not awaited: the screen
    // is already correct by this point and writing to disk is not the user's
    // problem.
    void service.cacheStartup({ currentUser: user, users: contacts, conversations: list, at: Date.now() });
  }, [service]);

  useEffect(() => {
    let active = true;
    /*
     * Disk first, network second, and the network always wins.
     *
     * Measured before this change: the home screen waited 2311.8ms at the
     * median for three network calls to settle, and first-interaction landed
     * within 3ms of that - so the main thread was idle the whole time and the
     * wait was purely the network. Reading the same three things back from the
     * sealed cache is one decrypt.
     *
     * `settled` is what keeps it honest. The cache is far quicker so it lands
     * first essentially always, and essentially is not always: a stale
     * snapshot painted over a fresh load would show older conversations the
     * longer someone waited, which is the one outcome worse than a spinner.
     */
    let settled = false;

    void service
      .cachedStartup()
      .then((snapshot) => {
        if (!active || settled || !snapshot) return;
        setCurrentUser(snapshot.currentUser);
        setUsers(snapshot.users);
        setConversations(snapshot.conversations);
        // Ready, because there is a usable screen. Whether it is the final one
        // is not something a spinner can usefully communicate.
        setReady(true);
      })
      // The cache is an optimisation and an optimisation may not take the app
      // down with it. This is the offline path, where the load below is *also*
      // failing, so an unhandled rejection here is the launch.
      .catch(() => undefined);

    void load()
      .then(() => {
        settled = true;
      })
      .catch(() => {
        // Offline, or the server is down. Whatever the cache painted stands,
        // and every screen surfaces its own failure - there is nothing useful
        // to do here except not become an unhandled rejection.
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [load, service]);

  // Live updates. Conversation-level events are applied in place so the list
  // never flickers or loses scroll position.
  useEffect(() => {
    const unsubscribe = service.subscribe((event: ChatEvent) => {
      switch (event.type) {
        case 'conversation:updated': {
          setConversations((previous) => {
            const next = previous.some((c) => c.id === event.conversation.id)
              ? previous.map((c) =>
                  c.id === event.conversation.id ? event.conversation : c,
                )
              : [...previous, event.conversation];

            // Same ordering rule as the service: pinned first, then recency.
            return [...next].sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              return b.updatedAt - a.updatedAt;
            });
          });
          break;
        }

        case 'conversation:removed': {
          setConversations((previous) =>
            previous.filter((c) => c.id !== event.conversationId),
          );
          break;
        }

        case 'presence:changed': {
          setUsers((previous) =>
            previous.map((u) =>
              u.id === event.userId ? { ...u, presence: event.presence } : u,
            ),
          );
          break;
        }

        case 'typing:changed': {
          setConversations((previous) =>
            previous.map((c) =>
              c.id === event.conversationId
                ? { ...c, typingUserIds: event.userIds, typingActivity: event.activity }
                : c,
            ),
          );
          break;
        }

        case 'connection:changed': {
          setConnection(event.state);

          /*
           * Back online means the list is behind by however long we were gone.
           *
           * `conversation:updated` events are the only thing that had kept it
           * current, and none of them arrive over a socket that is not there -
           * so a phone returning from another app showed the previews, unread
           * counts and ordering from the moment it left. Reading once on the
           * way back is what makes the chat list agree with the threads inside
           * it.
           *
           * Guarded on the transition rather than the state: `connected` is
           * emitted on the first subscribe too, and reloading there would
           * duplicate the initial load on every launch.
           */
          if (event.state === 'connected' && wasDisconnected.current) {
            void load().catch(() => undefined);
          }
          wasDisconnected.current = event.state !== 'connected';
          break;
        }

        // message:* is handled by useMessages, which owns thread state.
        default:
          break;
      }
    });

    return unsubscribe;
  }, [service]);

  // Release the mock's pending timers when the tree unmounts.
  useEffect(() => {
    return () => {
      if ('dispose' in service && typeof service.dispose === 'function') {
        (service.dispose as () => void)();
      }
    };
  }, [service]);

  const totalUnread = useMemo(
    () =>
      conversations.reduce(
        (sum, c) => sum + (c.muted ? 0 : c.unreadCount),
        0,
      ),
    [conversations],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      service,
      currentUser,
      users,
      conversations,
      connection,
      ready,
      totalUnread,
      refresh: load,
    }),
    [service, currentUser, users, conversations, connection, ready, totalUnread, load],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used inside a <ChatProvider>');
  return context;
}
