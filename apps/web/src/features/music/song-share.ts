import { publicAppUrl } from '../../lib/public-origin.js';
import type { Song } from './sheets.js';

/**
 * A song sent in a chat, Instagram's way: picked from the Music tab beside the
 * stickers, drawn in the thread as a card that plays.
 *
 * Sent as ordinary text - a line and a link - like the story card, so an older
 * build still shows something sensible and this one reads the link and draws
 * the card. The link carries what the card needs (name, artist, cover, the
 * audio address), so the reader's side asks nobody anything to show it.
 */

export interface SharedSong {
  name: string;
  artist: string;
  img: string;
  url: string;
  secs: number;
}

export function songBody(song: Song): string {
  const q = new URLSearchParams({ n: song.name, a: song.artist, i: song.img, u: song.url, d: String(Math.round(song.secs)) });
  return `Shared a song: ${song.name}${song.artist ? ` · ${song.artist}` : ''}\n${publicAppUrl(`/song?${q.toString()}`)}`;
}

const SAFE = /^https:\/\//;
/** Demo builds play uploads from memory; nothing but a dev build accepts that. */
const playable = (url: string) => SAFE.test(url) || (import.meta.env.DEV && url.startsWith('blob:'));

export function parseSongShare(body: string): SharedSong | undefined {
  const match = /https?:\/\/\S+\/song\?(\S+)/.exec(body);
  if (!match) return undefined;
  const q = new URLSearchParams(match[1]);
  const name = q.get('n')?.trim() ?? '';
  const url = q.get('u') ?? '';
  const img = q.get('i') ?? '';
  // Only https media: this is played and drawn straight from a message somebody else wrote.
  if (!name || !playable(url)) return undefined;
  return {
    name: name.slice(0, 120),
    artist: (q.get('a') ?? '').slice(0, 120),
    img: SAFE.test(img) ? img : '',
    url,
    secs: Math.max(0, Number(q.get('d')) || 0),
  };
}
