import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@pingo/ui';
import type { TmdbMedia, TmdbMediaDetails } from '../types.js';
import { fetchDetails, getTmdbPosterUrl } from '../api/tmdb.js';
import { TvEpisodeBrowser } from './TvEpisodeBrowser.js';
import { TvWatchChat } from './TvWatchChat.js';

type PanelTab = 'episodes' | 'details' | 'more' | 'chat';

interface Props {
  media: TmdbMedia;
  isTv: boolean;
  season: number;
  episode: number;
  onPick: (season: number, episode: number) => void;
  onOpenMedia: (media: TmdbMedia) => void;
  /** The friend being watched along with: the chat tab opens on their conversation. */
  alongId?: string;
}

/**
 * The panel beside the player: the episodes of the season being watched (with
 * their stills and running times), the title's details, and more like it.
 * Seasons and episodes are the real ones from TMDB; if they cannot be read the
 * episode list falls back to plain numbers rather than inventing titles.
 */
export function TvEpisodePanel({ media, isTv, season, episode, onPick, onOpenMedia, alongId }: Props) {
  // Watching along: the person is here to talk, so the chat is where it opens.
  const [tab, setTab] = useState<PanelTab>(alongId ? 'chat' : isTv ? 'episodes' : 'details');
  const [details, setDetails] = useState<TmdbMediaDetails | null>(null);
  const type = isTv ? 'tv' : 'movie';

  useEffect(() => {
    let live = true;
    void fetchDetails(type, media.id).then((d) => live && setDetails(d));
    return () => {
      live = false;
    };
  }, [type, media.id]);

  const tabs: Array<{ id: PanelTab; label: string }> = [
    ...(isTv ? [{ id: 'episodes' as const, label: 'Episodes' }] : []),
    { id: 'chat' as const, label: 'Chat' },
    { id: 'details', label: 'Details' },
    { id: 'more', label: 'More Like This' },
  ];

  return (
    <aside aria-label="Episodes and details" className="flex min-h-0 flex-1 flex-col border-t border-white/10 bg-[#0d0e14] lg:w-[390px] lg:flex-none lg:shrink-0 lg:border-l lg:border-t-0">
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

      <div className={cn('min-h-0 flex-1 overscroll-contain [scrollbar-width:thin]', tab === 'chat' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-3')}>
        {tab === 'chat' && <TvWatchChat {...(alongId ? { alongId } : {})} />}

        {tab === 'episodes' && isTv && (
          <TvEpisodeBrowser media={media} variant="panel" current={{ season, episode }} onPick={onPick} />
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
