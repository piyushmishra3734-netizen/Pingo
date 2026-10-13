import type { AiMood, AiSource } from '@pingo/core';
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
/** The sources cited so far, for a reply that searched the web. */
const draftSources = new Map<string, AiSource[]>();
const NO_SOURCES: AiSource[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function appendAiDraft(conversationId: string, piece: string) {
  drafts.set(conversationId, (drafts.get(conversationId) ?? '') + piece);
  emit();
}

/** Replaced whole: the stream sends the full list each time a source is added. */
export function setAiDraftSources(conversationId: string, sources: AiSource[]) {
  draftSources.set(conversationId, sources);
  emit();
}

export function clearAiDraft(conversationId: string) {
  if (!drafts.has(conversationId) && !draftSources.has(conversationId)) return;
  drafts.delete(conversationId);
  draftSources.delete(conversationId);
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

/** The growing reply's sources, for the UI to show under the draft before the message lands. */
export function useAiDraftSources(conversationId: string): AiSource[] {
  return useSyncExternalStore(
    subscribe,
    () => draftSources.get(conversationId) ?? NO_SOURCES,
    () => NO_SOURCES,
  );
}

/*
 * The face PINGO AI chose for its latest reply, per conversation. Kept after
 * the draft is cleared: the character keeps that face until the next turn.
 * After a reload the same mood is on the message itself (`aiMeta.mood`).
 */
const moods = new Map<string, AiMood>();

export function setAiMood(conversationId: string, mood: AiMood) {
  moods.set(conversationId, mood);
  emit();
}

export function useAiMood(conversationId: string): AiMood | undefined {
  return useSyncExternalStore(
    subscribe,
    () => moods.get(conversationId),
    () => undefined,
  );
}
