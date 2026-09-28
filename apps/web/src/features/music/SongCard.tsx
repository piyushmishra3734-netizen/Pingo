import { cn } from '@pingo/ui';
import { Music2, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { fmt } from './sheets.js';
import type { SharedSong } from './song-share.js';

/**
 * A song somebody sent, as a card that plays - Instagram's music message.
 *
 * The cover, blurred, is the card's own background, so every song gets its own
 * colour without anyone choosing one. Play, drag the bar to any point, skip ten
 * seconds either way, and change the speed; the song plays right here in the
 * thread.
 *
 * One song at a time across the whole app: starting a second card pauses the
 * first, as it would in any music app.
 */

const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;

let playing: HTMLAudioElement | undefined;

export function SongCard({ song, mine }: { song: SharedSong; mine: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(song.secs);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Created on first play, not on render: a thread full of songs must not fetch them all.
  const player = () => {
    if (!audio.current) {
      const a = new Audio();
      a.preload = 'none';
      a.src = song.url;
      a.addEventListener('timeupdate', () => setAt(a.currentTime));
      a.addEventListener('loadedmetadata', () => { if (Number.isFinite(a.duration)) setLength(a.duration); });
      a.addEventListener('playing', () => { setLoading(false); setOn(true); });
      a.addEventListener('waiting', () => setLoading(true));
      a.addEventListener('pause', () => setOn(false));
      a.addEventListener('ended', () => { setOn(false); setAt(0); a.currentTime = 0; });
      a.addEventListener('error', () => { setLoading(false); setOn(false); setFailed(true); });
      audio.current = a;
    }
    return audio.current;
  };

  useEffect(() => () => {
    const a = audio.current;
    if (a) { a.pause(); a.src = ''; if (playing === a) playing = undefined; }
  }, []);

  const toggle = () => {
    const a = player();
    if (!a.paused) { a.pause(); return; }
    if (playing && playing !== a) playing.pause();
    playing = a;
    setFailed(false);
    setLoading(true);
    a.playbackRate = speed;
    void a.play().catch(() => { setLoading(false); setFailed(true); });
  };

  const seek = (to: number) => {
    const a = player();
    const t = Math.min(Math.max(0, to), length || a.duration || 0);
    a.currentTime = t;
    setAt(t);
  };

  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const total = length || song.secs || 0;
  const pct = total ? Math.min(100, (at / total) * 100) : 0;

  return (
    <div className={cn('relative w-[268px] max-w-full overflow-clip rounded-[22px] text-white shadow-[0_6px_24px_rgba(16,17,20,0.18)]', mine ? 'self-end' : 'self-start')}>
      {/* The cover, blown up and blurred, is the card's colour. */}
      {song.img ? (
        <img src={song.img} alt="" aria-hidden className="absolute inset-0 size-full scale-150 object-cover blur-2xl" />
      ) : (
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(135deg,#8b5dff,#e0559b_55%,#ff9a5a)]" />
      )}
      <span aria-hidden className="absolute inset-0 bg-black/35" />

      <div className="relative flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/80 uppercase">
          <Music2 size={13} />
          PINGO Music
        </div>

        <div className="flex items-center gap-3">
          {song.img ? (
            <img src={song.img} alt="" className={cn('size-16 shrink-0 rounded-[12px] object-cover shadow-lg transition-transform duration-500', on && 'scale-105')} />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-[12px] bg-white/15"><Music2 size={26} /></span>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[15px] leading-snug font-bold">{song.name}</p>
            {song.artist && <p className="mt-0.5 truncate text-[12.5px] text-white/75">{song.artist}</p>}
          </div>
        </div>

        {/* The bar: drag anywhere in the song. */}
        <div>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(total))}
            step={1}
            value={Math.round(at)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Position in song"
            className="song-seek block h-4 w-full cursor-pointer"
            style={{ ['--p' as string]: `${pct}%` }}
          />
          <div className="flex justify-between text-[11px] font-medium text-white/75 tabular-nums">
            <span>{fmt(at)}</span>
            <span>{total ? fmt(total) : '--:--'}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button type="button" onClick={nextSpeed} aria-label={`Speed ${speed}x`} className="focus-ring grid h-8 min-w-12 place-items-center rounded-full bg-white/15 px-2.5 text-[12px] font-bold tabular-nums">
            {speed}x
          </button>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => seek(at - 10)} aria-label="Back 10 seconds" className="focus-ring grid size-9 place-items-center rounded-full text-white/90 active:bg-white/15">
              <RotateCcw size={19} />
            </button>
            <button type="button" onClick={toggle} aria-label={on ? 'Pause' : 'Play'} className="focus-ring grid size-12 place-items-center rounded-full bg-white text-black shadow-md active:scale-95">
              {loading ? (
                <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
              ) : on ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button type="button" onClick={() => seek(at + 10)} aria-label="Forward 10 seconds" className="focus-ring grid size-9 place-items-center rounded-full text-white/90 active:bg-white/15">
              <RotateCw size={19} />
            </button>
          </div>
          <span className="w-12" aria-hidden />
        </div>

        {failed && <p role="status" className="-mt-1 text-center text-[12px] text-white/80">This song would not play. Try again.</p>}
      </div>
    </div>
  );
}
