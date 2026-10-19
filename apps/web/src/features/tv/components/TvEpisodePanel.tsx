import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbEpisode, TmdbMedia, TmdbMediaDetails } from '../types.js';
import { fetchDetails, fetchSeason, getTmdbPosterUrl, getTmdbStillUrl } from '../api/tmdb.js';

type PanelTab = 'episodes' | 'details' | 'more';

interface Props {
  media: TmdbMedia;
  isTv: boolean;
  season: number;
  episode: number;
  onPick: (season: number, episode: number) => void;
  onOpenMedia: (media: TmdbMedia) => void;
}

/**
 * The panel beside the player: the episodes of the season being watched (with
 * their stills and running times), the title's details, and more like it.
 * Seasons and episodes are the real ones from TMDB; if they cannot be read the
 * episode list falls back to plain numbers rather than inventing titles.
 */
export function TvEpisodePanel({ media, isTv, season, episode, onPick, onOpenMedia }: Props) {
  const [tab, setTab] = useState<PanelTab>(isTv ? 'episodes' : 'details');
  const [details, setDetails] = useState<TmdbMediaDetails | null>(null);
  const [episodes, setEpisodes] = useState<TmdbEpisode[] | null>(null);
  const type = isTv ? 'tv' : 'movie';

  useEffect(() => {
    let live = true;
    void fetchDetails(type, media.id).then((d) => live && setDetails(d));
    return () => {
      live = false;
    };
  }, [type, media.id]);

  useEffect(() => {
    if (!isTv) return;
    let live = true;
    setEpisodes(null);
    void fetchSeason(media.id, season).then((list) => live && setEpisodes(list));
    return () => {
      live = false;
    };
  }, [isTv, media.id, season]);

  const seasons = (details?.seasons ?? []).filter((s) => s.season_number > 0);
  const seasonCount = Math.max(seasons.length || details?.number_of_seasons || (details ? 1 : 10), season);
  const knownEpisodes = seasons.find((x) => x.season_number === season)?.episode_count;
  const tabs: Array<{ id: PanelTab; label: string }> = [
    ...(isTv ? [{ id: 'episodes' as const, label: 'Episodes' }] : []),
    { id: 'details', label: 'Details' },
    { id: 'more', label: 'More Like This' },
  ];

  return (
    <aside aria-label="Episodes and details" className="flex min-h-0 flex-col border-t border-white/10 bg-[#0d0e14] lg:w-[390px] lg:shrink-0 lg:border-l lg:border-t-0">
      <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('-mb-px border-b-2 px-3 py-3 text-[14px] transition-colors', tab === t.id ? 'border-brand font-bold text-brand' : 'border-transparent font-medium text-white/65 hover:text-white')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin]">
        {tab === 'episodes' && isTv && (
          <>
            {/* Seasons: every one of them, to pick with a tap. Unknown count shows a run of ten rather than none. */}
            <div role="tablist" aria-label="Season" className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {Array.from({ length: seasonCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={season === n}
                  onClick={() => onPick(n, 1)}
                  className={cn('h-9 shrink-0 rounded-full border px-4 text-[13.5px] font-semibold transition', season === n ? 'border-brand bg-brand text-on-brand' : 'border-white/20 text-white/85 hover:bg-white/10')}
                >
                  Season {n}
                </button>
              ))}
            </div>

            {episodes === null ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[74px] animate-pulse rounded-lg bg-white/[0.06]" />
                ))}
              </div>
            ) : episodes.length === 0 ? (
              <div className="grid grid-cols-6 gap-1.5">
                {Array.from({ length: knownEpisodes || 24 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => onPick(season, n)} className={cn('h-9 rounded-md text-sm font-bold transition', episode === n ? 'bg-brand text-white' : 'bg-white/[0.07] text-white/80 hover:bg-white/15')}>
                    {n}
                  </button>
                ))}
              </div>
            ) : (
              <ol className="space-y-1.5">
                {episodes.map((ep) => {
                  const on = ep.episode_number === episode;
                  const still = getTmdbStillUrl(ep.still_path);
                  return (
                    <li key={ep.id}>
                      <button
                        type="button"
                        onClick={() => onPick(season, ep.episode_number)}
                        aria-current={on ? 'true' : undefined}
                        className={cn('flex w-full items-center gap-3 rounded-lg border p-2 text-left transition', on ? 'border-brand bg-brand/10' : 'border-transparent hover:bg-white/[0.06]')}
                      >
                        <span className="w-4 shrink-0 text-center text-[13px] font-semibold text-white/60">{ep.episode_number}</span>
                        <span className="relative aspect-video w-[104px] shrink-0 overflow-hidden rounded-md bg-white/[0.07]">
                          {still && <img src={still} alt="" loading="lazy" draggable={false} className="size-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />}
                          {on && (
                            <span className="absolute inset-0 grid place-items-center bg-black/45">
                              <Play className="size-5 fill-white text-white" />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-white">{ep.name || `Episode ${ep.episode_number}`}</span>
                          <span className="mt-0.5 block text-[12px] text-white/55">{ep.runtime ? `${ep.runtime} min` : ep.air_date ?? ''}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}

        {tab === 'details' && (
          <div className="space-y-4 text-[13.5px] leading-relaxed text-white/80">
            <div>
              <h4 className="text-[15px] font-bold text-white">{media.title || media.name}</h4>
              {details?.tagline && <p className="mt-0.5 text-white/55">{details.tagline}</p>}
            </div>
            <p>{details?.overview || media.overview || 'No description yet.'}</p>
            {details && details.genres.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {details.genres.map((g) => (
                  <span key={g.id} className="rounded border border-white/20 bg-white/[0.06] px-2 py-0.5 text-[12px] font-medium text-white/85">
                    {g.name}
                  </span>
                ))}
              </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              {(details?.release_date || details?.first_air_date) && (<><dt className="text-white/50">Released</dt><dd>{(details?.release_date || details?.first_air_date || '').slice(0, 4)}</dd></>)}
              {details?.runtime ? (<><dt className="text-white/50">Runtime</dt><dd>{details.runtime} min</dd></>) : null}
              {details?.number_of_seasons ? (<><dt className="text-white/50">Seasons</dt><dd>{details.number_of_seasons}</dd></>) : null}
              {(details?.vote_average ?? media.vote_average) > 0 && (<><dt className="text-white/50">Rating</dt><dd>{(details?.vote_average ?? media.vote_average).toFixed(1)} / 10</dd></>)}
            </dl>
          </div>
        )}

        {tab === 'more' &&
          ((details?.similar?.results.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-white/55">{details ? 'Nothing similar to show.' : 'Loading...'}</p>
          ) : (
            <div className="grid grid-cols-3 gap-x-2.5 gap-y-4">
              {details!.similar!.results.slice(0, 12).map((m) => (
                <button key={m.id} type="button" onClick={() => onOpenMedia({ ...m, media_type: type })} className="group text-left">
                  <span className="block aspect-[2/3] overflow-hidden rounded bg-white/[0.07]">
                    {m.poster_path && <img src={getTmdbPosterUrl(m.poster_path, 'w185')} alt="" loading="lazy" draggable={false} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />}
                  </span>
                  <span className="mt-1.5 block truncate text-[12px] font-medium text-white/85">{m.title || m.name}</span>
                </button>
              ))}
            </div>
          ))}
      </div>
    </aside>
  );
}
