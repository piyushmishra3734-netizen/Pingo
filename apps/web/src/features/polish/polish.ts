import { getSupabaseClient } from '../../lib/supabase/client.js';

export type PolishMode = 'grammar' | 'formal' | 'casual' | 'shorten' | 'expand' | 'translate';

export const POLISH_MODES: { mode: Exclude<PolishMode, 'translate'>; label: string; hint: string }[] = [
  { mode: 'grammar', label: 'Fix grammar', hint: 'Typos and spelling, same vibe' },
  { mode: 'formal', label: 'Formal', hint: 'Polite, for work' },
  { mode: 'casual', label: 'Casual', hint: 'Relaxed, like a friend' },
  { mode: 'shorten', label: 'Shorten', hint: 'Same meaning, fewer words' },
  { mode: 'expand', label: 'Expand', hint: 'More detail, still natural' },
];

export const MAX_POLISH_CHARS = 1500;

/** One request, one result. Throws a message that is safe to show. */
export async function polish(mode: PolishMode, text: string, target?: string): Promise<string> {
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
