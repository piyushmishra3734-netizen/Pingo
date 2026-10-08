import { cn } from '@pingo/ui';
import { ArrowDownToLine, ChevronDown, ChevronLeft, CircleMinus, Heart, ListEnd, ListPlus, ListStart, Loader2, Plus, Radio, Search, Send, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useBackStep } from '../../navigation/useBackStep.js';
import { putShare } from '../../share/share-store.js';
import { fromSaavn } from '../catalogue.js';
import { songBody } from '../song-share.js';
import { collectionBody, KIND_LABEL, type SharedCollection } from '../music-share.js';
import * as api from '../saavn/api.js';
import * as downloads from '../saavn/downloads.js';
import { useMusicPlayer } from '../player.js';
import * as library from '../saavn/library.js';
import * as playback from '../saavn/playback.js';
import type { Song } from '../saavn/types.js';
import { MiniPlayer } from './MiniPlayer.js';
import { NowPlaying } from './NowPlaying.js';
import { Cover, clean, names, useCoverTone } from './parts.js';
import { closeMusic, takeMusicTarget, useMusicOpen, useMusicTargetSignal } from './sheet-store.js';
import { AlbumView, ArtistView, ChannelView, Ctx, DownloadsView, HomeView, KeptView, LibraryView, PlaylistView, SearchView, SettingsView, SharedMixView, type MusicCtx } from './views.js';

/**
 * PINGO Music: a sheet that comes up over the app.
 *
 * Calm on purpose. One column, the cover's own colour as the only accent, and
 * nothing that moves unless something is playing. Pages push in from the right
 * and go back the way they came; the player is a line at the bottom until it
 * is tapped, and then it is the whole screen.
 */

type Route = { kind: 'album' | 'playlist' | 'artist' | 'channel' | 'kept' | 'downloads' | 'settings' | 'shared'; id: string; key: number };

/** Playlists sent in a chat and opened here, by route id: their songs travel in the message, not in a route. */
const sharedMixes = new Map<string, SharedCollection>();

/** How far down the sheet has to be pulled before letting go closes it. */
const CLOSE_PULL = 120;
/** How long a page takes to slide back out. */
const POP_MS = 300;

export default function MusicSheet() {
  const open = useMusicOpen();
  const player = useMusicPlayer();
  const queue = playback.useQueue();
  const lib = library.useLibrary();
  const current = playback.Q.current(queue);
  // The queue's song is what is on, unless a song card in a chat took the player over.
  const now = current && player.song ? current : undefined;
  const tone = useCoverTone(downloads.useCover(now?.id, now?.image)) ?? '112,104,136';

  const [tab, setTab] = useState<'home' | 'library'>('home');
  const [stack, setStack] = useState<Route[]>([]);
  const [leaving, setLeaving] = useState<number>();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [np, setNp] = useState(false);
  const [actions, setActionsRaw] = useState<{ song: Song; playlist?: string }>();
  const setActions = useCallback((song?: Song, from?: { playlist: string }) => setActionsRaw(song ? { song, ...(from ? { playlist: from.playlist } : {}) } : undefined), []);
  const [toastText, setToastText] = useState<{ text: string; n: number }>();
  const [pull, setPull] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const pullStart = useRef<number | undefined>(undefined);

  useEffect(() => {
    void library.sync();
  }, []);

  // A beat after typing stops, not on every key.
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(query), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!toastText) return undefined;
    const t = window.setTimeout(() => setToastText(undefined), 1900);
    return () => window.clearTimeout(t);
  }, [toastText]);

  const toast = useCallback((text: string) => setToastText((t) => ({ text, n: (t?.n ?? 0) + 1 })), []);

  const push = useCallback((kind: Route['kind'], id: string) => {
    setStack((s) => [...s, { kind, id, key: ++keyRef.current }]);
  }, []);

  const stackRef = useRef(stack);
  stackRef.current = stack;
  const pop = useCallback(() => {
    const top = stackRef.current[stackRef.current.length - 1];
    if (!top) return;
    setLeaving(top.key);
    window.setTimeout(() => {
      setStack((cur) => cur.filter((r) => r.key !== top.key));
      setLeaving(undefined);
    }, POP_MS);
  }, []);

  const stopSearch = useCallback(() => {
    setSearching(false);
    setQuery('');
    setTerm('');
    input.current?.blur();
  }, []);

  useBackStep(open && !np && !actions && stack.length === 0 && !searching, closeMusic);
  useBackStep(open && !np && !actions && stack.length === 0 && searching, stopSearch);
  useBackStep(open && !np && !actions && stack.length > 0, pop);
  useBackStep(open && !!actions, () => setActions(undefined));

  /**
   * An artist's page, from the player or a song's menu. A song found by search
   * names its artists without their ids; then the artist is searched for.
   */
  const goArtist = useCallback(
    (a: { id: string; name: string }) => {
      setActions(undefined);
      setNp(false);
      if (a.id) {
        setSearching(false);
        push('artist', a.id);
      } else {
        setStack([]);
        setSearching(true);
        setQuery(a.name);
        setTerm(a.name);
      }
    },
    [push],
  );

  /**
   * A song to a friend: the same card the chat's Music tab sends, through the
   * app's one "send to somebody" screen. The sheet steps aside for it and is
   * where it was when they come back.
   */
  const navigate = useNavigate();
  const sendToChat = useCallback(
    async (s: Song) => {
      setActions(undefined);
      const full = api.streamUrl(s, 'normal') ? s : await api.song(s.id).catch(() => undefined);
      const shared = full && fromSaavn(full);
      if (!shared) {
        toast("This song can't be sent");
        return;
      }
      putShare({ text: songBody(shared), label: 'Send song' });
      setNp(false);
      closeMusic();
      navigate('/share');
    },
    [navigate, toast],
  );

  /** Sends a playlist, album or artist to a chat, through the same screen as a song. */
  const shareCollection = useCallback(
    (c: SharedCollection) => {
      putShare({ text: collectionBody(c), label: `Send ${KIND_LABEL[c.kind].toLowerCase()}` });
      setNp(false);
      closeMusic();
      navigate('/share');
    },
    [navigate],
  );

  /* A playlist, album or artist tapped in a chat: open on its page. */
  const targetSignal = useMusicTargetSignal();
  useEffect(() => {
    const t = takeMusicTarget();
    if (!t) return;
    // A fresh start on the page asked for: no search, no pages left open underneath.
    setActions(undefined);
    setNp(false);
    setSearching(false);
    setQuery('');
    setTerm('');
    setStack([]);
    if (t.kind === 'mix') {
      const key = `mix-${sharedMixes.size + 1}`;
      sharedMixes.set(key, t);
      push('shared', key);
    } else push(t.kind, t.id);
  }, [targetSignal, push, setActions]);

  const ctx: MusicCtx = useMemo(() => {
    const o: MusicCtx['open'] = {
      album: (a) => push('album', a.id),
      playlist: (p) => push('playlist', p.id),
      artist: (a) => push('artist', a.id),
      channel: (c) => push('channel', c.id),
      station: (s) => void playback.playStation(s.name, s.language).catch(() => toast('This station is quiet right now')),
      song: (s, list) => {
        const i = list?.findIndex((x) => x.id === s.id) ?? -1;
        if (list && i >= 0) playback.playList(list, i, { kind: 'list', label: 'PINGO Music' });
        else playback.playSong(s);
      },
      liked: () => push('kept', 'liked'),
      mine: (id) => push('kept', id),
      downloads: () => (setSearching(false), push('downloads', '')),
      settings: () => push('settings', ''),
    };
    return { open: o, more: setActions, share: shareCollection, nowId: now?.id, paused: !player.playing, toast };
  }, [push, toast, now?.id, player.playing, setActions, shareCollection]);

  /* Pull the top of the sheet down to close it. */
  const onPullDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('input,button')) return;
    pullStart.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPullMove = (e: ReactPointerEvent) => {
    if (pullStart.current === undefined) return;
    setPull(Math.max(0, e.clientY - pullStart.current));
  };
  const onPullEnd = () => {
    if (pullStart.current === undefined) return;
    pullStart.current = undefined;
    if (pull > CLOSE_PULL) closeMusic();
    setPull(0);
  };

  const base = searching ? <SearchView q={term} onPick={(q) => { setQuery(q); setTerm(q); }} /> : tab === 'home' ? <HomeView /> : <LibraryView />;
  const sheetStyle = { '--pm-tone': tone, transform: open ? `translateY(${pull}px)` : 'translateY(100%)', transition: pull ? 'none' : undefined } as CSSProperties;
  const liked = actions ? lib.likes.some((l) => l.song.id === actions.song.id) : false;

  return (
    <Ctx.Provider value={ctx}>
      <div
        aria-hidden
        onClick={closeMusic}
        className={cn('fixed inset-0 z-[440] bg-black/40 transition-opacity duration-[380ms]', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <section
        aria-label="PINGO Music"
        aria-hidden={!open}
        {...(open ? {} : { inert: true })}
        style={sheetStyle}
        className="fixed inset-x-0 bottom-0 top-[max(12px,env(safe-area-inset-top))] z-[441] mx-auto flex max-w-[560px] flex-col overflow-clip rounded-t-[30px] bg-surface text-ink shadow-[0_-24px_60px_-30px_rgba(0,0,0,0.5)] transition-transform duration-[420ms] ease-[var(--ease-standard)]"
      >
        {/* What is playing, as a faint wash behind everything. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-[rgba(var(--pm-tone),0.16)] to-transparent transition-colors duration-700" />

        <header className="relative shrink-0 touch-none px-[18px] pb-2" onPointerDown={onPullDown} onPointerMove={onPullMove} onPointerUp={onPullEnd} onPointerCancel={onPullEnd}>
          <span aria-hidden className="mx-auto mb-2 mt-2 block h-1 w-9 rounded-full bg-ink/15" />
          <div className="flex h-[34px] items-center gap-2">
            <img src="/pingo-mark.svg" alt="" className="size-6" draggable={false} />
            <span className="text-[19px] font-medium tracking-[-0.01em]">
              pingo <span className="font-normal text-text-secondary">music</span>
            </span>
            <div role="tablist" className={cn('ml-auto flex rounded-full bg-sunken p-[3px] transition-opacity', searching && 'pointer-events-none opacity-0')}>
              {(['home', 'library'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => {
                    setTab(t);
                    setStack([]);
                  }}
                  className={cn('h-7 rounded-full px-3 text-[13px] font-medium capitalize transition-colors duration-quick', tab === t ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-text-secondary')}
                >
                  {t}
                </button>
              ))}
            </div>
            <button type="button" onClick={closeMusic} aria-label="Close PINGO Music" className="grid size-9 place-items-center rounded-full active:bg-sunken">
              <ChevronDown size={22} />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label className="flex h-11 flex-1 items-center gap-2.5 rounded-[14px] bg-sunken px-3.5">
              <Search size={18} className="shrink-0 text-text-tertiary" />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => {
                  setSearching(true);
                  setStack([]);
                }}
                enterKeyHint="search"
                placeholder="Songs, artists, albums"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
              />
              {query && (
                <button type="button" aria-label="Clear" onClick={() => { setQuery(''); setTerm(''); input.current?.focus(); }} className="grid size-6 place-items-center rounded-full bg-text-tertiary/30 text-surface">
                  <X size={13} strokeWidth={3} />
                </button>
              )}
            </label>
            {searching && (
              <button type="button" onClick={stopSearch} className="h-11 px-1 text-[14.5px] font-medium">
                Cancel
              </button>
            )}
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-clip">
          <div className="absolute inset-0 overflow-y-auto overscroll-contain">{base}</div>
          {stack.map((r, i) => (
            <div
              key={r.key}
              className={cn(
                'absolute inset-0 overflow-y-auto overscroll-contain bg-surface',
                r.key === leaving ? 'animate-[pm-pop_300ms_var(--ease-standard)_both]' : 'animate-[pm-push_340ms_var(--ease-standard)_both]',
              )}
              style={{ zIndex: i + 1 }}
            >
              <div className="sticky top-0 z-10 flex h-11 items-center px-2">
                <button type="button" onClick={pop} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-surface/70 backdrop-blur active:bg-sunken">
                  <ChevronLeft size={24} />
                </button>
              </div>
              <Page route={r} onGone={pop} />
            </div>
          ))}
        </div>

        {toastText && (
          <div key={toastText.n} role="status" className="pointer-events-none absolute inset-x-0 bottom-[92px] z-20 flex justify-center">
            <span className="animate-[pm-toast_1900ms_var(--ease-standard)_both] rounded-full bg-ink px-4 py-2 text-[13.5px] font-medium text-page shadow-lg">{toastText.text}</span>
          </div>
        )}

        {now && <MiniPlayer song={now} onOpen={() => setNp(true)} toast={toast} />}

        <NowPlaying
          open={np}
          onClose={() => setNp(false)}
          onMore={setActions}
          onArtist={(s) => s.artists[0] && goArtist(s.artists[0])}
          toast={toast}
        />

        {/* The ⋯ menu for a song. */}
        <div
          aria-hidden
          onClick={() => setActions(undefined)}
          className={cn('absolute inset-0 z-40 bg-black/35 transition-opacity duration-300', actions ? 'opacity-100' : 'pointer-events-none opacity-0')}
        />
        <div
          {...(actions ? {} : { inert: true })}
          className={cn(
            'absolute inset-x-0 bottom-0 z-40 max-h-[80%] overflow-y-auto rounded-t-[26px] bg-surface pb-[max(14px,env(safe-area-inset-bottom))] pt-2 transition-transform duration-[360ms] ease-[var(--ease-standard)]',
            actions ? 'translate-y-0' : 'translate-y-full',
          )}
        >
          {actions && (
            <>
              <span aria-hidden className="mx-auto mb-2 block h-1 w-9 rounded-full bg-ink/15" />
              <div className="flex items-center gap-3 px-5 pb-3">
                <Cover src={actions.song.image} className="size-12" />
                <span className="min-w-0">
                  <b className="block truncate text-[15px] font-semibold">{clean(actions.song.name)}</b>
                  <small className="block truncate text-[13px] text-text-secondary">{names(actions.song)}</small>
                </span>
              </div>
              <ActionList
                song={actions.song}
                {...(actions.playlist ? { inPlaylist: actions.playlist } : {})}
                liked={liked}
                playlists={lib.playlists.map((p) => ({ id: p.id, name: p.name }))}
                done={(text) => {
                  setActions(undefined);
                  if (text) toast(text);
                }}
                goArtist={goArtist}
                send={() => void sendToChat(actions.song)}
              />
            </>
          )}
        </div>
      </section>
    </Ctx.Provider>
  );
}

function Page({ route, onGone }: { route: Route; onGone: () => void }) {
  switch (route.kind) {
    case 'album':
      return <AlbumView id={route.id} />;
    case 'playlist':
      return <PlaylistView id={route.id} />;
    case 'artist':
      return <ArtistView id={route.id} />;
    case 'channel':
      return <ChannelView id={route.id} />;
    case 'kept':
      return <KeptView which={route.id} onGone={onGone} />;
    case 'downloads':
      return <DownloadsView />;
    case 'settings':
      return <SettingsView />;
    case 'shared': {
      const mix = sharedMixes.get(route.id);
      return mix ? <SharedMixView mix={mix} /> : null;
    }
  }
}

function ActionList({
  song,
  liked,
  playlists,
  done,
  goArtist,
  send,
  inPlaylist,
}: {
  song: Song;
  /** Opened from one of your playlists: it can take the song out. */
  inPlaylist?: string;
  liked: boolean;
  playlists: { id: string; name: string }[];
  done: (toast?: string) => void;
  goArtist: (a: { id: string; name: string }) => void;
  send: () => void;
}) {
  const artist = song.artists[0];
  const row = 'flex w-full items-center gap-4 px-5 py-3 text-left text-[15px] active:bg-sunken';
  const dl = downloads.useDownloads();
  const kept = !!dl.done[song.id];
  const coming = dl.active[song.id];
  return (
    <div>
      <button type="button" className={row} onClick={send}>
        <Send size={21} className="text-text-secondary" /> Send to chat
      </button>
      {kept ? (
        <button type="button" className={row} onClick={() => (void downloads.remove(song.id), done('Removed from downloads'))}>
          <CircleMinus size={21} className="text-text-secondary" /> Remove download
        </button>
      ) : coming && !coming.failed ? (
        <button type="button" className={row} onClick={() => (downloads.cancel(song.id), done('Download cancelled'))}>
          <Loader2 size={21} className="animate-spin text-text-secondary" /> Downloading {Math.round(coming.progress * 100)}%, tap to cancel
        </button>
      ) : (
        <button type="button" className={row} onClick={() => (coming?.failed ? downloads.retry(song.id) : downloads.download([song]), done('Downloading'))}>
          <ArrowDownToLine size={21} className="text-text-secondary" /> Download
        </button>
      )}
      <button type="button" className={row} onClick={() => (playback.playNext([song]), done('Playing next'))}>
        <ListStart size={21} className="text-text-secondary" /> Play next
      </button>
      <button type="button" className={row} onClick={() => (playback.addToQueue([song]), done('Added to queue'))}>
        <ListEnd size={21} className="text-text-secondary" /> Add to queue
      </button>
      <button type="button" className={row} onClick={() => done(library.toggleLike(song) ? 'Added to Liked songs' : 'Removed from Liked songs')}>
        <Heart size={21} className={cn(liked ? 'fill-[#e0559b] text-[#e0559b]' : 'text-text-secondary')} /> {liked ? 'Remove from Liked songs' : 'Like'}
      </button>
      {inPlaylist && (
        <button type="button" className={row} onClick={() => (library.removeFromPlaylist(inPlaylist, song.id), done('Removed from this playlist'))}>
          <CircleMinus size={21} className="text-text-secondary" /> Remove from this playlist
        </button>
      )}
      {playlists.filter((p) => p.id !== inPlaylist).map((p) => (
        <button key={p.id} type="button" className={row} onClick={() => (library.addToPlaylist(p.id, song), done(`Added to ${p.name}`))}>
          <ListPlus size={21} className="text-text-secondary" /> Add to "{p.name}"
        </button>
      ))}
      <button type="button" className={row} onClick={() => (library.createPlaylist(`My playlist ${playlists.length + 1}`, [song]), done('Playlist created'))}>
        <Plus size={21} className="text-text-secondary" /> New playlist with this song
      </button>
      <button type="button" className={row} onClick={() => (playback.playSong(song, `${clean(song.name)} Radio`), done('Radio started'))}>
        <Radio size={21} className="text-text-secondary" /> Start radio
      </button>
      {artist && (
        <button type="button" className={row} onClick={() => goArtist(artist)}>
          <UserRound size={21} className="text-text-secondary" /> Go to {artist.name}
        </button>
      )}
    </div>
  );
}
