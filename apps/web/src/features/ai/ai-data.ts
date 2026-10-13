/**
 * PINGO AI drawer data: Recents (side chats), goals and the media library.
 *
 * Data only; the screens are built on top. Each hook loads once on mount,
 * keeps itself current from the chat event stream, and applies its own
 * mutations at once (rolling back if the write fails), so the screens never
 * have to refresh by hand. `refresh()` is there for pull-to-refresh.
 *
 * A backend without these optional service methods yields empty lists with
 * `supported: false`.
 */

import {
  useChat,
  type AiChatSummary,
  type AiGoal,
  type AiLibraryItem,
  type ChatEvent,
  type Conversation,
  type ConversationId,
} from '@pingo/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PINGO_AI_USER_ID } from './ai-mentions.js';
import { messageSnippet } from './ai-recents.js';

/** Bursts of events (a streamed reply, a tool turn) fold into one reload. */
const SETTLE_MS = 600;

const LIBRARY_PAGE = 60;

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String((cause as { message?: string })?.message ?? cause));
}

/** A trailing-edge timer that dies with the component. */
function useSettled(run: () => void): () => void {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => latest.current(), SETTLE_MS);
  }, []);
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

export interface AiChatsState {
  /** The main PINGO AI thread first (`main: true`), then side chats, newest first. */
  chats: AiChatSummary[];
  loading: boolean;
  error: Error | undefined;
  supported: boolean;
  refresh: () => Promise<void>;
  /** A new side chat; navigate to `/chats/${id}`. */
  create: () => Promise<ConversationId>;
  rename: (id: ConversationId, title: string) => Promise<void>;
  remove: (id: ConversationId) => Promise<void>;
}

export function useAiChats(): AiChatsState {
  const { service } = useChat();
  const supported = typeof service.listAiChats === 'function';
  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState<Error | undefined>();
  const known = useRef(new Set<ConversationId>());
  known.current = new Set(chats.map((chat) => chat.id));

  const refresh = useCallback(async () => {
    if (!service.listAiChats) return;
    try {
      const next = await service.listAiChats();
      setChats(next);
      setError(undefined);
    } catch (cause) {
      setError(asError(cause));
    } finally {
      setLoading(false);
    }
  }, [service]);

  const settle = useSettled(() => void refresh());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      service.subscribe((event: ChatEvent) => {
        if (event.type === 'conversation:removed') {
          if (known.current.has(event.conversationId)) {
            setChats((previous) => previous.filter((chat) => chat.id !== event.conversationId));
          }
          return;
        }
        if (event.type !== 'conversation:updated' || event.conversation.kind !== 'ai') return;
        const c = event.conversation;
        // One we have not listed (just created, or from another device): read the list again.
        if (!known.current.has(c.id)) {
          settle();
          return;
        }
        // Otherwise the event carries everything a row shows.
        setChats((previous) => sortChats(previous.map((chat) => (chat.id === c.id ? patchChat(chat, c) : chat))));
      }),
    [service, settle],
  );

  const create = useCallback(async () => {
    if (!service.createAiChat) throw new Error('Side chats are not available.');
    const id = await service.createAiChat();
    setChats((previous) =>
      previous.some((chat) => chat.id === id)
        ? previous
        : sortChats([
            ...previous,
            { id, title: 'New chat', snippet: '', updatedAt: Date.now(), main: false, unreadCount: 0 },
          ]),
    );
    return id;
  }, [service]);

  const rename = useCallback(
    async (id: ConversationId, title: string) => {
      if (!service.renameAiChat) throw new Error('Side chats are not available.');
      const clean = title.replace(/\s+/g, ' ').trim();
      let before: AiChatSummary[] = [];
      setChats((previous) => {
        before = previous;
        return previous.map((chat) => (chat.id === id ? { ...chat, title: clean } : chat));
      });
      try {
        await service.renameAiChat(id, clean);
      } catch (cause) {
        setChats(before);
        throw cause;
      }
    },
    [service],
  );

  const remove = useCallback(
    async (id: ConversationId) => {
      if (!service.deleteAiChat) throw new Error('Side chats are not available.');
      let before: AiChatSummary[] = [];
      setChats((previous) => {
        before = previous;
        return previous.filter((chat) => chat.id !== id);
      });
      try {
        await service.deleteAiChat(id);
      } catch (cause) {
        setChats(before);
        throw cause;
      }
    },
    [service],
  );

  return { chats, loading, error, supported, refresh, create, rename, remove };
}

/** A Recents row brought up to date from a live conversation. */
function patchChat(chat: AiChatSummary, c: Conversation): AiChatSummary {
  return {
    ...chat,
    ...(c.aiSide && c.aiChatTitle ? { title: c.aiChatTitle } : {}),
    ...(!c.aiSide && chat.main ? { title: c.title } : {}),
    ...(c.lastMessage ? { snippet: messageSnippet(c.lastMessage, PINGO_AI_USER_ID) } : {}),
    updatedAt: Math.max(chat.updatedAt, c.lastMessage?.createdAt ?? 0, c.updatedAt),
    unreadCount: c.unreadCount,
  };
}

function sortChats(chats: AiChatSummary[]): AiChatSummary[] {
  return [
    ...chats.filter((chat) => chat.main),
    ...chats.filter((chat) => !chat.main).sort((a, b) => b.updatedAt - a.updatedAt),
  ];
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface AiGoalsState {
  /** Newest first. */
  goals: AiGoal[];
  loading: boolean;
  error: Error | undefined;
  supported: boolean;
  refresh: () => Promise<void>;
  add: (title: string) => Promise<AiGoal>;
  setDone: (id: string, done: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useAiGoals(): AiGoalsState {
  const { service } = useChat();
  const supported = typeof service.listAiGoals === 'function';
  const [goals, setGoals] = useState<AiGoal[]>([]);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState<Error | undefined>();

  const refresh = useCallback(async () => {
    if (!service.listAiGoals) return;
    try {
      setGoals(await service.listAiGoals());
      setError(undefined);
    } catch (cause) {
      setError(asError(cause));
    } finally {
      setLoading(false);
    }
  }, [service]);

  const settle = useSettled(() => void refresh());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * PINGO AI adds and completes goals from a chat turn ("add a goal to learn
   * tennis"). Its reply is the moment that turn is over, so a reply from it
   * is when the list is read again.
   */
  useEffect(
    () =>
      service.subscribe((event: ChatEvent) => {
        if (event.type === 'message:new' && event.message.authorId === PINGO_AI_USER_ID) settle();
      }),
    [service, settle],
  );

  const add = useCallback(
    async (title: string) => {
      if (!service.addAiGoal) throw new Error('Goals are not available.');
      const goal = await service.addAiGoal(title);
      setGoals((previous) => [goal, ...previous.filter((g) => g.id !== goal.id)]);
      return goal;
    },
    [service],
  );

  const setDone = useCallback(
    async (id: string, done: boolean) => {
      if (!service.setAiGoalDone) throw new Error('Goals are not available.');
      let before: AiGoal[] = [];
      setGoals((previous) => {
        before = previous;
        return previous.map((g) => {
          if (g.id !== id) return g;
          const { doneAt: _old, ...rest } = g;
          return done ? { ...rest, done, doneAt: Date.now() } : { ...rest, done };
        });
      });
      try {
        await service.setAiGoalDone(id, done);
      } catch (cause) {
        setGoals(before);
        throw cause;
      }
    },
    [service],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!service.deleteAiGoal) throw new Error('Goals are not available.');
      let before: AiGoal[] = [];
      setGoals((previous) => {
        before = previous;
        return previous.filter((g) => g.id !== id);
      });
      try {
        await service.deleteAiGoal(id);
      } catch (cause) {
        setGoals(before);
        throw cause;
      }
    },
    [service],
  );

  return { goals, loading, error, supported, refresh, add, setDone, remove };
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface AiLibraryState {
  /** Newest first. */
  items: AiLibraryItem[];
  loading: boolean;
  /** A next page is being read. */
  loadingMore: boolean;
  hasMore: boolean;
  error: Error | undefined;
  supported: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useAiLibrary(): AiLibraryState {
  const { service, conversations } = useChat();
  /** Chats in the main list that are not PINGO AI's: their media is not the library's. */
  const others = useRef(new Set<ConversationId>());
  others.current = new Set(conversations.filter((c) => c.kind !== 'ai').map((c) => c.id));
  const supported = typeof service.listAiLibrary === 'function';
  const [items, setItems] = useState<AiLibraryItem[]>([]);
  const [loading, setLoading] = useState(supported);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const paging = useRef(false);

  const refresh = useCallback(async () => {
    if (!service.listAiLibrary) return;
    try {
      const page = await service.listAiLibrary({ limit: LIBRARY_PAGE });
      setItems(page);
      setHasMore(page.length >= LIBRARY_PAGE);
      setError(undefined);
    } catch (cause) {
      setError(asError(cause));
    } finally {
      setLoading(false);
    }
  }, [service]);

  const loadMore = useCallback(async () => {
    if (!service.listAiLibrary || paging.current) return;
    const last = itemsRef.current.at(-1);
    if (!last) return;
    paging.current = true;
    setLoadingMore(true);
    try {
      const page = await service.listAiLibrary({ before: last.createdAt, limit: LIBRARY_PAGE });
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.messageId));
        return [...previous, ...page.filter((item) => !seen.has(item.messageId))];
      });
      setHasMore(page.length >= LIBRARY_PAGE);
    } catch (cause) {
      setError(asError(cause));
    } finally {
      paging.current = false;
      setLoadingMore(false);
    }
  }, [service]);

  const settle = useSettled(() => void refresh());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * A picture PINGO AI drew, or a photo or file somebody sent it, is a new
   * first item. A media message in any chat that is not a known ordinary one
   * is the cue (side chats are not in the main list); the read decides.
   */
  useEffect(
    () =>
      service.subscribe((event: ChatEvent) => {
        if (event.type === 'conversation:removed') {
          setItems((previous) => previous.filter((item) => item.conversationId !== event.conversationId));
          return;
        }
        if (event.type !== 'message:new') return;
        const m = event.message;
        const media = Boolean(m.photo) || m.attachments.some((a) => a.kind === 'file');
        if (media && (m.authorId === PINGO_AI_USER_ID || !others.current.has(m.conversationId))) settle();
      }),
    [service, settle],
  );

  return { items, loading, loadingMore, hasMore, error, supported, refresh, loadMore };
}

// ---------------------------------------------------------------------------
// Opening a side chat by id
// ---------------------------------------------------------------------------

/**
 * The conversation behind `/chats/:id` when it is a PINGO AI side chat the
 * provider has not seen yet (a deep link, a notification, a Recents tap after
 * a reload). Kept current from the event stream until the provider has it.
 *
 * Pass `undefined` when the route already resolved, and nothing is read.
 * `pending` is true while the read is in flight, so the route can wait rather
 * than redirect.
 */
export function useAiConversation(id: ConversationId | undefined): {
  conversation: Conversation | undefined;
  pending: boolean;
} {
  const { service } = useChat();
  const [conversation, setConversation] = useState<Conversation | undefined>();
  /** The id whose read has finished. Pending is "not this one yet", true from the first render. */
  const [resolvedId, setResolvedId] = useState<ConversationId | undefined>();

  useEffect(() => {
    if (!id) return;
    let live = true;
    void service
      .getConversation(id)
      .then((found) => {
        if (live) setConversation(found?.aiSide ? found : undefined);
      })
      .catch(() => {
        if (live) setConversation(undefined);
      })
      .finally(() => {
        if (live) setResolvedId(id);
      });
    const unsubscribe = service.subscribe((event: ChatEvent) => {
      if (event.type === 'conversation:updated' && event.conversation.id === id && event.conversation.aiSide) {
        setConversation(event.conversation);
      } else if (event.type === 'conversation:removed' && event.conversationId === id) {
        setConversation(undefined);
      } else if (event.type === 'typing:changed' && event.conversationId === id) {
        setConversation((previous) =>
          previous ? { ...previous, typingUserIds: event.userIds, typingActivity: event.activity } : previous,
        );
      }
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [id, service]);

  return {
    conversation: id && conversation?.id === id ? conversation : undefined,
    pending: Boolean(id) && resolvedId !== id,
  };
}
