import type { AiCard, AiSongCard, AiTitleCard } from '@pingo/core';
import { cn } from '@pingo/ui';
import { ChevronRight, Pause, Play, Star } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { MusicMark } from '../music/MusicMark.js';
import { useMusicPlayer } from '../music/player.js';
import * as api from '../music/saavn/api.js';
import { Q, playList, toggleCurrent, useQueue } from '../music/saavn/playback.js';
import type { Song } from '../music/saavn/types.js';
import { getTmdbBackdropUrl, getTmdbPosterUrl } from '../tv/api/tmdb.js';
import { openMini } from '../tv/mini-player.js';
import { titlePath } from '../tv/routes.js';
import type { TmdbMedia } from '../tv/types.js';

/**
 * What PINGO AI found, under its reply: songs that play in PINGO Music and
 * films or series that play in the Pingo TV window.
 *
 * Songs come as one panel, not one card each: a header with "Play all" and a
 * row per song, so six suggestions take the room of one. A tap plays from that
 * song and the rest of the suggestions queue behind it, so the music carries on
 * by itself.
 *
 * A title is a 16:9 card with its TMDB backdrop. Tapping it opens the small
 * Pingo TV player over the chat (the same one "watch along" uses), which finds
 * a server that plays on its own; the corner chip opens the title's page.
 */
export function AiCards({ cards }: { cards: AiCard[] }) {
  const songs = cards.filter((c): c is AiSongCard => c.t === 'song');
  const titles = cards.filter((c): c is AiTitleCard => c.t === 'title');
  if (!songs.length && !titles.length) return null;
  return (
    <div className="mt-2 flex w-[min(100%,21rem)] flex-col gap-2.5">
      {songs.length > 0 && <AiMusicPanel songs={songs} />}
      {titles.map((t) => (
        <AiTitleCardView key={`${t.y}-${t.id}`} title={t} />
      ))}
    </div>
  );
}

/* ---------- music ---------- */

function AiMusicPanel({ songs }: { songs: AiSongCard[] }) {
  const queue = useQueue();
  const player = useMusicPlayer();
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string>();
  const nowId = Q.current(queue)?.id;

  /** Plays the suggestions from one of them; the rest queue behind it. */
  const start = async (from: number) => {
    const key = songs[from]!.id;
    if (nowId === key) {
      toggleCurrent();
      return;
    }
    setBusy(key);
    setError(undefined);
    try {
      // The catalogue answers an empty list when any one id is unknown, so a short answer is asked for again, one by one.
      const ids = songs.map((s) => s.id);
      let full = await api.songs(ids).catch(() => [] as Song[]);
      if (full.length < ids.length) {
        const each = await Promise.allSettled(ids.map((id) => api.song(id)));
        full = each.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
      }
      const byId = new Map(full.map((s) => [s.id, s]));
      const ordered = songs.map((s) => byId.get(s.id)).filter((s): s is Song => !!s);
      const index = ordered.findIndex((s) => s.id === key);
      if (index < 0) throw new Error('missing');
      playList(ordered, index, { kind: 'list', label: 'From PINGO AI' });
    } catch {
      setError('That song would not play. Try another.');
    } finally {
      setBusy(undefined);
    }
  };

  const many = songs.length > 1;
  return (
    <section aria-label="Songs from PINGO AI" className="room-card flex flex-col gap-3 !p-3.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--room-tile,#ffe3f0)]">
          <MusicMark size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold leading-tight text-[var(--room-ink,var(--color-ink))]">PINGO Music</span>
          <span className="block text-[13.5px] leading-tight text-[var(--room-sub,var(--color-text-secondary))]">
            {many ? `${songs.length} songs picked for you` : 'Picked for you'}
          </span>
        </span>
        {many && (
          <button
            type="button"
            onClick={() => void start(0)}
            className="focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[13.5px] font-semibold text-white active:opacity-80"
          >
            <Play size={14} fill="currentColor" aria-hidden /> Play all
          </button>
        )}
      </div>

      <ul className="flex flex-col rounded-[18px] bg-[var(--room-panel,#fff)] px-2 py-1">
        {songs.map((s, i) => {
          const current = nowId === s.id;
          const playing = current && player.playing;
          const loading = busy === s.id || (current && player.loading);
          return (
            <li key={s.id} className={i > 0 ? 'border-t border-black/[0.06]' : undefined}>
              <button
                type="button"
                onClick={() => void start(i)}
                aria-label={`${playing ? 'Pause' : 'Play'} ${s.n}`}
                className="focus-ring flex w-full items-center gap-3 rounded-[14px] px-1.5 py-2 text-left active:bg-black/[0.04]"
              >
                {s.i ? (
                  <img src={s.i} alt="" loading="lazy" className="size-11 shrink-0 rounded-[10px] object-cover" />
                ) : (
                  <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-black/[0.06]">
                    <MusicMark size={22} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[15px] font-semibold leading-tight', current ? 'text-brand' : 'text-[#15171c]')}>{s.n}</span>
                  {s.a && <span className="mt-0.5 block truncate text-[13px] leading-tight text-[#7a7d86]">{s.a}</span>}
                </span>
                <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-full', current ? 'bg-brand text-white' : 'bg-black/[0.06] text-[#15171c]')}>
                  {loading ? (
                    <span className={cn('size-4 animate-spin rounded-full border-2 border-t-transparent', current ? 'border-white/70' : 'border-black/40')} />
                  ) : playing ? (
                    <Pause size={16} fill="currentColor" />
                  ) : (
                    <Play size={16} fill="currentColor" className="ml-0.5" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="status" className="px-1 text-[13px] text-[var(--room-sub,var(--color-text-secondary))]">
          {error}
        </p>
      )}
    </section>
  );
}

/* ---------- films and series ---------- */

/** The card's title, as the TV screens expect a title to be shaped. */
function asMedia(t: AiTitleCard): TmdbMedia {
  return {
    id: t.id,
    ...(t.y === 'movie' ? { title: t.n } : { name: t.n }),
    overview: t.o,
    poster_path: t.p || null,
    backdrop_path: t.b || null,
    vote_average: t.r,
    ...(t.yr ? (t.y === 'movie' ? { release_date: `${t.yr}-01-01` } : { first_air_date: `${t.yr}-01-01` }) : {}),
    media_type: t.y,
  };
}

function AiTitleCardView({ title }: { title: AiTitleCard }) {
  const navigate = useNavigate();
  const media = asMedia(title);
  const picture = title.b ? getTmdbBackdropUrl(title.b, 'w780') : title.p ? getTmdbPosterUrl(title.p, 'w500') : '';
  const poster = title.p ? getTmdbPosterUrl(title.p, 'w185') : undefined;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[22px] bg-[#101218] text-white shadow-[0_6px_24px_rgba(16,17,20,0.18)]">
      {picture && <img src={picture} alt="" loading="lazy" draggable={false} className={cn('absolute inset-0 size-full object-cover', !title.b && 'scale-110 blur-sm')} />}
      <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_30%,rgba(0,0,0,0.78))]" />

      <button
        type="button"
        onClick={() => openMini({ media, season: 1, episode: 1, ...(poster ? { poster } : {}) })}
        aria-label={`Play ${title.n}`}
        className="focus-ring absolute inset-0 grid place-items-center"
      >
        <span className="grid size-14 place-items-center rounded-full bg-white/25 text-white shadow-lg ring-1 ring-white/40 backdrop-blur-md transition-transform duration-200 active:scale-95">
          <Play size={26} fill="currentColor" className="ml-1" />
        </span>
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] leading-tight font-bold drop-shadow">{title.n}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-white/85">
            <span className="rounded-md bg-white/20 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide">{title.y === 'tv' ? 'Series' : 'Movie'}</span>
            {title.yr > 0 && <span>{title.yr}</span>}
            {title.r > 0 && (
              <span className="flex items-center gap-0.5">
                <Star size={12} fill="currentColor" aria-hidden /> {title.r.toFixed(1)}
              </span>
            )}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate(titlePath(media), { state: { media } })}
        aria-label={`Open ${title.n}`}
        className="focus-ring absolute right-2.5 top-2.5 flex h-8 items-center gap-0.5 rounded-full bg-black/45 pl-3 pr-2 text-[12.5px] font-semibold text-white backdrop-blur-md active:bg-black/60"
      >
        Details <ChevronRight size={14} aria-hidden />
      </button>
    </div>
  );
}
