import { cn } from '@pingo/ui';
import { ListMusic, Loader2, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import * as api from './saavn/api.js';
import type { Song as SaavnSong } from './saavn/types.js';
import type { Song } from './sheets.js';

/**
 * Browsing the JioSaavn catalogue page by page, shared by the story/camera sheet
 * and the chat/profile picker.
 *
 * The same backend as PINGO Music (`pingo-saavn`, through `saavn/api.ts`), so
 * a search here finds what it finds there. Songs, playlists, artists' songs
 * and searches page with a 1-based `page`; `searchPlaylists` finds JioSaavn's
 * own editorial playlists (charts, new releases, every language), which is
 * what the shelves are.
 */

/** The shelf of your own uploaded songs. Not a search term: it is read from the songs Worker. */
export const UPLOADS = '@uploads';

/** Each shelf plays one playlist and offers a row of more playlists found by `lists`. */
export interface Shelf { label: string; src: string; lists?: string }
export const MUSIC_SHELVES: Shelf[] = [
  { label: 'For you', src: 'pl:110858205', lists: 'hits' },
  { label: 'Trending', src: 'pl:47599074', lists: 'trending' },
  { label: 'Top 50', src: 'pl:1134548194', lists: 'India Superhits Top 50' },
  { label: 'New', src: 'pl:6689255', lists: 'new releases' },
  { label: 'Hindi', src: 'pl:1134543272', lists: 'hindi' },
  { label: 'Punjabi', src: 'pl:1134543511', lists: 'punjabi' },
  { label: 'English', src: 'pl:1134595537', lists: 'english' },
  { label: 'Tamil', src: 'pl:1134651042', lists: 'tamil' },
  { label: 'Telugu', src: 'pl:1134643225', lists: 'telugu' },
  { label: 'Bhojpuri', src: 'pl:1134768973', lists: 'bhojpuri' },
  { label: 'Marathi', src: 'pl:1134710071', lists: 'marathi' },
  { label: 'Bengali', src: 'pl:1134638573', lists: 'bengali' },
  { label: 'Kannada', src: 'pl:1134591169', lists: 'kannada' },
  { label: 'Malayalam', src: 'pl:1134705865', lists: 'malayalam' },
  { label: 'Haryanvi', src: 'pl:1134770917', lists: 'haryanvi' },
  { label: 'Gujarati', src: 'pl:1134743773', lists: 'gujarati' },
  { label: 'Uploads', src: UPLOADS },
];

/** A card in the sideways row: a playlist, or - on a search - JioSaavn's top artist/album matches. */
export interface Playlist { id: string; name: string; img: string; count: number; kind?: 'playlist' | 'artist' | 'album' }

/** The song source a card opens: `pl:`, `ar:` or `al:` plus its id. */
export const cardSrc = (p: Playlist) => `${p.kind === 'artist' ? 'ar' : p.kind === 'album' ? 'al' : 'pl'}:${p.id}`;

const LIMIT = 20;

/**
 * A catalogue song as the pickers carry it. The 160 kbps address, whatever the
 * connection: it travels in a shared song's link and plays on the other phone,
 * and 160 is what JioSaavn plays by default. The small cover keeps that link short.
 */
const small = (img: string) => img.replace(/(\d{2,3})x\1(?=\.\w+$)/, '150x150');
export function fromSaavn(s: SaavnSong): Song | undefined {
  const url = api.streamUrl(s, 'normal');
  if (!url) return undefined;
  return { name: s.name, artist: s.artists.map((a) => a.name).filter(Boolean).slice(0, 2).join(', '), img: small(s.image), url, secs: s.secs || 180, start: 30 };
}
const songs = (list: SaavnSong[] | undefined) => (list ?? []).map(fromSaavn).filter((s): s is Song => !!s);

/** One page of songs: `pl:` a playlist, `ar:` an artist's songs, `al:` an album, anything else a search. */
async function songPage(src: string, page: number) {
  const kind = /^(pl|ar|al):/.exec(src)?.[1];
  const id = kind ? src.slice(3) : '';
  if (kind === 'pl') {
    const p = await api.playlist(id, page, LIMIT);
    return { items: songs(p.songs), last: !p.more || !p.songs?.length };
  }
  if (kind === 'al') return { items: songs((await api.album(id)).songs), last: true };
  const r = kind === 'ar' ? await api.artistSongs(id, page) : await api.searchSongs(src, page);
  return { items: songs(r.items), last: !r.more || !r.items.length };
}

/**
 * What JioSaavn puts above the songs when you search: its top result and the
 * best artist and album matches. Searching "arijit singh" or "aashiqui 2"
 * found songs that merely mention them; the app leads with the artist and the
 * album themselves, and that is what made the two feel different.
 */
async function topMatches(q: string): Promise<Playlist[]> {
  const d = await api.searchAll(q).catch(() => undefined);
  if (!d) return [];
  const cards: Playlist[] = [];
  const seen = new Set<string>();
  for (const hit of [...d.top, ...d.artists.slice(0, 3), ...d.albums.slice(0, 3)]) {
    const kind = hit.type === 'artist' ? 'artist' : hit.type === 'album' ? 'album' : undefined;
    if (!kind || seen.has(hit.id)) continue;
    seen.add(hit.id);
    cards.push({ id: hit.id, name: hit.name, img: small(hit.image), count: 0, kind });
  }
  return cards;
}

async function listPage(src: string, page: number) {
  // `q:` marks a search typed by the person, which leads with the top artist/album matches.
  const typed = src.startsWith('q:');
  const q = typed ? src.slice(2) : src;
  const [d, top] = await Promise.all([api.searchPlaylists(q, page), typed && page === 1 ? topMatches(q) : Promise.resolve([] as Playlist[])]);
  return {
    items: [...top, ...d.items.filter((p) => p.songCount > 0).map((p): Playlist => ({ id: p.id, name: p.name, img: small(p.image), count: p.songCount, kind: 'playlist' }))],
    last: !d.more || !d.items.length,
  };
}

interface Pages<T> { items: T[]; page: number; done: boolean; busy: boolean; failed: boolean }
/** Every page loaded this session, by source: switching shelves back costs nothing. */
const cache = new Map<string, Pages<unknown>>();

export interface Pager<T> { items?: T[]; done: boolean; busy: boolean; failed: boolean; more: () => void }

function usePages<T>(key: string | undefined, fetchPage: (src: string, page: number) => Promise<{ items: T[]; last: boolean }>, idOf: (t: T) => string): Pager<T> {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const more = useCallback(async () => {
    if (!key) return;
    let s = cache.get(key) as Pages<T> | undefined;
    if (!s) cache.set(key, (s = { items: [], page: 0, done: false, busy: false, failed: false }));
    if (s.busy || s.done) return;
    s.busy = true; s.failed = false; bump();
    try {
      const { items, last } = await fetchPage(key.slice(2), s.page + 1);
      const seen = new Set(s.items.map(idOf));
      const fresh = items.filter((t) => !seen.has(idOf(t)) && !!seen.add(idOf(t)));
      s.items = [...s.items, ...fresh];
      s.page += 1;
      // ponytail: a page of nothing but repeats counts as the end; the API repeats rarely.
      s.done = last || fresh.length === 0;
    } catch {
      s.failed = true;
    }
    s.busy = false; bump();
  }, [key, fetchPage, idOf]);
  useEffect(() => { if (key && !cache.has(key)) void more(); }, [key, more]);
  const s = key ? (cache.get(key) as Pages<T> | undefined) : undefined;
  const first = !s || (s.page === 0 && !s.failed);
  return { ...(first ? {} : { items: s.items }), done: !key || !!s?.done, busy: !!s?.busy, failed: !!s?.failed, more: () => void more() };
}

const songId = (s: Song) => s.url;
const listId = (p: Playlist) => `${p.kind ?? 'playlist'}:${p.id}`;

/** The picker's state: which shelf, the (debounced) search, an opened playlist, and the pages for each. */
export function useCatalogue() {
  const [shelf, setShelfRaw] = useState(MUSIC_SHELVES[0]!);
  const [query, setQueryRaw] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Playlist>();
  useEffect(() => { const t = window.setTimeout(() => setQ(query.trim()), query ? 350 : 0); return () => window.clearTimeout(t); }, [query]);
  const uploads = shelf.src === UPLOADS;
  const songSrc = uploads ? undefined : open ? cardSrc(open) : q || shelf.src;
  const listSrc = uploads ? undefined : q ? `q:${q}` : shelf.lists;
  return {
    shelf, query, open, uploads,
    setShelf: (s: Shelf) => { setShelfRaw(s); setQueryRaw(''); setOpen(undefined); },
    setQuery: (v: string) => { setQueryRaw(v); setOpen(undefined); },
    toggleOpen: (p: Playlist) => setOpen((o) => (o && listId(o) === listId(p) ? undefined : p)),
    songs: usePages(songSrc && `s|${songSrc}`, songPage, songId),
    lists: usePages(listSrc && `l|${listSrc}`, listPage, listId),
  };
}

/** The last row of a list: loads the next page as it nears view, a retry if that failed, nothing at the end. */
export function More({ pager, tone, className }: { pager: Pager<unknown>; tone: 'dark' | 'light'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const n = pager.items?.length ?? 0;
  const { done, failed, more } = pager;
  const moreRef = useRef(more);
  moreRef.current = more;
  useEffect(() => {
    const el = ref.current;
    if (!el || done || failed || !n) return; // the first page loads on its own
    // Observed against its own scroll box, so the margin reaches below the fold.
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) moreRef.current(); }, { root: el.parentElement, rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [n, done, failed]);
  if (done || (!n && !failed)) return null;
  return (
    <div ref={ref} className={cn('grid shrink-0 place-items-center py-3', tone === 'dark' ? 'text-white/55' : 'text-text-tertiary', className)}>
      {failed
        ? <button type="button" onClick={more} className="flex items-center gap-1.5 text-[13px] font-semibold"><RotateCw size={14} />{n ? "Couldn't load more. Retry" : "Couldn't load songs. Retry"}</button>
        : <Loader2 size={18} className="animate-spin" aria-label="Loading more" />}
    </div>
  );
}

/** A sideways row of playlists; tapping one lists its songs below, tapping it again goes back. */
export function PlaylistRow({ pager, open, onOpen, tone }: { pager: Pager<Playlist>; open?: Playlist; onOpen: (p: Playlist) => void; tone: 'dark' | 'light' }) {
  if (!pager.items?.length) return null;
  const dark = tone === 'dark';
  return (
    <div className="flex shrink-0 gap-2.5 overflow-x-auto px-3 pb-2.5">
      {pager.items.map((p) => (
        <button key={listId(p)} type="button" onClick={() => onOpen(p)} aria-pressed={!!open && listId(open) === listId(p)} className="w-[84px] shrink-0 text-left">
          <span className={cn('relative block size-[84px] overflow-hidden', p.kind === 'artist' ? 'rounded-full' : 'rounded-[10px]', dark ? 'bg-media-field' : 'bg-sunken', !!open && listId(open) === listId(p) && (dark ? 'ring-2 ring-white' : 'ring-2 ring-ink'))}>
            {p.img ? <img src={p.img} alt="" loading="lazy" className="size-full object-cover" /> : <ListMusic size={22} className="m-auto mt-[31px]" />}
          </span>
          <span className={cn('mt-1 line-clamp-2 text-[12px] leading-tight font-semibold', dark ? 'text-white/80' : 'text-text-secondary')}>{p.name}</span>
          {p.kind && p.kind !== 'playlist' && (
            <span className={cn('block text-[11px] capitalize', dark ? 'text-white/50' : 'text-text-tertiary')}>{p.kind}</span>
          )}
        </button>
      ))}
      <More pager={pager} tone={tone} className="px-2" />
    </div>
  );
}
