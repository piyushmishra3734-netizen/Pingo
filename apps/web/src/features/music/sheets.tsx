import { cn } from '@pingo/ui';
import { Check, Music2, Pause, Play, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { MUSIC_SHELVES, More, PlaylistRow, UPLOADS, useCatalogue } from './catalogue.js';

import { UploadsShelf } from './UploadsShelf.js';

/**
 * Music for stories and snaps: JioSaavn, through PINGO's own worker
 * (`pingo-music`), and the dark sheets both the story editor and the camera use
 * to search it, preview a song and pick the fifteen seconds that play.
 */

export const MUSIC = 'https://pingo-music.dubesminecraft.workers.dev/api';
export interface Song { name: string; artist: string; img: string; url: string; secs: number; start: number }
export const decode = (t: string) => { const x = document.createElement('textarea'); x.innerHTML = t; return x.value; };
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Panel({ children, title, onClose }: { children: ReactNode; title?: string; onClose: () => void }) {
  return (
    <div data-chrome className="absolute inset-0 z-40" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/45" onPointerDown={onClose} />
      <div className="animate-panel-in absolute inset-x-0 bottom-0 flex max-h-[86%] flex-col rounded-t-[18px] bg-media-sheet pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
        <div className="mx-auto mt-2 mb-2.5 h-1 w-10 shrink-0 rounded-full bg-white/25" />
        {title && <h3 className="shrink-0 px-4 pb-2.5 text-center text-[16px] font-bold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
export const Field = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className="h-[46px] w-full rounded-[12px] bg-media-field px-3.5 text-[16px] text-white outline-none placeholder:text-white/45" />
);
export const Blue = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" {...p} className="h-[46px] w-full rounded-[12px] bg-media-accent text-[15px] font-bold text-on-media-accent disabled:opacity-50">{children}</button>
);

export interface ApiSong { name: string; duration?: number; image?: { url: string }[]; downloadUrl?: { quality: string; url: string }[]; artists?: { primary?: { name: string }[] } }
export const toSong = (r: ApiSong): Song | undefined => {
  const url = r.downloadUrl?.find((u) => u.quality === '160kbps')?.url ?? r.downloadUrl?.at(-1)?.url;
  if (!url) return undefined;
  return { name: decode(r.name), artist: decode((r.artists?.primary ?? []).map((a) => a.name).slice(0, 2).join(', ')), img: r.image?.[1]?.url ?? r.image?.[0]?.url ?? '', url, secs: r.duration ?? 180, start: 30 };
};

export function MusicSheet(p: { close: () => void; onPreview: (s?: Song) => void; chooseSong: (s: Song) => void }) {
  const cat = useCatalogue();
  const [playing, setPlaying] = useState<string>();
  const preview = (s: Song) => { if (playing === s.url) { setPlaying(undefined); p.onPreview(undefined); } else { setPlaying(s.url); p.onPreview(s); } };
  useEffect(() => () => p.onPreview(undefined), [p]);
  const list = cat.songs.items;
  return (
    <Panel onClose={p.close}>
      <label className="mx-3.5 mb-2.5 flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-media-field px-3 text-white/55">
        <Search size={16} /><input value={cat.query} onChange={(e) => cat.setQuery(e.target.value)} placeholder="Search music" className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none" />
      </label>
      <div className="flex shrink-0 gap-2 overflow-x-auto px-3.5 pb-2.5">
        {MUSIC_SHELVES.map((s) => <button key={s.label} type="button" onClick={() => cat.setShelf(s)} className={cn('flex shrink-0 items-center gap-1 rounded-[10px] px-3 py-1.5 text-[13px] font-bold', cat.shelf === s && (cat.uploads || !cat.query) ? 'bg-white text-black' : 'bg-media-field')}>{s.src === UPLOADS && <Upload size={13} />}{s.label}</button>)}
      </div>
      {cat.uploads ? (
        <div className="overflow-y-auto px-2 pb-2">
          <UploadsShelf
            tone="dark"
            query={cat.query}
            {...(playing ? { previewing: playing } : {})}
            onPreview={preview}
            onSelect={(s) => { p.onPreview(undefined); p.chooseSong(s); }}
            actionIcon={<Check size={17} />}
            actionLabel="Use"
          />
        </div>
      ) : (
      <div className="overflow-y-auto px-2">
        <PlaylistRow pager={cat.lists} tone="dark" onOpen={cat.toggleOpen} {...(cat.open ? { open: cat.open } : {})} />
        {!list && <p className="py-6 text-center text-white/50">Loading…</p>}
        {list?.length === 0 && cat.songs.done && <p className="py-6 text-center text-white/50">Nothing found</p>}
        {list?.map((s) => (
          <div key={s.url} className="flex items-center gap-3 rounded-[12px] px-2 py-2 active:bg-white/5">
            <button type="button" onClick={() => { p.onPreview(undefined); p.chooseSong(s); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <img src={s.img} alt="" loading="lazy" className="size-12 shrink-0 rounded-[8px] object-cover" />
              <span className="min-w-0"><b className="block truncate text-[14.5px]">{s.name}</b><span className="block truncate text-[13px] text-white/55">{s.artist}</span></span>
            </button>
            <button type="button" aria-label={playing === s.url ? 'Pause' : 'Preview'} onClick={() => preview(s)} className="grid size-9 shrink-0 place-items-center">
              {playing === s.url ? <Pause size={19} /> : <Play size={19} />}
            </button>
          </div>
        ))}
        <More pager={cat.songs} tone="dark" />
      </div>
      )}
    </Panel>
  );
}

export function ClipSheet(p: { close: () => void; song?: Song; setSong: (s: Song) => void }) {
  const s = p.song;
  const bars = useMemo(() => Array.from({ length: 60 }, (_, i) => 20 + Math.abs(Math.sin(i * 1.7) * 60) + (i % 5) * 4), []);
  if (!s) return null;
  const max = Math.max(0, s.secs - 15);
  return (
    <Panel onClose={p.close}>
      <div className="flex items-center gap-2.5 px-4 pb-3">
        {s.img ? <img src={s.img} alt="" className="size-11 rounded-[8px]" /> : <span className="grid size-11 place-items-center rounded-[8px] bg-white/10"><Music2 size={20} /></span>}
        <div className="min-w-0 flex-1"><b className="block truncate">{s.name}</b><span className="text-[13px] text-white/60">{s.artist}</span></div>
        <button type="button" onClick={p.close} className="font-bold text-media-accent">Done</button>
      </div>
      <div className="relative mx-4 flex h-14 items-center gap-0.5">
        {bars.map((h, i) => <i key={i} className="flex-1 rounded-sm bg-white/25" style={{ height: `${h}%` }} />)}
        <span className="pointer-events-none absolute -inset-y-1 rounded-[10px] ring-3 ring-white" style={{ left: `${(s.start / Math.max(1, s.secs)) * 100}%`, width: `${(15 / Math.max(1, s.secs)) * 100}%` }} />
      </div>
      <input type="range" min={0} max={max} step={1} value={s.start} aria-label="Which part of the song"
        onChange={(e) => p.setSong({ ...s, start: Number(e.target.value) })} className="mx-4 mt-2.5 w-[calc(100%-2rem)] accent-white" />
      <p className="pt-1.5 pb-4 text-center text-[13px] font-bold tabular-nums">{fmt(s.start)} – {fmt(s.start + 15)}</p>
    </Panel>
  );
}

