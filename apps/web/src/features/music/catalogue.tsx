import { cn } from '@pingo/ui';
import { ListMusic, Loader2, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { MUSIC, decode, toSong, type ApiSong, type Song } from './sheets.js';

/**
 * Browsing the JioSaavn catalogue page by page, shared by the story/camera sheet
 * and the chat/profile picker.
 *
 * The live API (upstream sumitkolhe/jiosaavn-api) pages both `/search/songs` and
 * `/playlists` with a 1-based `page` and a `limit`; `/search/playlists` finds
 * JioSaavn's own editorial playlists (charts, new releases, every language).
 * It has no charts/modules route, so the shelves are those editorial playlists.
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

async function get(path: string): Promise<Record<string, unknown> | undefined> {
  const r = await fetch(MUSIC + path);
  if (!r.ok) throw new Error(String(r.status));
  return ((await r.json()) as { data?: Record<string, unknown> }).data ?? undefined;
}

/**
 * The end: an empty page, or past `total` (searches have one). Not a short page:
 * JioSaavn drops unplayable songs from a page, so a playlist page of 20 can come back with 17.
 */
const isLast = (d: Record<string, unknown> | undefined, n: number, page: number) => n === 0 || (typeof d?.total === 'number' && page * LIMIT >= d.total);

/** One page of songs: `pl:` a playlist, `ar:` an artist's songs, `al:` an album, anything else a search. */
async function songPage(src: string, page: number) {
  const kind = /^(pl|ar|al):/.exec(src)?.[1];
  const id = kind ? src.slice(3) : '';
  const d = await get(
    kind === 'pl' ? `/playlists?id=${id}&limit=${LIMIT}&page=${page}`
      : kind === 'ar' ? `/artists/${id}/songs?page=${page}`
        : kind === 'al' ? `/albums?id=${id}`
          : `/search/songs?query=${encodeURIComponent(src)}&limit=${LIMIT}&page=${page}`,
  );
  const raw = ((kind ? d?.songs : d?.results) ?? []) as ApiSong[];
  // An album is one page; an artist's list pages like a search, by its own total.
  const last = kind === 'al' || isLast(d, raw.length, page);
  return { items: raw.map(toSong).filter((s): s is Song => !!s), last };
}

/**
 * What JioSaavn puts above the songs when you search: its top result and the
 * best artist and album matches. Searching "arijit singh" or "aashiqui 2"
 * found songs that merely mention them; the app leads with the artist and the
 * album themselves, and that is what made the two feel different.
 */
async function topMatches(q: string): Promise<Playlist[]> {
  const d = await get(`/search?query=${encodeURIComponent(q)}`).catch(() => undefined);
  type Hit = { id: string; title: string; type: string; image?: { url: string }[] };
  const pick = (key: string) => (((d?.[key] as { results?: Hit[] } | undefined)?.results ?? []) as Hit[]);
  const cards: Playlist[] = [];
  const seen = new Set<string>();
  for (const hit of [...pick('topQuery'), ...pick('artists').slice(0, 3), ...pick('albums').slice(0, 3)]) {
    const kind = hit.type === 'artist' ? 'artist' : hit.type === 'album' ? 'album' : undefined;
    if (!kind || seen.has(hit.id)) continue;
    seen.add(hit.id);
    cards.push({ id: hit.id, name: decode(hit.title), img: hit.image?.[1]?.url ?? hit.image?.[0]?.url ?? '', count: 0, kind });
  }
  return cards;
}

async function listPage(src: string, page: number) {
  // `q:` marks a search typed by the person, which leads with the top artist/album matches.
  const typed = src.startsWith('q:');
  const q = typed ? src.slice(2) : src;
  const [d, top] = await Promise.all([
    get(`/search/playlists?query=${encodeURIComponent(q)}&limit=${LIMIT}&page=${page}`),
    typed && page === 1 ? topMatches(q) : Promise.resolve([] as Playlist[]),
  ]);
  const raw = (d?.results ?? []) as { id: string; name: string; songCount?: number; image?: { url: string }[] }[];
  return {
    items: [...top, ...raw.filter((p) => (p.songCount ?? 1) > 0).map((p): Playlist => ({ id: p.id, name: decode(p.name), img: p.image?.[1]?.url ?? p.image?.[0]?.url ?? '', count: p.songCount ?? 0, kind: 'playlist' }))],
    last: isLast(d, raw.length, page),
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
