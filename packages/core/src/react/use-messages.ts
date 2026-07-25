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
  send: (body: string) => Promise<void>;
}

export function useMessages(conversationId: ConversationId | undefined): UseMessagesResult {
  const { service } = useChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // Load history whenever the open conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void service
      .listMessages(conversationId)
      .then((history) => {
        // Guard against a slow response for a thread the user already left.
        if (active) setMessages(history);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [service, conversationId]);

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
    });
  }, [service, conversationId]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed || !conversationId) return;
      // State updates arrive via the message:new event, so nothing to set here.
      await service.sendMessage({ conversationId, body: trimmed });
    },
    [service, conversationId],
  );

  const groups = useMemo(() => groupMessages(messages), [messages]);

  return { messages, groups, loading, send };
}
