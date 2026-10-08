import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * A playlist, an album or an artist from PINGO Music, sent in a chat.
 *
 * Sent the way a song is (`song-share.ts`): a line of text and a link, so an
 * older build still shows something sensible, and this one draws a card that
 * opens the page in PINGO Music.
 *
 * JioSaavn's playlists, albums and artists travel as their id. A playlist
 * somebody made themselves is not on JioSaavn and not readable by anyone else
 * on the server, so it travels as its songs' ids instead (`mix`): the person
 * receiving it sees the same songs and can keep a copy.
 */

export type SharedKind = 'playlist' | 'album' | 'artist' | 'mix';

export interface SharedCollection {
  kind: SharedKind;
  /** JioSaavn's id; empty for a mix. */
  id: string;
  name: string;
  /** "Arijit Singh · 2013", "120 songs", "Artist". */
  sub: string;
  img: string;
  /** A mix's songs, in order. */
  ids: string[];
}

/** Enough for a long playlist and still a link a chat can carry. */
const MAX_MIX = 150;

const LEAD: Record<SharedKind, string> = {
  playlist: 'Shared a playlist',
  album: 'Shared an album',
  artist: 'Shared an artist',
  mix: 'Shared a playlist',
};

export function collectionBody(c: SharedCollection): string {
  const q = new URLSearchParams({ k: c.kind, n: c.name, s: c.sub, i: c.img });
  if (c.kind === 'mix') q.set('ids', c.ids.slice(0, MAX_MIX).join(','));
  else q.set('id', c.id);
  return `${LEAD[c.kind]}: ${c.name}\n${publicAppUrl(`/music?${q.toString()}`)}`;
}

const KINDS = new Set<SharedKind>(['playlist', 'album', 'artist', 'mix']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function parseCollectionParams(q: URLSearchParams): SharedCollection | undefined {
  const kind = q.get('k') as SharedKind | null;
  const name = q.get('n')?.trim() ?? '';
  if (!kind || !KINDS.has(kind) || !name) return undefined;
  const id = q.get('id') ?? '';
  // Ids go into addresses the app asks for: nothing but JioSaavn's alphabet.
  const ids = (q.get('ids') ?? '').split(',').filter((x) => SAFE_ID.test(x)).slice(0, MAX_MIX);
  if (kind === 'mix' ? !ids.length : !SAFE_ID.test(id)) return undefined;
  const img = q.get('i') ?? '';
  return {
    kind,
    id: kind === 'mix' ? '' : id,
    name: name.slice(0, 120),
    sub: (q.get('s') ?? '').slice(0, 120),
    // Only https covers: this is drawn straight from a message somebody else wrote.
    img: /^https:\/\//.test(img) ? img : '',
    ids,
  };
}

export function parseCollectionShare(body: string): SharedCollection | undefined {
  const match = /https?:\/\/\S+\/music\?(\S+)/.exec(body);
  return match ? parseCollectionParams(new URLSearchParams(match[1])) : undefined;
}

export const KIND_LABEL: Record<SharedKind, string> = { playlist: 'Playlist', album: 'Album', artist: 'Artist', mix: 'Playlist' };
