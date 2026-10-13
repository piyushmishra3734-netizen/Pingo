import { cn } from '@pingo/ui';
import { Check, Loader2, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LANGUAGES } from '../personalities.js';
import { AI_VOICES, saveAiPrefs, useAiPrefs } from '../room/ai-prefs.js';
import { clampSpeed, speedLabel, VOICE_SPEED } from './ai-profile-model.js';
import { Card, SectionLabel, TopBar } from './pastel.js';
import { playVoicePreview, stopVoicePreview } from './voice-preview.js';

/**
 * How PINGO AI sounds on a call: the realtime voice, its speed and the
 * language it speaks, saved to `ai_profiles` and read by `ai-realtime` when a
 * call starts. Each voice can be heard first.
 */
export function VoicePage({ onBack }: { onBack: () => void }) {
  const { prefs } = useAiPrefs();
  const voice = prefs.voice ?? 'marin';
  const [speed, setSpeed] = useState(clampSpeed(prefs.voice_speed ?? 1));
  const language = prefs.voice_language ?? null;
  const [playing, setPlaying] = useState<string>();
  const [loadingVoice, setLoadingVoice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => setSpeed(clampSpeed(prefs.voice_speed ?? 1)), [prefs.voice_speed]);
  useEffect(() => () => stopVoicePreview(), []);

  const save = async (patch: Parameters<typeof saveAiPrefs>[0]) => {
    setError(undefined);
    const err = await saveAiPrefs(patch);
    if (err) setError(err);
  };

  const preview = async (id: string) => {
    if (playing === id) {
      stopVoicePreview();
      setPlaying(undefined);
      return;
    }
    setError(undefined);
    setLoadingVoice(id);
    try {
      await playVoicePreview({ voice: id, speed, language: language ?? prefs.language ?? 'en' }, () => setPlaying((p) => (p === id ? undefined : p)));
      setPlaying(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't play that voice right now.");
    } finally {
      setLoadingVoice(undefined);
    }
  };

  return (
    <>
      <TopBar title="Voice" onBack={onBack} />
      <div className="pp-pad flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
        <SectionLabel>Call voice</SectionLabel>
        <Card>
          <div role="radiogroup" aria-label="Call voice" className="divide-y divide-[var(--pp-line)]">
            {AI_VOICES.map((v) => {
              const on = voice === v.id;
              return (
                <div key={v.id} className={cn('flex items-center gap-3 px-3 py-2.5', on && 'bg-[var(--pp-accent-soft)]')}>
                  <button
                    type="button"
                    aria-label={playing === v.id ? `Stop ${v.label}` : `Hear ${v.label}`}
                    onClick={() => void preview(v.id)}
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--pp-field)] text-[var(--pp-accent)] active:scale-95"
                  >
                    {loadingVoice === v.id ? <Loader2 size={18} className="animate-spin" /> : playing === v.id ? <Square size={15} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                  </button>
                  <button type="button" role="radio" aria-checked={on} onClick={() => void save({ voice: v.id })} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16.5px] font-semibold">
                        {v.label}
                        {v.id === 'marin' && <span className="font-normal text-[var(--pp-sub)]"> (Default)</span>}
                      </span>
                      <span className="block text-[14px] text-[var(--pp-sub)]">{v.hint}</span>
                    </span>
                    {on && <Check size={20} strokeWidth={2.6} className="text-[var(--pp-accent)]" aria-hidden />}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <SectionLabel>
          <span className="mt-4 flex items-baseline justify-between">
            Speed <span className="text-[14px] font-medium text-[var(--pp-sub)]">{speedLabel(speed)} · {speed.toFixed(2)}x</span>
          </span>
        </SectionLabel>
        <Card className="px-4 py-4">
          <input
            type="range"
            min={VOICE_SPEED.min}
            max={VOICE_SPEED.max}
            step={VOICE_SPEED.step}
            value={speed}
            aria-label="Speaking speed"
            onChange={(e) => setSpeed(clampSpeed(Number(e.target.value)))}
            onPointerUp={() => void save({ voice_speed: speed })}
            onKeyUp={() => void save({ voice_speed: speed })}
            className="w-full accent-[var(--pp-accent)]"
          />
          <div className="mt-1 flex justify-between text-[13px] text-[var(--pp-sub)]">
            <span>Slower</span>
            <span>Normal</span>
            <span>Faster</span>
          </div>
        </Card>

        <SectionLabel>
          <span className="mt-4 block">Call language</span>
        </SectionLabel>
        <Card>
          <div role="radiogroup" aria-label="Call language" className="divide-y divide-[var(--pp-line)]">
            {[{ id: '', label: 'Same as chat' }, ...LANGUAGES].map((l) => {
              const on = (language ?? '') === l.id;
              return (
                <button
                  key={l.id || 'auto'}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => void save({ voice_language: l.id || null })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-[16px]"
                >
                  <span className="flex-1">{l.label}</span>
                  {on && <Check size={20} strokeWidth={2.6} className="text-[var(--pp-accent)]" aria-hidden />}
                </button>
              );
            })}
          </div>
        </Card>
        <p className="mt-2 px-1 text-[13px] text-[var(--pp-sub)]">Used from your next call with Pingo.</p>
        {error && (
          <p role="alert" className="mt-2 text-center text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
