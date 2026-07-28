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
import type { ReadReceipt } from '../chat-service.js';
import type { ConversationId, Message } from '../types.js';

interface UseMessagesResult {
  messages: Message[];
  /**
   * How far each other member has read, live.
   *
   * Kept beside the messages rather than folded into them because a group needs
   * to count readers ("Seen by 3"), and a status of `'read'` on a message can
   * only ever say "at least one".
   */
  receipts: ReadReceipt[];
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
  const [receipts, setReceipts] = useState<ReadReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);

  // Load history whenever the open conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setReceipts([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setHasOlder(true);

    // Where everyone had read up to at the moment the thread opened. Every
    // later move arrives on the socket, so this is asked once and never again.
    void service.listReceipts(conversationId).then((initial) => {
      if (active) setReceipts(initial);
    });

    /*
     * Cache first, network second, and the network always wins.
     *
     * Decrypting a fifty-message page costs about 56ms on a desktop and
     * several times that on a mid-range phone, every single time the thread is
     * opened. Reading the same page back from the sealed cache costs 0.4ms,
     * because it was decrypted once and stored decrypted-then-sealed. That is
     * the difference between a thread that appears and a thread that arrives.
     *
     * `settled` is what keeps the race honest. The cache is roughly a hundred
     * times faster so it lands first essentially always -- but essentially is
     * not always, and a cached page painted over a fresh one would show the
     * user older messages the longer they waited, which is the one outcome
     * worse than a spinner.
     */
    let settled = false;

    void service.cachedMessages(conversationId).then((cached) => {
      if (!active || settled || !cached) return;
      setMessages(cached);
      setHasOlder(cached.length >= PAGE_SIZE);
      // Loading ends here: there is a thread on screen, and whether it is the
      // final one is not something a spinner can usefully say.
      setLoading(false);
    });

    void service
      .listMessages(conversationId, { limit: PAGE_SIZE })
      .then((history) => {
        // Guard against a slow response for a thread the user already left.
        if (!active) return;
        settled = true;
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

      /*
       * Somebody read us while we were watching.
       *
       * Merged rather than replaced: the event carries only the member whose
       * cursor moved, so overwriting the list would forget everyone else's.
       * Cursors only ever move forward, and an out-of-order delivery would
       * otherwise walk a receipt backwards, so the newer time wins.
       */
      if (event.type === 'receipts:changed') {
        if (event.conversationId !== conversationId) return;
        setReceipts((previous) => {
          const merged = new Map(previous.map((r) => [r.userId, r.readAt]));
          let changed = false;
          for (const reader of event.readers) {
            if ((merged.get(reader.userId) ?? 0) >= reader.readAt) continue;
            merged.set(reader.userId, reader.readAt);
            changed = true;
          }
          // Returning the same array when nothing moved keeps a repeated
          // cursor update from re-rendering the whole thread.
          if (!changed) return previous;
          return [...merged].map(([userId, readAt]) => ({ userId, readAt }));
        });
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

  /*
   * The receipts, folded back onto the messages.
   *
   * `listMessages` stamps a status from the cursor as it stood when the thread
   * was fetched, and that stamp is frozen from then on. Deriving the upgrade
   * here instead means a cursor arriving over the socket repaints the ticks
   * immediately, with no refetch and nothing to keep in sync — the messages own
   * their text, the receipts own who has seen it, and neither has to know when
   * the other changed.
   *
   * Only `sent` is upgraded. `sending` and `failed` are facts about our own
   * outbox and are not anybody else's to overrule.
   */
  const furthestRead = useMemo(
    () => receipts.reduce((furthest, r) => Math.max(furthest, r.readAt), 0),
    [receipts],
  );

  const read = useMemo(() => {
    if (furthestRead === 0) return messages;
    let touched = false;
    const next = messages.map((message) => {
      if (message.status !== 'sent' || message.createdAt > furthestRead) return message;
      touched = true;
      return { ...message, status: 'read' as const };
    });
    return touched ? next : messages;
  }, [messages, furthestRead]);

  const groups = useMemo(() => groupMessages(read), [read]);

  return {
    messages: read,
    receipts,
    groups,
    loading,
    loadingOlder,
    hasOlder,
    loadOlder,
    send,
    sendSticker,
  };
}
