import { cn } from '@pingo/ui';
import { ArrowUpLeft, ChevronLeft, Clock, Heart, Play, Plus, Radio, Search, Shuffle, UserCheck, UserPlus, X } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import * as api from '../saavn/api.js';
import * as library from '../saavn/library.js';
import * as playback from '../saavn/playback.js';
import { homeLanguages } from '../saavn/taste.js';
import type { Item, Module, Song } from '../saavn/types.js';
import { Cover, Heading, ItemTile, Note, RoundTile, SongRow, Strip, Tile, clean, compact, names, plural, useLoad, type Open } from './parts.js';

/** What every view needs from the sheet around it. */
export interface MusicCtx {
  open: Open & { liked: () => void; mine: (id: string) => void };
  more: (song: Song) => void;
  nowId: string | undefined;
  paused: boolean;
  toast: (text: string) => void;
}
export const Ctx = createContext<MusicCtx | null>(null);
const useCtx = () => useContext(Ctx)!;

function Loading() {
  return (
    <div className="grid gap-3 px-[18px] pt-5" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="size-[46px] animate-pulse rounded-[10px] bg-sunken" />
          <span className="grid flex-1 gap-2">
            <span className="h-3 w-1/2 animate-pulse rounded bg-sunken" />
            <span className="h-2.5 w-1/3 animate-pulse rounded bg-sunken" />
          </span>
        </div>
      ))}
    </div>
  );
}

function Failed({ text }: { text?: string }) {
  return <p className="px-8 py-12 text-center text-[13.5px] leading-relaxed text-text-secondary">{text ? `Couldn't load this. ${text}` : "Couldn't load this right now."}</p>;
}

const songsOf = (items: Item[]) => items.filter((i): i is Song => i.type === 'song');

function SongList({ songs, label, kind, numbered, sub }: { songs: Song[]; label: string; kind: playback.Q.QueueSource['kind']; numbered?: boolean; sub?: (s: Song) => string }) {
  const { more, nowId, paused } = useCtx();
  return (
    <div className="px-2">
      {songs.map((s, i) => (
        <SongRow
          key={`${s.id}-${i}`}
          song={s}
          index={i}
          {...(numbered ? { numbered } : {})}
          {...(sub ? { sub: sub(s) } : {})}
          now={s.id === nowId}
          paused={paused}
          onPlay={() => (s.id === nowId ? playback.toggleCurrent() : playback.playList(songs, i, { kind, label }))}
          onMore={() => more(s)}
        />
      ))}
    </div>
  );
}

/* ---------- Home ---------- */

/** One of JioSaavn's home modules, drawn by what it holds. */
function ModuleRow({ m, open }: { m: Module; open: Open }) {
  const songs = songsOf(m.items);
  const stations = m.items.every((i) => i.type === 'station' || i.type === 'artist');
  const small = /chart/i.test(m.title);
  return (
    <section>
      <Heading>{m.title}</Heading>
      <Strip>
        {m.items.slice(0, 16).map((it) => (
          <ItemTile key={`${it.type}-${it.id}`} item={it} open={open} {...(small && !stations ? { small } : {})} list={songs} />
        ))}
      </Strip>
    </section>
  );
}

export function HomeView() {
  const { open } = useCtx();
  const lib = library.useLibrary();
  const last = lib.plays[0]?.song;
  const langs = useMemo(() => homeLanguages(library.currentTaste()), []);
  const home = useLoad(`home:${langs.join()}`, () => api.home(langs));
  // Last time's home, painted at once while today's arrives: the first answer can take seconds.
  const savedKey = `pingo-music-home:${langs.join()}`;
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(savedKey) ?? 'null') as { modules: Module[] } | null;
    } catch {
      return null;
    }
  }, [savedKey]);
  useEffect(() => {
    if (!home.data) return;
    try {
      localStorage.setItem(savedKey, JSON.stringify(home.data));
    } catch {
      // Storage full or blocked: the next open just waits for the network.
    }
  }, [home.data, savedKey]);
  const because = useLoad(last ? `because:${last.id}` : 'because:none', () => (last ? api.songRadio([last.id], 10).then((r) => r.songs) : Promise.resolve([] as Song[])));
  const mods = home.data?.modules ?? saved?.modules ?? [];
  const moods = mods.find((m) => /mood|genre/i.test(m.title));
  const first = mods.find((m) => songsOf(m.items).length > 2);
  const fallback = first ? songsOf(first.items) : [];
  const stack = (because.data?.length ? because.data : fallback).slice(0, 3);

  return (
    <div className="pb-32">
      <button
        type="button"
        onClick={() => void (last ? playback.playForYou() : fallback[0] && playback.playList(fallback, 0, { kind: 'song', label: 'For you' }))}
        className="mx-[18px] mt-3.5 flex w-[calc(100%-36px)] items-center gap-4 text-left"
      >
        <span className="relative h-24 w-[118px] shrink-0">
          {stack.map((s, i) => (
            <img
              key={s.id}
              src={s.image}
              alt=""
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
              className="absolute size-[84px] rounded-xl object-cover shadow-[0_10px_24px_-14px_rgba(0,0,0,0.6)]"
              style={{ left: i * 17, top: 10 - i * 5, transform: `rotate(${[-6, -1, 5][i]}deg)` }}
            />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <small className="block text-[12.5px] text-text-secondary">For you, right now</small>
          <b className="my-0.5 block text-[19px] font-semibold leading-tight tracking-[-0.01em]">{last ? `More like ${clean(last.name)}` : 'Start with what is trending'}</b>
          <span className="text-[12.5px] text-text-secondary">One tap, and it keeps going.</span>
        </span>
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-ink text-page">
          <Play size={20} className="ml-0.5 fill-current" />
        </span>
      </button>

      {last && !!because.data?.length && (
        <>
          <p className="mx-[18px] mb-3 mt-6 text-[13px] font-medium text-text-secondary">
            Because you played <b className="font-semibold text-ink">{clean(last.name)}</b>
          </p>
          <Strip>
            {because.data.map((s, i) => (
              <Tile key={s.id} img={s.image} title={s.name} sub={names(s)} onClick={() => playback.playList(because.data!, i, { kind: 'song', label: `Because you played ${clean(last.name)}` })} />
            ))}
          </Strip>
        </>
      )}

      {home.loading && !mods.length && <Loading />}
      {home.error && !mods.length && <Failed text={home.error} />}

      {moods && (
        <section>
          <Heading>Moods</Heading>
          <div className="grid auto-cols-[150px] grid-flow-col grid-rows-2 gap-2.5 overflow-x-auto px-[18px] scrollbar-none">
            {moods.items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => (it.type === 'playlist' ? open.playlist(it) : it.type === 'channel' ? open.channel(it) : undefined)}
                className="relative flex h-16 items-end overflow-hidden rounded-xl p-2.5 text-left text-[13.5px] font-semibold leading-tight text-white"
              >
                {'image' in it && <img src={it.image} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} className="absolute inset-0 size-full object-cover" />}
                <span className="absolute inset-0 bg-gradient-to-b from-transparent to-black/55" />
                <span className="relative line-clamp-2">{clean(it.name)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {mods.filter((m) => m !== moods).map((m) => (
        <ModuleRow key={m.key} m={m} open={open} />
      ))}
    </div>
  );
}

/* ---------- Search ---------- */

export function SearchView({ q, onPick }: { q: string; onPick: (q: string) => void }) {
  const { open } = useCtx();
  const lib = library.useLibrary();
  const term = q.trim();
  const top = useLoad(term ? undefined : 'top-searches', () => api.topSearches());
  const res = useLoad(term ? `search:${term.toLowerCase()}` : undefined, () => api.searchAll(term));
  const remember = () => library.rememberSearch(term);
  /** What is open in full ("See all") and for which search. */
  const [all, setAll] = useState<{ term: string; kind: AllKind }>();
  const openRemember: Open = useMemo(
    () => ({
      album: (a) => (remember(), open.album(a)),
      playlist: (p) => (remember(), open.playlist(p)),
      artist: (a) => (remember(), open.artist(a)),
      channel: (c) => (remember(), open.channel(c)),
      station: (s) => (remember(), open.station(s)),
      song: (s, l) => (remember(), open.song(s, l)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, open],
  );

  if (!term) {
    return (
      <div className="pb-32">
        {lib.searches.length > 0 && (
          <>
            <p className="mx-[18px] mb-1 mt-5 text-[13px] font-medium text-text-secondary">Recent searches</p>
            {lib.searches.map((s) => (
              <div key={s} className="flex items-center">
                <button type="button" onClick={() => onPick(s)} className="flex flex-1 items-center gap-3 px-[18px] py-2.5 text-left">
                  <Clock size={17} className="text-text-tertiary" />
                  {s}
                  <ArrowUpLeft size={17} className="ml-auto text-text-tertiary" />
                </button>
                <button type="button" aria-label={`Remove ${s}`} onClick={() => library.forgetSearch(s)} className="mr-2 grid size-9 place-items-center text-text-tertiary">
                  <X size={15} />
                </button>
              </div>
            ))}
          </>
        )}
        {!!top.data?.length && (
          <>
            <p className="mx-[18px] mb-1 mt-5 text-[13px] font-medium text-text-secondary">Trending searches</p>
            {top.data.slice(0, 8).map((it) => (
              <button key={`${it.type}-${it.id}`} type="button" onClick={() => onPick(it.name)} className="flex w-full items-center gap-3 px-[18px] py-2.5 text-left">
                <Search size={17} className="text-text-tertiary" />
                {clean(it.name)}
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  if (res.loading) return <Loading />;
  if (res.error) return <Failed text={res.error} />;
  const r = res.data!;
  const empty = !r.songs.length && !r.artists.length && !r.albums.length && !r.playlists.length;
  if (empty) return <p className="px-8 py-12 text-center text-[13.5px] leading-relaxed text-text-secondary">Nothing found for "{term}".<br />Try spelling it the way it sounds.</p>;
  const best = r.top[0];
  if (all?.term === term) {
    return (
      <div className="pb-32">
        <button type="button" onClick={() => setAll(undefined)} className="mx-[18px] mt-3 flex items-center gap-1 text-[13px] font-medium text-text-secondary">
          <ChevronLeft size={16} />
          All results
        </button>
        <Heading first>
          {ALL_TITLE[all.kind]} for "{term}"
        </Heading>
        {all.kind === 'songs' ? (
          <AllSongs key={`all-${term}`} term={term} first={r.songs} onPlay={remember} all />
        ) : (
          <AllItems key={`${all.kind}-${term}`} kind={all.kind} term={term} first={r[all.kind]} open={openRemember} />
        )}
      </div>
    );
  }
  const seeAll = (kind: AllKind) => () => setAll({ term, kind });
  return (
    <div className="pb-32">
      {r.corrected && (
        <p className="mx-[18px] mt-3 text-[13px] text-text-secondary">
          Showing results for <b className="font-semibold text-ink">{r.corrected}</b>
        </p>
      )}
      {best && best.type !== 'song' && (
        <>
          <Heading first>Top result</Heading>
          <Strip>
            <ItemTile item={best} open={openRemember} />
          </Strip>
        </>
      )}
      {!!r.songs.length && (
        <>
          <Heading first={!best || best.type === 'song'}>Songs</Heading>
          <AllSongs key={term} term={term} first={r.songs} onPlay={remember} onAll={seeAll('songs')} />
        </>
      )}
      {!!r.artists.length && (
        <>
          <Heading onAll={seeAll('artists')}>Artists</Heading>
          <Strip>{r.artists.map((it) => <ItemTile key={it.id} item={it} open={openRemember} />)}</Strip>
        </>
      )}
      {!!r.albums.length && (
        <>
          <Heading onAll={seeAll('albums')}>Albums</Heading>
          <Strip>{r.albums.map((it) => <ItemTile key={it.id} item={it} open={openRemember} small />)}</Strip>
        </>
      )}
      {!!r.playlists.length && (
        <>
          <Heading onAll={seeAll('playlists')}>Playlists</Heading>
          <Strip>{r.playlists.map((it) => <ItemTile key={it.id} item={it} open={openRemember} small />)}</Strip>
        </>
      )}
    </div>
  );
}

type AllKind = 'songs' | 'artists' | 'albums' | 'playlists';
const ALL_TITLE: Record<AllKind, string> = { songs: 'Songs', artists: 'Artists', albums: 'Albums', playlists: 'Playlists' };
const SEARCH_PAGE = { artists: api.searchArtists, albums: api.searchAlbums, playlists: api.searchPlaylists } as const;

/** Every artist, album or playlist for a search, in a grid, page by page as the end nears. */
function AllItems({ kind, term, first, open }: { kind: Exclude<AllKind, 'songs'>; term: string; first: Item[]; open: Open }) {
  const [items, setItems] = useState<Item[]>(first);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const loadMore = useRef<() => void>(() => {});
  loadMore.current = () => {
    if (busy || !hasMore) return;
    setBusy(true);
    (SEARCH_PAGE[kind](term, page + 1) as Promise<{ items: Item[]; page: number; more: boolean }>).then(
      (r) => {
        setItems((cur) => {
          const seen = new Set(cur.map((i) => i.id));
          return [...cur, ...r.items.filter((i) => !seen.has(i.id))];
        });
        setPage(r.page);
        setHasMore(r.more && r.items.length > 0);
        setBusy(false);
      },
      () => {
        setHasMore(false);
        setBusy(false);
      },
    );
  };
  useEffect(() => {
    if (busy || !hasMore || !end.current) return undefined;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && loadMore.current(), { rootMargin: '600px' });
    io.observe(end.current);
    return () => io.disconnect();
  }, [busy, hasMore, items.length]);
  return (
    <>
      <div className={cn('grid gap-x-3.5 gap-y-5 px-[18px]', kind === 'artists' ? 'grid-cols-3' : 'grid-cols-2')}>
        {items.map((it) => (
          <ItemTile key={`${it.type}-${it.id}`} item={it} open={open} fill />
        ))}
      </div>
      <div ref={end} className="grid h-16 place-items-center text-[12.5px] text-text-tertiary">
        {busy ? <span className="size-5 animate-spin rounded-full border-2 border-line border-t-ink" aria-label="Loading more" /> : null}
      </div>
    </>
  );
}

/**
 * The songs for a search. "Search everything" gives only the best few, so the
 * full list is asked for page by page: five at first, then all of them on
 * "See all songs", the next page arriving as the end comes into view.
 */
function AllSongs({ term, first, onPlay, all, onAll }: { term: string; first: Song[]; onPlay: () => void; all?: boolean; onAll?: () => void }) {
  const { more, nowId, paused } = useCtx();
  const [songs, setSongs] = useState<Song[]>(first);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const loadMore = useRef<() => void>(() => {});
  loadMore.current = () => {
    if (busy || !hasMore) return;
    setBusy(true);
    api.searchSongs(term, page + 1).then(
      (r) => {
        setSongs((cur) => {
          const seen = new Set(cur.map((s) => s.id));
          return [...cur, ...r.items.filter((s) => !seen.has(s.id))];
        });
        setPage(r.page);
        setHasMore(r.more && r.items.length > 0);
        setBusy(false);
      },
      () => {
        setHasMore(false);
        setBusy(false);
      },
    );
  };

  // The first page straight away, so "See all songs" has something to open onto.
  useEffect(() => {
    loadMore.current();
  }, []);

  // Watched afresh after every page, so a short page that leaves the end in view still asks for the next.
  useEffect(() => {
    if (!all || busy || !hasMore || !end.current) return undefined;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && loadMore.current(), { rootMargin: '600px' });
    io.observe(end.current);
    return () => io.disconnect();
  }, [all, busy, hasMore, songs.length]);

  const shown = all ? songs : songs.slice(0, 5);
  const source = { kind: 'search' as const, label: `"${term}"` };
  return (
    <div className="px-2">
      {shown.map((s, i) => (
        <SongRow
          key={s.id}
          song={s}
          big={i === 0}
          now={s.id === nowId}
          paused={paused}
          onPlay={() => {
            onPlay();
            if (s.id === nowId) playback.toggleCurrent();
            // The songs after this one, then JioSaavn's radio once they run out.
            else playback.playList(shown.slice(i), 0, source);
          }}
          onMore={() => more(s)}
        />
      ))}
      {!all && (songs.length > 5 || hasMore) && (
        <button type="button" onClick={onAll} className="mx-2.5 mt-1 h-10 rounded-full border border-line px-4 text-[13.5px] font-medium active:bg-sunken">
          See all songs
        </button>
      )}
      {all && (
        <div ref={end} className="grid h-14 place-items-center text-[12.5px] text-text-tertiary">
          {busy ? <span className="size-5 animate-spin rounded-full border-2 border-line border-t-ink" aria-label="Loading more" /> : hasMore ? '' : `${songs.length} songs`}
        </div>
      )}
    </div>
  );
}

/* ---------- Library ---------- */

export function LibraryView() {
  const { open, nowId, paused, more } = useCtx();
  const lib = library.useLibrary();
  return (
    <div className="pb-32">
      <div className="grid grid-cols-2 gap-2.5 px-[18px] pt-3.5">
        <button type="button" onClick={open.liked} className="grid min-h-24 gap-4 rounded-2xl bg-gradient-to-br from-[color-mix(in_srgb,#e0559b_22%,var(--color-sunken))] to-sunken p-3.5 text-left">
          <Heart size={22} className="fill-[#e0559b] text-[#e0559b]" />
          <b className="text-[15px] font-semibold">
            Liked songs<small className="block text-[12.5px] font-normal text-text-secondary">{plural(lib.likes.length, 'song', 'songs')}</small>
          </b>
        </button>
        <button
          type="button"
          onClick={() => {
            const p = library.createPlaylist(`My playlist ${lib.playlists.length + 1}`);
            open.mine(p.id);
          }}
          className="grid min-h-24 gap-4 rounded-2xl bg-sunken p-3.5 text-left"
        >
          <Plus size={22} />
          <b className="text-[15px] font-semibold">
            New playlist<small className="block text-[12.5px] font-normal text-text-secondary">Your songs, your order</small>
          </b>
        </button>
      </div>

      {lib.playlists.length > 0 && (
        <>
          <Heading>Your playlists</Heading>
          <Strip>
            {lib.playlists.map((p) => (
              <Tile key={p.id} img={p.songs[0]?.image} title={p.name} sub={plural(p.songs.length, 'song', 'songs')} small onClick={() => open.mine(p.id)} />
            ))}
          </Strip>
        </>
      )}

      <Heading>Artists you follow</Heading>
      {lib.follows.length ? (
        <Strip>
          {lib.follows.map((f) => (
            <RoundTile key={f.artist.id} img={f.artist.image} title={f.artist.name} sub="Artist" onClick={() => open.artist(f.artist)} />
          ))}
        </Strip>
      ) : (
        <Note>Follow an artist and they show up here.</Note>
      )}

      <Heading>Recently played</Heading>
      {lib.plays.length ? (
        <div className="px-2">
          {lib.plays.slice(0, 12).map((p, i, all) => (
            <SongRow
              key={p.id}
              song={p.song}
              now={p.id === nowId}
              paused={paused}
              onPlay={() => void playback.playKept(all.map((x) => x.song), i, { kind: 'library', label: 'Recently played' })}
              onMore={async () => {
                const s = await api.song(p.id).catch(() => undefined);
                if (s) more(s);
              }}
            />
          ))}
        </div>
      ) : (
        <Note>What you play shows up here.</Note>
      )}
    </div>
  );
}

/* ---------- Album, playlist, liked songs, your playlists ---------- */

function CollectionHero({ img, name, sub, count, onPlay, onShuffle, art }: { img?: string; name: string; sub: string; count: number; onPlay: () => void; onShuffle: () => void; art?: ReactNode }) {
  return (
    <>
      <div className="grid justify-items-center px-6 pt-1 text-center">
        {art ?? <Cover src={img} className="size-[210px] rounded-2xl shadow-[0_26px_46px_-28px_rgba(var(--pm-tone),0.95)]" />}
        <h2 className="mb-1 mt-[18px] text-balance text-[22px] font-semibold leading-tight tracking-[-0.01em]">{name}</h2>
        <p className="text-[13px] text-text-secondary">
          {sub ? `${sub} · ` : ''}
          {plural(count, 'song', 'songs')}
        </p>
      </div>
      <div className="mb-1.5 mt-[18px] flex items-center justify-center gap-3">
        <button type="button" onClick={onShuffle} aria-label="Shuffle" className="grid size-11 place-items-center rounded-full bg-sunken">
          <Shuffle size={20} />
        </button>
        <button type="button" onClick={onPlay} disabled={!count} className="flex h-11 items-center gap-2 rounded-full bg-ink px-6 text-[14.5px] font-semibold text-page disabled:opacity-40">
          <Play size={18} className="fill-current" />
          Play
        </button>
      </div>
    </>
  );
}

function shufflePlay(songs: Song[], source: playback.Q.QueueSource) {
  if (!songs.length) return;
  if (!playback.isShuffling()) playback.toggleShuffle();
  playback.playList(songs, Math.floor(Math.random() * songs.length), source);
}

export function AlbumView({ id }: { id: string }) {
  const a = useLoad(`album:${id}`, () => api.album(id));
  if (a.loading) return <Loading />;
  if (a.error || !a.data) return <Failed {...(a.error ? { text: a.error } : {})} />;
  const al = a.data;
  const songs = al.songs ?? [];
  const source = { kind: 'album' as const, label: al.name, id: al.id };
  return (
    <div className="pb-32">
      <CollectionHero img={al.image} name={al.name} sub={[names(al), al.year || ''].filter(Boolean).join(' · ')} count={songs.length} onPlay={() => playback.playList(songs, 0, source)} onShuffle={() => shufflePlay(songs, source)} />
      <SongList songs={songs} label={al.name} kind="album" numbered />
    </div>
  );
}

export function PlaylistView({ id }: { id: string }) {
  const p = useLoad(`playlist:${id}`, () => api.playlist(id, 1, 100));
  if (p.loading) return <Loading />;
  if (p.error || !p.data) return <Failed {...(p.error ? { text: p.error } : {})} />;
  const pl = p.data;
  const songs = pl.songs ?? [];
  const source = { kind: 'playlist' as const, label: pl.name, id: pl.id };
  return (
    <div className="pb-32">
      <CollectionHero img={pl.image} name={pl.name} sub={pl.followers ? `${compact(pl.followers)} followers` : pl.subtitle} count={songs.length} onPlay={() => playback.playList(songs, 0, source)} onShuffle={() => shufflePlay(songs, source)} />
      <SongList songs={songs} label={pl.name} kind="playlist" />
    </div>
  );
}

/** Liked songs and your own playlists: kept snapshots, looked up for their addresses at play time. */
export function KeptView({ which }: { which: 'liked' | string }) {
  const { nowId, paused, more } = useCtx();
  const lib = library.useLibrary();
  const mine = which === 'liked' ? undefined : lib.playlists.find((p) => p.id === which);
  const kept = which === 'liked' ? lib.likes.map((l) => l.song) : (mine?.songs ?? []);
  const name = which === 'liked' ? 'Liked songs' : (mine?.name ?? 'Playlist');
  const source = { kind: 'library' as const, label: name };
  const playAt = (i: number) => void playback.playKept(kept, i, source);
  return (
    <div className="pb-32">
      <CollectionHero
        name={name}
        sub={which === 'liked' ? 'Yours' : 'Your playlist'}
        count={kept.length}
        onPlay={() => playAt(0)}
        onShuffle={() => {
          if (!kept.length) return;
          if (!playback.isShuffling()) playback.toggleShuffle();
          playAt(Math.floor(Math.random() * kept.length));
        }}
        {...(which === 'liked'
          ? { art: <span className="grid size-[210px] place-items-center rounded-2xl bg-gradient-to-br from-[#e0559b] to-[#8b5dff] text-white"><Heart size={64} className="fill-white" /></span> }
          : { img: kept[0]?.image })}
      />
      {!kept.length && <Note>{which === 'liked' ? 'Tap the heart on a song and it lands here.' : 'Add songs from their ⋯ menu.'}</Note>}
      <div className="px-2">
        {kept.map((k, i) => (
          <SongRow
            key={k.id}
            song={k}
            now={k.id === nowId}
            paused={paused}
            onPlay={() => (k.id === nowId ? playback.toggleCurrent() : playAt(i))}
            onMore={async () => {
              const s = await api.song(k.id).catch(() => undefined);
              if (s) more(s);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Artist ---------- */

export function ArtistView({ id }: { id: string }) {
  const { open, toast } = useCtx();
  const lib = library.useLibrary();
  const a = useLoad(`artist:${id}`, () => api.artist(id));
  if (a.loading) return <Loading />;
  if (a.error || !a.data) return <Failed {...(a.error ? { text: a.error } : {})} />;
  const ar = a.data;
  const following = lib.follows.some((f) => f.artist.id === ar.id);
  return (
    <div className="pb-32">
      <div className="relative -mt-11 h-[300px]">
        <Cover src={ar.image} className="size-full rounded-none" />
        <span className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-surface" />
        <div className="absolute inset-x-5 bottom-1.5">
          <h2 className="text-[30px] font-bold tracking-[-0.02em]">{ar.name}</h2>
          <p className="text-[13px] text-text-secondary">{compact(ar.followers)} followers</p>
        </div>
      </div>
      <div className="flex gap-2.5 px-5 pt-3.5">
        <button
          type="button"
          onClick={() => toast(library.toggleFollow(ar) ? `Following ${ar.name}` : 'Unfollowed')}
          className={cn('flex h-10 items-center gap-1.5 rounded-full border px-4 text-[13.5px] font-medium', following ? 'border-ink bg-ink text-page' : 'border-line')}
        >
          {following ? <UserCheck size={17} /> : <UserPlus size={17} />}
          {following ? 'Following' : 'Follow'}
        </button>
        {ar.hasRadio && (
          <button
            type="button"
            onClick={() => void playback.playArtistRadio(ar.name, ar.language).then(() => toast('Artist radio started'), () => toast('No radio for this artist right now'))}
            className="flex h-10 items-center gap-1.5 rounded-full border border-line px-4 text-[13.5px] font-medium"
          >
            <Radio size={17} />
            Radio
          </button>
        )}
        <button
          type="button"
          disabled={!ar.topSongs.length}
          onClick={() => playback.playList(ar.topSongs, 0, { kind: 'artist', label: ar.name, id: ar.id })}
          className="ml-auto flex h-10 items-center gap-2 rounded-full bg-ink px-[18px] text-[14.5px] font-semibold text-page disabled:opacity-40"
        >
          <Play size={17} className="fill-current" />
          Play
        </button>
      </div>
      {!!ar.topSongs.length && (
        <>
          <Heading>Popular</Heading>
          <SongList songs={ar.topSongs.slice(0, 8)} label={ar.name} kind="artist" numbered sub={(s) => clean(s.album.name)} />
        </>
      )}
      {!!ar.latest.length && (
        <>
          <Heading>Latest release</Heading>
          <Strip>{ar.latest.map((al) => <ItemTile key={al.id} item={al} open={open} small />)}</Strip>
        </>
      )}
      {!!ar.topAlbums.length && (
        <>
          <Heading>Albums</Heading>
          <Strip>{ar.topAlbums.map((al) => <ItemTile key={al.id} item={al} open={open} small />)}</Strip>
        </>
      )}
      {!!ar.singles.length && (
        <>
          <Heading>Singles</Heading>
          <Strip>{ar.singles.map((al) => <ItemTile key={al.id} item={al} open={open} small />)}</Strip>
        </>
      )}
      {!!ar.playlists.length && (
        <>
          <Heading>Featuring {ar.name}</Heading>
          <Strip>{ar.playlists.map((p) => <ItemTile key={p.id} item={p} open={open} small />)}</Strip>
        </>
      )}
      {!!ar.similar.length && (
        <>
          <Heading>Fans also like</Heading>
          <Strip>{ar.similar.map((s) => <ItemTile key={s.id} item={s} open={open} />)}</Strip>
        </>
      )}
      {!!ar.bio.length && (
        <>
          <Heading>About</Heading>
          <p className="mx-[18px] line-clamp-6 text-[13.5px] leading-relaxed text-text-secondary">{ar.bio[0]!.text}</p>
        </>
      )}
    </div>
  );
}

/* ---------- Mood / genre ---------- */

export function ChannelView({ id }: { id: string }) {
  const { open } = useCtx();
  const c = useLoad(`channel:${id}`, () => api.channel(id));
  if (c.loading) return <Loading />;
  if (c.error || !c.data) return <Failed {...(c.error ? { text: c.error } : {})} />;
  const ch = c.data;
  return (
    <div className="pb-32">
      <div className="grid justify-items-center px-6 pt-1 text-center">
        <Cover src={ch.image} className="size-[210px] rounded-[20px]" />
        <h2 className="mb-1 mt-[18px] text-[22px] font-semibold">{ch.name}</h2>
        <p className="text-[13px] capitalize text-text-secondary">{ch.kind}</p>
      </div>
      {ch.modules.map((m) => (
        <ModuleRow key={m.key} m={m} open={open} />
      ))}
    </div>
  );
}
