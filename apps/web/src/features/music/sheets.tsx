import { cn } from '@pingo/ui';
import { Pause, Play, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

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
      <div className="animate-panel-in absolute inset-x-0 bottom-0 flex max-h-[86%] flex-col rounded-t-[18px] bg-[#1c1c1e] pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
        <div className="mx-auto mt-2 mb-2.5 h-1 w-10 shrink-0 rounded-full bg-[#48484a]" />
        {title && <h3 className="shrink-0 px-4 pb-2.5 text-center text-[16px] font-bold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
export const Field = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className="h-[46px] w-full rounded-xl bg-[#2c2c2e] px-3.5 text-[16px] text-white outline-none placeholder:text-white/45" />
);
export const Blue = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" {...p} className="h-[46px] w-full rounded-xl bg-[#0a84ff] text-[15px] font-bold text-white disabled:opacity-50">{children}</button>
);

export interface ApiSong { name: string; duration?: number; image?: { url: string }[]; downloadUrl?: { quality: string; url: string }[]; artists?: { primary?: { name: string }[] } }
export const toSong = (r: ApiSong): Song | undefined => {
  const url = r.downloadUrl?.find((u) => u.quality === '160kbps')?.url ?? r.downloadUrl?.at(-1)?.url;
  if (!url) return undefined;
  return { name: decode(r.name), artist: decode((r.artists?.primary ?? []).map((a) => a.name).slice(0, 2).join(', ')), img: r.image?.[1]?.url ?? r.image?.[0]?.url ?? '', url, secs: r.duration ?? 180, start: 30 };
};

export function MusicSheet(p: { close: () => void; onPreview: (s?: Song) => void; chooseSong: (s: Song) => void }) {
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState<Song[]>();
  const [playing, setPlaying] = useState<string>();
  const load = useCallback(async (query: string) => {
    setList(undefined);
    try {
      const r = await fetch(query ? `${MUSIC}/search/songs?query=${encodeURIComponent(query)}&limit=20` : `${MUSIC}/playlists?id=110858205&limit=25`);
      const j = (await r.json()) as { data: { results?: ApiSong[]; songs?: ApiSong[] } };
      setList(((query ? j.data.results : j.data.songs) ?? []).map(toSong).filter((s): s is Song => !!s));
    } catch { setList([]); }
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(q.trim() || tab), q ? 350 : 0); return () => window.clearTimeout(t); }, [q, tab, load]);
  useEffect(() => () => p.onPreview(undefined), [p]);
  const tabs: [string, string][] = [['For you', ''], ['Trending', 'trending hits'], ['Hindi', 'latest hindi songs'], ['Punjabi', 'punjabi hits']];
  return (
    <Panel onClose={p.close}>
      <label className="mx-3.5 mb-2.5 flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-[#2c2c2e] px-3 text-white/55">
        <Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search music" className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none" />
      </label>
      <div className="flex shrink-0 gap-2 overflow-x-auto px-3.5 pb-2.5">
        {tabs.map(([l, v]) => <button key={l} type="button" onClick={() => { setQ(''); setTab(v); }} className={cn('shrink-0 rounded-[10px] px-3 py-1.5 text-[13px] font-bold', tab === v ? 'bg-white text-black' : 'bg-[#2c2c2e]')}>{l}</button>)}
      </div>
      <div className="overflow-y-auto px-2">
        {!list && <p className="py-6 text-center text-white/50">Loading…</p>}
        {list?.length === 0 && <p className="py-6 text-center text-white/50">Nothing found</p>}
        {list?.map((s) => (
          <div key={s.url} className="flex items-center gap-3 rounded-xl px-2 py-2 active:bg-white/5">
            <button type="button" onClick={() => { p.onPreview(undefined); p.chooseSong(s); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <img src={s.img} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
              <span className="min-w-0"><b className="block truncate text-[14.5px]">{s.name}</b><span className="block truncate text-[13px] text-white/55">{s.artist}</span></span>
            </button>
            <button type="button" aria-label={playing === s.url ? 'Pause' : 'Preview'} onClick={() => { if (playing === s.url) { setPlaying(undefined); p.onPreview(undefined); } else { setPlaying(s.url); p.onPreview(s); } }} className="grid size-9 shrink-0 place-items-center">
              {playing === s.url ? <Pause size={19} /> : <Play size={19} />}
            </button>
          </div>
        ))}
      </div>
      <p className="shrink-0 pt-2 text-center text-[11px] text-white/35">Music via JioSaavn</p>
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
        <img src={s.img} alt="" className="size-11 rounded-lg" />
        <div className="min-w-0 flex-1"><b className="block truncate">{s.name}</b><span className="text-[13px] text-white/60">{s.artist}</span></div>
        <button type="button" onClick={p.close} className="font-bold text-[#0a84ff]">Done</button>
      </div>
      <div className="relative mx-4 flex h-14 items-center gap-0.5">
        {bars.map((h, i) => <i key={i} className="flex-1 rounded-sm bg-[#48484a]" style={{ height: `${h}%` }} />)}
        <span className="pointer-events-none absolute -inset-y-1 rounded-[10px] ring-3 ring-white" style={{ left: `${(s.start / Math.max(1, s.secs)) * 100}%`, width: `${(15 / Math.max(1, s.secs)) * 100}%` }} />
      </div>
      <input type="range" min={0} max={max} step={1} value={s.start} aria-label="Which part of the song"
        onChange={(e) => p.setSong({ ...s, start: Number(e.target.value) })} className="mx-4 mt-2.5 w-[calc(100%-2rem)] accent-white" />
      <p className="pt-1.5 pb-4 text-center text-[13px] font-bold tabular-nums">{fmt(s.start)} – {fmt(s.start + 15)}</p>
    </Panel>
  );
}

