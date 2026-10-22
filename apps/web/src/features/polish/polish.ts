import { getSupabaseClient } from '../../lib/supabase/client.js';

export type PolishMode = 'grammar' | 'formal' | 'casual' | 'shorten' | 'expand' | 'translate';

export const MAX_POLISH_CHARS = 1500;

/**
 * Every call costs OpenAI tokens and a round trip, so the same question is never
 * asked twice: finished answers are remembered, and a second ask while the first
 * is still on its way shares its answer.
 *
 * Translations also survive a reload (a thread of foreign messages should not be
 * re-translated every time it is opened); rewrites of a draft do not, because a
 * draft is rarely the same twice and is not worth storing.
 */
const STORE = 'pingo:tx1';
const STORE_MAX = 80;
const MEMORY_MAX = 120;

const memory = new Map<string, string>();
const flying = new Map<string, Promise<string>>();

function readStore(): [string, string][] {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as [string, string][]) : [];
  } catch {
    return [];
  }
}

function remember(key: string, value: string, persist: boolean): void {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
  if (!persist) return;
  try {
    const rows = readStore().filter(([k]) => k !== key);
    rows.push([key, value]);
    localStorage.setItem(STORE, JSON.stringify(rows.slice(-STORE_MAX)));
  } catch {
    // storage full or blocked: the in-memory copy still works
  }
}

/** A finished answer for this exact request, if one is held. */
export function cachedPolish(mode: PolishMode, text: string, target?: string): string | undefined {
  const key = `${mode}|${target ?? ''}|${text}`;
  const hit = memory.get(key);
  if (hit !== undefined) return hit;
  if (mode !== 'translate') return undefined;
  const stored = readStore().find(([k]) => k === key)?.[1];
  if (stored !== undefined) memory.set(key, stored);
  return stored;
}

/** One request, one result. Throws a message that is safe to show. */
export function polish(mode: PolishMode, text: string, target?: string): Promise<string> {
  const key = `${mode}|${target ?? ''}|${text}`;
  const hit = cachedPolish(mode, text, target);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = flying.get(key);
  if (pending) return pending;

  const request = ask(mode, text, target)
    .then((out) => {
      remember(key, out, mode === 'translate');
      return out;
    })
    .finally(() => flying.delete(key));
  flying.set(key, request);
  return request;
}

async function ask(mode: PolishMode, text: string, target?: string): Promise<string> {
  const { data, error } = await getSupabaseClient().functions.invoke<{ text?: string; error?: string }>('polish', {
    body: { mode, text, ...(target ? { target } : {}) },
  });
  if (error || !data?.text) {
    // A non-2xx answer comes back as an error whose body is the JSON the function sent.
    const body = await (error as { context?: Response } | null)?.context?.json?.().catch(() => undefined);
    const code = (body as { error?: string } | undefined)?.error ?? data?.error;
    if (code === 'rate-limited') throw new Error('You have used a lot of Polish this hour. Try again later.');
    if (code === 'too-long') throw new Error('That is too long to process.');
    throw new Error('That did not work. Try again.');
  }
  return data.text;
}
