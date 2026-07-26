/**
 * Per-conversation message state.
 *
 * Kept out of ChatProvider on purpose: a message arriving in one thread must not
 * re-render the whole application. This hook owns one thread's history, applies
 * live events to it, and exposes the send path.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useChat } from './chat-provider.js';
import { groupMessages } from '../format.js';
import type { ConversationId, Message } from '../types.js';

interface UseMessagesResult {
  messages: Message[];
  /** Messages pre-clustered by author and time, ready to render. */
  groups: Message[][];
  loading: boolean;
  /** True while an older page is in flight, so the thread can say so. */
  loadingOlder: boolean;
  /** False once a page comes back short — there is nothing further back. */
  hasOlder: boolean;
  /** Fetches the page before the oldest message held. Safe to call repeatedly. */
  loadOlder: () => Promise<void>;
  send: (body: string, replyToId?: string) => Promise<void>;
  /** Posts a sticker. `body` carries its emoji as the text fallback. */
  sendSticker: (sticker: { id: string; url: string; body: string }) => Promise<void>;
}

/**
 * How many messages a page holds.
 *
 * Stated here rather than left to the service's default because `hasOlder`
 * is decided by comparing the page's length against it — a caller that does not
 * know the size cannot tell a short page from a full one.
 */
const PAGE_SIZE = 50;

export function useMessages(conversationId: ConversationId | undefined): UseMessagesResult {
  const { service } = useChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);

  // Load history whenever the open conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setHasOlder(true);

    void service
      .listMessages(conversationId, { limit: PAGE_SIZE })
      .then((history) => {
        // Guard against a slow response for a thread the user already left.
        if (!active) return;
        setMessages(history);
        setHasOlder(history.length >= PAGE_SIZE);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [service, conversationId]);

  /*
   * Older history, on demand.
   *
   * This is the half that was missing. `listMessages` has always taken a
   * `before` cursor and nothing ever passed one, so a thread stopped at fifty
   * messages and everything earlier was simply unreachable — which reads
   * exactly like old messages deleting themselves. Nothing was ever deleted;
   * the rows are all still there.
   */
  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!conversationId || !oldest || loadingOlder || !hasOlder) return;

    setLoadingOlder(true);
    try {
      const page = await service.listMessages(conversationId, {
        limit: PAGE_SIZE,
        before: oldest.id,
      });

      setHasOlder(page.length >= PAGE_SIZE);
      if (page.length === 0) return;

      setMessages((previous) => {
        // A live arrival can land between the request and its answer, so the
        // join is by id rather than by trusting the two halves not to overlap.
        const known = new Set(previous.map((m) => m.id));
        return [...page.filter((m) => !known.has(m.id)), ...previous];
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [service, conversationId, messages, loadingOlder, hasOlder]);

  // Opening a thread clears its unread count.
  useEffect(() => {
    if (conversationId) void service.markConversationRead(conversationId);
  }, [service, conversationId]);

  // Live message events for this thread only.
  useEffect(() => {
    if (!conversationId) return;

    return service.subscribe((event) => {
      if (event.type === 'message:new') {
        if (event.message.conversationId !== conversationId) return;
        setMessages((previous) =>
          // The service echoes our own optimistic sends, so de-duplicate by id.
          previous.some((m) => m.id === event.message.id)
            ? previous
            : [...previous, event.message],
        );
      }

      if (event.type === 'message:updated') {
        if (event.message.conversationId !== conversationId) return;
        setMessages((previous) =>
          previous.map((m) => (m.id === event.message.id ? event.message : m)),
        );
      }

      // "Delete for me" leaves the row alone for everyone else, so this is a
      // local removal rather than a state the message itself carries.
      if (event.type === 'message:removed') {
        setMessages((previous) => previous.filter((m) => m.id !== event.messageId));
      }
    });
  }, [service, conversationId]);

  const send = useCallback(
    async (body: string, replyToId?: string) => {
      const trimmed = body.trim();
      if (!trimmed || !conversationId) return;
      // State updates arrive via the message:new event, so nothing to set here.
      await service.sendMessage({
        conversationId,
        body: trimmed,
        ...(replyToId ? { replyToId } : {}),
      });
    },
    [service, conversationId],
  );

  const sendSticker = useCallback(
    async (sticker: { id: string; url: string; body: string }) => {
      if (!conversationId) return;
      await service.sendMessage({
        conversationId,
        body: sticker.body,
        sticker: { id: sticker.id, url: sticker.url },
      });
    },
    [service, conversationId],
  );

  const groups = useMemo(() => groupMessages(messages), [messages]);

  return { messages, groups, loading, loadingOlder, hasOlder, loadOlder, send, sendSticker };
}
