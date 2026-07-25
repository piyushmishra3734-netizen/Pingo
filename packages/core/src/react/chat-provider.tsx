/**
 * ChatProvider — the composition root for data.
 *
 * This is the *only* place in the product that knows which ChatService
 * implementation is in use. Screens receive a `ChatService`; they never import
 * `MockChatService`. Swapping in a real backend is a one-line change here.
 *
 * The provider owns the state that more than one screen needs — the signed-in
 * user, the conversation list, connection status — and keeps it current from the
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
  /** Total unread across all conversations — drives the dock badge. */
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

  const load = useCallback(async () => {
    const [user, contacts, list] = await Promise.all([
      service.getCurrentUser(),
      service.listContacts(),
      service.listConversations(),
    ]);
    setCurrentUser(user);
    setUsers(contacts);
    setConversations(list);
  }, [service]);

  useEffect(() => {
    let active = true;
    void load().finally(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [load]);

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
              c.id === event.conversationId ? { ...c, typingUserIds: event.userIds } : c,
            ),
          );
          break;
        }

        case 'connection:changed': {
          setConnection(event.state);
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
