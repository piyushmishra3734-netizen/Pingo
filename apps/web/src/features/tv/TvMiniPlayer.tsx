import { Maximize2, X } from 'lucide-react';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@pingo/ui';

import { closeMini, updateMini, useMini } from './mini-player.js';
import { TvLogo } from './components/TvLogo.js';
import { setMyWatching, useWatching, watchingLine, watchPathFor } from './watching.js';
import { recordWatched } from './hooks/useWatchHistory.js';

const TvStreamPlayer = React.lazy(() => import('./components/TvStreamPlayer.js'));

const W = 'min(64vw, 340px)';
const MARGIN = 12;

/**
 * The floating Pingo TV window.
 *
 * Mounted once in the app shell, so it keeps playing as the person moves
 * between chats, camera, music and profile. It is the same player as the full
 * page (the sources are probed and the first one that really plays is used,
 * on its own), just without the chrome. Drag it by its top edge; expand to
 * take it full page, close to stop.
 *
 * Third-party embeds cannot be handed to the browser's own picture in picture
 * window, so this stays inside PINGO.
 */
export function TvMiniPlayer() {
  const target = useMini();
  const navigate = useNavigate();
  // How far it has been dragged from its resting place (bottom left, above the dock).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Following a friend: when they move to another title or episode, so does this.
  const friend = useWatching(target?.along?.id);
  useEffect(() => {
    if (!target?.along || !friend) return;
    const sameTitle = friend.id === target.media.id && friend.y === (target.media.media_type ?? 'movie');
    const sameEpisode = friend.y === 'movie' || ((friend.s ?? 1) === target.season && (friend.e ?? 1) === target.episode);
    if (sameTitle && sameEpisode) return;
    updateMini({
      media: {
        id: friend.id,
        ...(friend.y === 'movie' ? { title: friend.n } : { name: friend.n }),
        overview: '',
        poster_path: null,
        backdrop_path: null,
        vote_average: 0,
        media_type: friend.y,
      },
      season: friend.s ?? 1,
      episode: friend.e ?? 1,
      ...(friend.i ? { poster: friend.i } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friend]);

  // Said to friends while it is open, like the full player does.
  useEffect(() => {
    if (!target) return;
    const type = target.media.media_type ?? (target.media.title ? 'movie' : 'tv');
    const title = (target.media.title || target.media.name || '').slice(0, 120);
    setMyWatching({
      n: title,
      y: type,
      id: target.media.id,
      ...(target.poster ? { i: target.poster } : {}),
      ...(type === 'tv' ? { s: target.season, e: target.episode } : {}),
      ...(target.along ? { w: target.along.id } : {}),
    });
    recordWatched(target.media, type, target.season, target.episode);
  }, [target?.media.id, target?.season, target?.episode, target?.along?.id]);
  // Closed: nothing left to say to friends.
  useEffect(() => {
    if (!target) setMyWatching(undefined);
  }, [target]);

  if (!target) return null;
  const type = target.media.media_type ?? (target.media.title ? 'movie' : 'tv');
  const title = target.media.title || target.media.name || 'Pingo TV';

  const onDown = (e: React.PointerEvent) => {
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = box.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    // Where it rests when not dragged, so the limits can be worked out from the screen's edges.
    const restLeft = r.left - offset.x;
    const restTop = r.top - offset.y;
    const x = Math.min(Math.max(d.ox + (e.clientX - d.px), 4 - restLeft), window.innerWidth - r.width - 4 - restLeft);
    const y = Math.min(Math.max(d.oy + (e.clientY - d.py), 8 - restTop), window.innerHeight - r.height - 8 - restTop);
    setOffset({ x, y });
  };
  const onUp = () => {
    drag.current = null;
  };

  const expand = () => {
    closeMini();
    navigate(watchPathFor(type, target.media.id, target.season, target.episode, target.along?.id), {
      state: { media: target.media, tab: 'home', ...(target.along ? { along: target.along.name } : {}) },
    });
  };

  return (
    <div
      ref={box}
      role="region"
      aria-label={`Mini player: ${title}`}
      className="fixed z-[235] overflow-hidden rounded-xl bg-black shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] ring-1 ring-white/15"
      style={{ width: W, left: MARGIN, bottom: `calc(${MARGIN + 76}px + env(safe-area-inset-bottom))`, transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div className="relative aspect-video w-full">
        <Suspense fallback={<div className="grid size-full place-items-center bg-black"><TvLogo markOnly className="animate-pulse [&_img]:h-8" /></div>}>
          <TvStreamPlayer
            key={`${target.media.id}-${target.season}-${target.episode}`}
            mini
            media={target.media}
            initialSeason={target.season}
            initialEpisode={target.episode}
            onClose={closeMini}
          />
        </Suspense>

        {/* The top edge: drag by it, and the controls live on it. */}
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className={cn('absolute inset-x-0 top-0 z-50 flex cursor-grab touch-none items-center gap-1.5 bg-gradient-to-b from-black/80 to-transparent px-2 pt-1.5 pb-5 active:cursor-grabbing')}
        >
          <TvLogo markOnly className="[&_img]:h-5" />
          <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-white">
            {title}
            {type === 'tv' && <span className="text-white/65"> · S{target.season} E{target.episode}</span>}
          </span>
          <button type="button" aria-label="Open full screen" onPointerDown={(e) => e.stopPropagation()} onClick={expand} className="grid size-7 place-items-center rounded-full text-white/90 transition hover:bg-white/15">
            <Maximize2 className="size-3.5" />
          </button>
          <button type="button" aria-label="Close mini player" onPointerDown={(e) => e.stopPropagation()} onClick={closeMini} className="grid size-7 place-items-center rounded-full text-white/90 transition hover:bg-white/15">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {target.along && (
        <p className="truncate bg-[#12141c] px-3 py-1.5 text-[11.5px] text-white/70">
          Watching along with {target.along.name}
          {friend ? ` · ${watchingLine(friend)}` : ' · press play together'}
        </p>
      )}
    </div>
  );
}
