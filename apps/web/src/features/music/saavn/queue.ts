import type { Song } from './types.js';

/**
 * The play queue, as plain data and pure functions.
 *
 * No audio here and no React: the player holds one `QueueState` and asks these
 * what plays next, which keeps every rule (shuffle, repeat, "play next", the
 * radio carrying on) testable without a speaker (scripts/verify-music-queue.ts).
 *
 * ## Never running dry
 *
 * A queue started from a song, an artist or a station is a radio: when it gets
 * within `REFILL_AT` songs of the end, `wantsMore` says so, the player asks
 * JioSaavn's station for more, and `extend` adds them. Music keeps going until
 * somebody stops it, which is the single biggest thing that makes a music app
 * feel effortless. An album or a playlist ends where it ends, unless repeat is on.
 */

export type Repeat = 'off' | 'all' | 'one';

export interface QueueSource {
  /** What started it, for the "Playing from" line and for the refill rule. */
  kind: 'song' | 'album' | 'playlist' | 'artist' | 'station' | 'search' | 'library' | 'list';
  label: string;
  id?: string;
}

export interface QueueState {
  /** Songs in the order they were queued. */
  items: Song[];
  /** The order they play in, as indexes into `items` (a permutation when shuffled). */
  order: number[];
  /** Position in `order` of the song playing now. */
  at: number;
  source: QueueSource;
  shuffle: boolean;
  repeat: Repeat;
  /** The JioSaavn station feeding a radio queue, once there is one. */
  stationId?: string;
}

/** Ask for more when this few are left. */
export const REFILL_AT = 3;
/** Songs a radio queue keeps behind the current one; older ones are dropped so it cannot grow forever. */
const KEEP_BEHIND = 50;

const RADIO_KINDS = new Set<QueueSource['kind']>(['song', 'artist', 'station', 'search', 'library']);

export const empty = (): QueueState => ({ items: [], order: [], at: -1, source: { kind: 'list', label: '' }, shuffle: false, repeat: 'off' });

export const current = (q: QueueState): Song | undefined => q.items[q.order[q.at] ?? -1];
export const upcoming = (q: QueueState, n = 20): Song[] => q.order.slice(q.at + 1, q.at + 1 + n).map((i) => q.items[i]!);
export const isRadio = (q: QueueState) => RADIO_KINDS.has(q.source.kind);

function shuffled(n: number, first: number, rand: () => number): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return first >= 0 ? [first, ...rest] : rest;
}

/** Duplicates (the same song twice in a list) are dropped: a queue is not a playlist. */
function unique(songs: Song[], except: Set<string> = new Set()): Song[] {
  const seen = new Set(except);
  return songs.filter((s) => s.id && !seen.has(s.id) && !!seen.add(s.id));
}

/** Start playing `songs` from `index`. Shuffle and repeat carry over from before. */
export function start(prev: QueueState, songs: Song[], index: number, source: QueueSource, rand = Math.random): QueueState {
  const picked = songs[index];
  const items = unique(songs);
  const first = picked ? Math.max(0, items.findIndex((s) => s.id === picked.id)) : 0;
  const order = prev.shuffle ? shuffled(items.length, first, rand) : items.map((_, i) => i);
  return { items, order, at: prev.shuffle ? 0 : first, source, shuffle: prev.shuffle, repeat: prev.repeat === 'one' ? 'off' : prev.repeat };
}

/** Where the queue goes when a song ends on its own (`auto`) or the next button is pressed. */
export function next(q: QueueState, auto = false): QueueState {
  if (!q.order.length) return q;
  if (auto && q.repeat === 'one') return q;
  if (q.at < q.order.length - 1) return { ...q, at: q.at + 1 };
  if (q.repeat !== 'off') return { ...q, at: 0 };
  // At the end with nothing more: stay on the last song (the player stops).
  return q;
}

export const atEnd = (q: QueueState) => q.at >= q.order.length - 1 && q.repeat === 'off';

/** Back: restarts the song if it has been playing a moment, else goes to the one before. */
export function prev(q: QueueState, secondsIn: number): { q: QueueState; restart: boolean } {
  if (secondsIn > 3 || q.at <= 0) return { q, restart: true };
  return { q: { ...q, at: q.at - 1 }, restart: false };
}

export const jump = (q: QueueState, orderIndex: number): QueueState => (orderIndex >= 0 && orderIndex < q.order.length ? { ...q, at: orderIndex } : q);

/** "Play next": right after the current song, in the order given. */
export function playNext(q: QueueState, songs: Song[]): QueueState {
  const add = unique(songs).filter((s) => s.id !== current(q)?.id);
  if (!add.length) return q;
  const ids = new Set(add.map((s) => s.id));
  // A song already queued later moves up rather than appearing twice.
  const keep = q.items.map((s, i) => ({ s, i })).filter(({ s }) => !ids.has(s.id));
  const remap = new Map(keep.map(({ i }, n) => [i, n]));
  const items = [...keep.map(({ s }) => s), ...add];
  const base = keep.length;
  const order = q.order.filter((i) => remap.has(i)).map((i) => remap.get(i)!);
  const curItem = q.order[q.at];
  const at = curItem !== undefined && remap.has(curItem) ? order.indexOf(remap.get(curItem)!) : Math.min(q.at, order.length - 1);
  order.splice(at + 1, 0, ...add.map((_, k) => base + k));
  return { ...q, items, order, at };
}

/** "Add to queue": at the end. */
export function append(q: QueueState, songs: Song[]): QueueState {
  const add = unique(songs, new Set(q.items.map((s) => s.id)));
  if (!add.length) return q;
  const base = q.items.length;
  return { ...q, items: [...q.items, ...add], order: [...q.order, ...add.map((_, k) => base + k)] };
}

/** Removes the song at `orderIndex` (not the one playing). */
export function remove(q: QueueState, orderIndex: number): QueueState {
  if (orderIndex === q.at || orderIndex < 0 || orderIndex >= q.order.length) return q;
  const order = q.order.filter((_, k) => k !== orderIndex);
  return { ...q, order, at: orderIndex < q.at ? q.at - 1 : q.at };
}

/** Drag to reorder what is coming up. */
export function move(q: QueueState, from: number, to: number): QueueState {
  if (from === to || from <= q.at || to <= q.at || from >= q.order.length || to >= q.order.length) return q;
  const order = [...q.order];
  const [x] = order.splice(from, 1);
  order.splice(to, 0, x!);
  return { ...q, order };
}

/** Shuffle keeps the current song playing and reshuffles everything after it; off restores the queued order. */
export function toggleShuffle(q: QueueState, rand = Math.random): QueueState {
  const cur = q.order[q.at] ?? 0;
  if (q.shuffle) {
    const order = q.items.map((_, i) => i);
    return { ...q, shuffle: false, order, at: q.items.length ? cur : -1 };
  }
  const order = shuffled(q.items.length, cur, rand);
  return { ...q, shuffle: true, order, at: q.items.length ? 0 : -1 };
}

export const cycleRepeat = (q: QueueState): QueueState => ({ ...q, repeat: q.repeat === 'off' ? 'all' : q.repeat === 'all' ? 'one' : 'off' });

/** True when a radio queue is running low and should be topped up. */
export const wantsMore = (q: QueueState) => isRadio(q) && q.repeat === 'off' && q.order.length - 1 - q.at < REFILL_AT;

/** Adds songs a station sent, skipping ones already heard in this queue, and trims old history. */
export function extend(q: QueueState, songs: Song[], stationId?: string): QueueState {
  let out = append(q, songs);
  if (stationId) out = { ...out, stationId };
  if (out.at > KEEP_BEHIND) {
    const drop = out.at - KEEP_BEHIND;
    const gone = new Set(out.order.slice(0, drop));
    const keepIdx = out.items.map((_, i) => i).filter((i) => !gone.has(i));
    const remap = new Map(keepIdx.map((i, n) => [i, n]));
    out = { ...out, items: keepIdx.map((i) => out.items[i]!), order: out.order.slice(drop).map((i) => remap.get(i)!), at: out.at - drop };
  }
  return out;
}
