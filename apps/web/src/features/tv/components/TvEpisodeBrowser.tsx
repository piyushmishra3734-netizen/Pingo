import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Play } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbEpisode, TmdbMedia, TmdbMediaDetails } from '../types.js';
import { fetchDetails, fetchSeason, getTmdbStillUrl } from '../api/tmdb.js';

interface Props {
  media: TmdbMedia;
  /** The episode being watched, if any: highlighted and scrolled to. */
  current?: { season: number; episode: number };
  /** Season shown first when nothing is being watched. */
  initialSeason?: number;
  onPick: (season: number, episode: number) => void;
  /** `page` is the wide card on a title's page; `panel` is the narrow list beside the player. */
  variant?: 'page' | 'panel';
  /** Told when the season being looked at changes, so a player can keep its own in step. */
  onSeasonView?: (season: number) => void;
}

/**
 * Season dropdown and the episodes under it, the way a streaming app shows
 * them: pick a season from the menu, then tap an episode card to play it.
 * Seasons and episodes are TMDB's; when the episodes cannot be read the list
 * falls back to plain numbers, never invented titles.
 */
export function TvEpisodeBrowser({ media, current, initialSeason = 1, onPick, variant = 'page', onSeasonView }: Props) {
  const [season, setSeason] = useState(current?.season ?? initialSeason);
  const [details, setDetails] = useState<TmdbMediaDetails | null>(null);
  const [episodes, setEpisodes] = useState<TmdbEpisode[] | null>(null);
  const currentRow = useRef<HTMLLIElement>(null);

  // The player moved on to another season (next episode, a friend's): follow it.
  useEffect(() => {
    if (current) setSeason(current.season);
  }, [current?.season]);

  useEffect(() => {
    let live = true;
    void fetchDetails('tv', media.id).then((d) => live && setDetails(d));
    return () => {
      live = false;
    };
  }, [media.id]);

  useEffect(() => {
    let live = true;
    setEpisodes(null);
    void fetchSeason(media.id, season).then((list) => live && setEpisodes(list));
    onSeasonView?.(season);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, season]);

  useEffect(() => {
    if (variant === 'panel') currentRow.current?.scrollIntoView({ block: 'nearest' });
  }, [episodes, variant]);

  const seasons = (details?.seasons ?? []).filter((s) => s.season_number > 0);
  const list = seasons.length
    ? seasons.map((s) => ({ n: s.season_number, count: s.episode_count }))
    : Array.from({ length: Math.max(details?.number_of_seasons ?? (details ? 1 : 10), season) }, (_, i) => ({ n: i + 1, count: 0 }));
  const knownCount = list.find((s) => s.n === season)?.count || 0;
  const panel = variant === 'panel';

  return (
    <div>
      <SeasonDropdown seasons={list} value={season} onChange={setSeason} />

      <div className="mt-3">
        {episodes === null ? (
          <div className="space-y-2.5" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn('animate-pulse rounded-lg bg-white/[0.06]', panel ? 'h-[72px]' : 'h-[104px]')} />
            ))}
          </div>
        ) : episodes.length === 0 ? (
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
            {Array.from({ length: knownCount || 24 }, (_, i) => i + 1).map((n) => {
              const on = current?.season === season && current.episode === n;
              return (
                <button key={n} type="button" onClick={() => onPick(season, n)} className={cn('h-11 rounded-lg text-[15px] font-bold transition', on ? 'bg-brand text-on-brand' : 'bg-white/[0.08] text-white hover:bg-white/15')}>
                  {n}
                </button>
              );
            })}
          </div>
        ) : (
          <ol className={cn(panel ? 'space-y-1' : 'space-y-1.5 sm:space-y-2')}>
            {episodes.map((ep) => {
              const on = current?.season === season && current.episode === ep.episode_number;
              const still = getTmdbStillUrl(ep.still_path);
              return (
                <li key={ep.id} ref={on ? currentRow : undefined}>
                  <button
                    type="button"
                    onClick={() => onPick(season, ep.episode_number)}
                    aria-current={on ? 'true' : undefined}
                    className={cn(
                      'group flex w-full gap-3 rounded-lg text-left transition',
                      panel ? 'items-center p-1.5' : 'items-start p-2 sm:gap-4 sm:p-2.5',
                      on ? 'bg-white/[0.09] ring-1 ring-white/25' : 'hover:bg-white/[0.06]',
                    )}
                  >
                    <span className={cn('relative shrink-0 overflow-hidden rounded-md bg-white/[0.08]', panel ? 'aspect-video w-[104px]' : 'aspect-video w-[132px] sm:w-[200px]')}>
                      {still && <img src={still} alt="" loading="lazy" draggable={false} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />}
                      <span className={cn('absolute inset-0 grid place-items-center bg-black/25 transition-opacity', on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100')}>
                        <span className="grid size-9 place-items-center rounded-full bg-black/60 backdrop-blur-sm">
                          <Play className="size-4 fill-white text-white" />
                        </span>
                      </span>
                      {ep.runtime ? <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-px text-[10.5px] font-semibold text-white">{ep.runtime}m</span> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block font-semibold leading-snug text-white', panel ? 'line-clamp-2 text-[13.5px]' : 'line-clamp-2 text-[15px] sm:text-base')}>
                        <span className="text-white/60">E{ep.episode_number}</span> <span className="mx-0.5 text-white/30">&middot;</span> {ep.name || `Episode ${ep.episode_number}`}
                      </span>
                      {!panel && ep.overview && <span className="mt-1 line-clamp-2 block text-[12.5px] leading-snug text-white/60 sm:line-clamp-3 sm:text-[13.5px]">{ep.overview}</span>}
                      {!panel && ep.air_date && <span className="mt-1.5 block text-[12px] text-white/40">{ep.air_date}</span>}
                      {panel && <span className="mt-0.5 block text-[12px] text-white/45">{on ? 'Now playing' : ep.air_date ?? ''}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** "Season 2 ▾": a button that opens the list of seasons, each with how many episodes it has. */
function SeasonDropdown({ seasons, value, onChange }: { seasons: { n: number; count: number }[]; value: number; onChange: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <div ref={box} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2.5 rounded-md bg-white/[0.1] pr-3 pl-4 text-[15px] font-semibold text-white transition hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        Season {value}
        <ChevronDown className={cn('size-4 text-white/70 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul role="listbox" aria-label="Season" className="absolute top-[calc(100%+6px)] left-0 z-30 max-h-72 w-60 overflow-y-auto overscroll-contain rounded-lg border border-white/12 bg-[#1b1d26] py-1.5 shadow-2xl [scrollbar-width:thin]">
          {seasons.map((s) => (
            <li key={s.n} role="option" aria-selected={s.n === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(s.n);
                  setOpen(false);
                }}
                className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.08]', s.n === value ? 'text-white' : 'text-white/80')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">Season {s.n}</span>
                  {s.count > 0 && <span className="block text-[12px] text-white/50">{s.count} episodes</span>}
                </span>
                {s.n === value && <Check className="size-4 shrink-0 text-brand" strokeWidth={2.6} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
