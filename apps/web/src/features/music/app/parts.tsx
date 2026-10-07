import { cn } from '@pingo/ui';
import { Ellipsis, Music2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Album, Artist, Channel, Item, Playlist, Song, Station } from '../saavn/types.js';
import type { Kept } from '../saavn/library.js';

/* ---------- small helpers ---------- */

/** "Kesariya (From "Brahmastra")" -> "Kesariya": the film is on the album line already. */
export const clean = (name: string) => name.replace(/\s*\((from|feat\.?)[^)]*\)/gi, '').replace(/\s*-\s*From .*$/i, '').trim();
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const names = (s: { artists: { name: string }[] }) => s.artists.map((a) => a.name).filter(Boolean).slice(0, 2).join(', ');
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Loads once per key and keeps the answer while the key holds. The API layer
 * caches by URL, so going back to a page paints at once.
 */
export function useLoad<T>(key: string | undefined, load: () => Promise<T>): { data?: T; error?: string; loading: boolean } {
  const [state, setState] = useState<{ key?: string; data?: T; error?: string }>({});
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    loadRef.current().then(
      (data) => live && setState({ key, data }),
      (e: unknown) => live && setState({ key, error: e instanceof Error ? e.message : 'Something went wrong' }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  const current = state.key === key;
  return { ...(current && state.data !== undefined ? { data: state.data } : {}), ...(current && state.error ? { error: state.error } : {}), loading: !current };
}

/**
 * The colour of a cover, for the light wash behind what is playing.
 *
 * The most saturated mid-tone of a 12x12 sample, dimmed until it reads as
 * text on the light sheet. JioSaavn's image host allows CORS, so the canvas
 * can be read.
 */
const tones = new Map<string, string>();
export function useCoverTone(src: string | undefined): string | undefined {
  const [tone, setTone] = useState(src ? tones.get(src) : undefined);
  useEffect(() => {
    if (!src) return;
    const known = tones.get(src);
    if (known) return setTone(known);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 12;
        const g = c.getContext('2d');
        if (!g) return;
        g.drawImage(img, 0, 0, 12, 12);
        const px = g.getImageData(0, 0, 12, 12).data;
        let best = [120, 110, 140];
        let score = -1;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i]!, gg = px[i + 1]!, b = px[i + 2]!;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          const sat = mx ? (mx - mn) / mx : 0;
          const lum = (mx + mn) / 510;
          const s = sat * (1 - Math.abs(lum - 0.5) * 1.6);
          if (s > score) {
            score = s;
            best = [r, gg, b];
          }
        }
        const k = Math.min(1, 150 / Math.max(...best));
        const v = best.map((x) => Math.round(x * k)).join(',');
        tones.set(src, v);
        setTone(v);
      } catch {
        // A tainted canvas (a host without CORS): keep the neutral wash.
      }
    };
    img.src = src;
    return undefined;
  }, [src]);
  return tone;
}

/* ---------- pieces ---------- */

export function Bars({ paused, className }: { paused?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('pm-bars', paused && 'pm-bars-paused', className)}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Cover({ src, className, round }: { src?: string; className?: string; round?: boolean }) {
  // A cover that fails to load gets the note instead of the browser's broken-image mark.
  const [failed, setFailed] = useState<string>();
  return src && failed !== src ? (
    <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(src)} className={cn('shrink-0 bg-sunken object-cover', round ? 'rounded-full' : 'rounded-[10px]', className)} />
  ) : (
    <span className={cn('grid shrink-0 place-items-center bg-sunken text-text-tertiary', round ? 'rounded-full' : 'rounded-[10px]', className)}>
      <Music2 size={18} />
    </span>
  );
}

/** A song as a row: cover, name, artists, length, and the "more" button. */
export function SongRow({
  song,
  index,
  numbered,
  sub,
  now,
  paused,
  big,
  onPlay,
  onMore,
}: {
  song: Song | Kept;
  index?: number;
  numbered?: boolean;
  sub?: string;
  now?: boolean;
  paused?: boolean;
  big?: boolean;
  onPlay: () => void;
  onMore?: () => void;
}) {
  const img = 'stream' in song ? song.image : song.image;
  return (
    <div className="flex items-center rounded-xl pr-1 transition-colors duration-quick active:bg-sunken">
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-1.5 text-left">
        {numbered && <span className="w-5 shrink-0 text-center text-[13.5px] tabular-nums text-text-tertiary">{(index ?? 0) + 1}</span>}
        <Cover src={img} className={big ? 'size-[58px]' : 'size-[46px]'} />
        <span className="min-w-0 flex-1">
          <b className={cn('block truncate font-medium', big ? 'text-[16px]' : 'text-[14.5px]', now && 'text-[rgb(var(--pm-tone))]')}>{clean(song.name)}</b>
          <small className="block truncate text-[12.5px] text-text-secondary">{sub ?? names(song)}</small>
        </span>
        {now ? <Bars paused={paused} /> : song.secs ? <span className="text-[12px] tabular-nums text-text-tertiary">{fmt(song.secs)}</span> : null}
      </button>
      {onMore && (
        <button type="button" onClick={onMore} aria-label={`More for ${clean(song.name)}`} className="grid size-9 shrink-0 place-items-center rounded-full text-text-tertiary active:bg-sunken">
          <Ellipsis size={18} />
        </button>
      )}
    </div>
  );
}

/** A square tile in a sideways row: a song, album or playlist. */
export function Tile({ img, title, sub, small, fill, onClick }: { img?: string; title: string; sub?: string; small?: boolean; /** As wide as its grid cell. */ fill?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('group shrink-0 snap-start text-left', fill ? 'w-full min-w-0' : small ? 'w-28' : 'w-[136px]')}>
      <Cover src={img} className={cn('transition-transform duration-quick group-active:scale-95', fill ? 'aspect-square h-auto w-full' : small ? 'size-28' : 'size-[136px]', 'rounded-xl')} />
      <b className="mt-2 block truncate text-[13.5px] font-medium">{clean(title)}</b>
      {sub && <small className="block truncate text-[12px] text-text-secondary">{sub}</small>}
    </button>
  );
}

export function RoundTile({ img, title, sub, fill, onClick }: { img?: string; title: string; sub?: string; fill?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('shrink-0 snap-start text-center', fill ? 'w-full min-w-0' : 'w-[84px]')}>
      <Cover src={img} round className={fill ? 'aspect-square h-auto w-full' : 'size-[84px]'} />
      <b className="mt-1.5 block truncate text-[12px] font-medium">{title}</b>
      {sub && <small className="block text-[11px] text-text-secondary">{sub}</small>}
    </button>
  );
}

export function Strip({ children }: { children: ReactNode }) {
  return <div className="flex snap-x snap-mandatory scroll-px-[18px] gap-3.5 overflow-x-auto px-[18px] pb-1 scrollbar-none">{children}</div>;
}

export function Heading({ children, first, onAll }: { children: ReactNode; first?: boolean; /** A "See all" at the end of the line. */ onAll?: () => void }) {
  const h = <h3 className={cn('text-[17px] font-semibold tracking-[-0.01em]', !onAll && 'mx-[18px] mb-3', !onAll && (first ? 'mt-4' : 'mt-7'))}>{children}</h3>;
  if (!onAll) return h;
  return (
    <div className={cn('mx-[18px] mb-3 flex items-baseline justify-between gap-3', first ? 'mt-4' : 'mt-7')}>
      {h}
      <button type="button" onClick={onAll} className="shrink-0 text-[13.5px] font-medium text-text-secondary">
        See all
      </button>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mx-[18px] text-[13.5px] text-text-secondary">{children}</p>;
}

/** What tapping any catalogue item does. */
export interface Open {
  album: (a: Pick<Album, 'id' | 'name'>) => void;
  playlist: (p: Pick<Playlist, 'id' | 'name'>) => void;
  artist: (a: Pick<Artist, 'id' | 'name'>) => void;
  channel: (c: Pick<Channel, 'id' | 'name'>) => void;
  station: (s: Station) => void;
  song: (s: Song, list?: Song[]) => void;
}

export function ItemTile({ item, open, small, fill, list }: { item: Item; open: Open; small?: boolean; fill?: boolean; list?: Song[] }) {
  const f = fill ? { fill } : {};
  switch (item.type) {
    case 'song':
      return <Tile {...f} img={item.image} title={item.name} sub={names(item)} {...(small ? { small } : {})} onClick={() => open.song(item, list)} />;
    case 'album':
      return <Tile {...f} img={item.image} title={item.name} sub={item.subtitle || names(item) || 'Album'} {...(small ? { small } : {})} onClick={() => open.album(item)} />;
    case 'playlist':
      return <Tile {...f} img={item.image} title={item.name} sub={item.subtitle || 'Playlist'} {...(small ? { small } : {})} onClick={() => open.playlist(item)} />;
    case 'artist':
      return <RoundTile {...f} img={item.image} title={item.name} sub="Artist" onClick={() => open.artist(item)} />;
    case 'station':
      return <RoundTile {...f} img={item.image} title={item.name} sub="Radio" onClick={() => open.station(item)} />;
    case 'channel':
      return <Tile {...f} img={item.image} title={item.name} sub="Mood" {...(small ? { small } : {})} onClick={() => open.channel(item)} />;
  }
}
