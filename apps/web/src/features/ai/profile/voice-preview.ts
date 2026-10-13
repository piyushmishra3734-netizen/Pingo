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
  const { data, error } = await getSupabaseClient().functions.invoke('ai-realtime', {
    body: { action: 'preview', voice: opts.voice, speed: opts.speed, language: opts.language },
  });
  if (error || !(data instanceof Blob) || data.size < 500) {
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
