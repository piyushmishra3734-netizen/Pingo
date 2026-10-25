import { cn } from '@pingo/ui';
import { Check, Music2, PlayCircle } from 'lucide-react';
import { useState } from 'react';

import { setMusicSource, type MusicSource } from '../ytm/source.js';

/**
 * The first time PINGO Music opens in the app: where should songs come from.
 *
 * Only asked where YouTube Music can work (the Android app). Either answer
 * can be changed later in Music settings, and neither is a lock: if the chosen
 * one cannot play a song, PINGO plays it from the other.
 */
const OPTIONS: { v: MusicSource; title: string; note: string; icon: typeof Music2 }[] = [
  { v: 'saavn', title: 'JioSaavn', note: 'Fast and steady. Bollywood, regional languages, albums and artists.', icon: Music2 },
  { v: 'ytm', title: 'YouTube Music', note: 'A huge catalogue: remixes, covers, live and rare songs. Works in the app.', icon: PlayCircle },
];

export function SourceChooser() {
  const [picked, setPicked] = useState<MusicSource>('ytm');
  return (
    <div role="dialog" aria-label="Choose where your music comes from" className="absolute inset-0 z-40 flex flex-col justify-end bg-black/45 animate-fadeIn">
      <div className="rounded-t-[28px] bg-page px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 shadow-2xl">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Where should your music come from?</h2>
        <p className="mt-1.5 text-[14px] text-text-secondary">You can change this any time in Music settings.</p>

        <div className="mt-5 flex flex-col gap-3">
          {OPTIONS.map((o) => {
            const on = picked === o.v;
            return (
              <button
                key={o.v}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(o.v)}
                className={cn('flex items-start gap-3.5 rounded-2xl border p-4 text-left transition', on ? 'border-ink bg-sunken' : 'border-line')}
              >
                <o.icon size={24} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{o.title}</span>
                  <span className="mt-0.5 block text-[13.5px] leading-snug text-text-secondary">{o.note}</span>
                </span>
                {on && <Check size={20} className="mt-0.5 shrink-0" />}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[12.5px] leading-snug text-text-tertiary">If one cannot play a song, PINGO plays it from the other, so the music keeps going.</p>

        <button type="button" onClick={() => setMusicSource(picked)} className="mt-5 h-12 w-full rounded-full bg-ink text-[15.5px] font-semibold text-page active:opacity-80">
          Continue
        </button>
      </div>
    </div>
  );
}
