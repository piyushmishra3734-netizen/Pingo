import { useSyncExternalStore } from 'react';

/**
 * PINGO AI's reply while it is still being written.
 *
 * The Edge Function streams the reply piece by piece (`delta` events); this
 * holds the text so far, per conversation, and the thread draws it as a
 * bubble that grows - ChatGPT's way - until the real message arrives and takes
 * its place. Nothing here is stored: it is a view of a request in flight.
 */

const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function appendAiDraft(conversationId: string, piece: string) {
  drafts.set(conversationId, (drafts.get(conversationId) ?? '') + piece);
  emit();
}

export function clearAiDraft(conversationId: string) {
  if (!drafts.has(conversationId)) return;
  drafts.delete(conversationId);
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useAiDraft(conversationId: string): string {
  return useSyncExternalStore(
    subscribe,
    () => drafts.get(conversationId) ?? '',
    () => '',
  );
}
