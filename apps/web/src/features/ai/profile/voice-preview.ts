import { getSupabaseClient } from '../../../lib/supabase/client.js';

/**
 * A few seconds of a call voice, from `ai-realtime` (action `preview`): the
 * same OpenAI voices a call uses, saying hello in the call language at the
 * chosen speed. One plays at a time; starting another stops the first.
 */
let current: { audio: HTMLAudioElement; url: string } | undefined;

export function stopVoicePreview(): void {
  if (!current) return;
  current.audio.pause();
  URL.revokeObjectURL(current.url);
  current = undefined;
}

export async function playVoicePreview(opts: { voice: string; speed: number; language: string | null }, onEnd: () => void): Promise<void> {
  stopVoicePreview();
  /*
   * A plain fetch, not functions.invoke: invoke reads an audio/mpeg answer as
   * text, so the Blob check below always failed and no preview ever played.
   */
  const client = getSupabaseClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!session?.access_token || !base || !anon) throw new Error('Sign in again to hear the voices.');
  const res = await fetch(`${base}/functions/v1/ai-realtime`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'preview', voice: opts.voice, speed: opts.speed, language: opts.language }),
  }).catch(() => undefined);
  const data = res?.ok && (res.headers.get('Content-Type') ?? '').startsWith('audio/') ? await res.blob() : undefined;
  if (!data || data.size < 500) {
    throw new Error("Couldn't play that voice right now.");
  }
  const url = URL.createObjectURL(data);
  const audio = new Audio(url);
  audio.playbackRate = 1;
  current = { audio, url };
  const done = () => {
    if (current?.audio === audio) stopVoicePreview();
    onEnd();
  };
  audio.addEventListener('ended', done, { once: true });
  audio.addEventListener('error', done, { once: true });
  await audio.play();
}
