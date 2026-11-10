import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * A GIPHY Clip (a short video with sound) sent in a chat. Like a song, it is
 * sent as a line and a link; the link carries the address of the video on
 * GIPHY's own servers, which the reader's phone plays directly. Pingo uploads,
 * stores and serves none of it.
 */

export interface SharedClip {
  title: string;
  url: string;
  /** A still to show before play; empty when the video's own first frame is used. */
  poster: string;
  w: number;
  h: number;
}

/** Only GIPHY's own servers: this is played straight from a message somebody else wrote. */
const GIPHY_HOST = /^https:\/\/([a-z0-9-]+\.)*giphy\.com\//i;

export function clipBody(clip: SharedClip): string {
  const q = new URLSearchParams({ n: clip.title, u: clip.url, i: clip.poster, w: String(clip.w), h: String(clip.h) });
  return `Shared a clip: ${clip.title}\n${publicAppUrl(`/clip?${q.toString()}`)}`;
}

export function parseClipShare(body: string): SharedClip | undefined {
  const match = /https?:\/\/\S+\/clip\?(\S+)/.exec(body);
  if (!match) return undefined;
  const q = new URLSearchParams(match[1]);
  const url = q.get('u') ?? '';
  if (!GIPHY_HOST.test(url)) return undefined;
  const poster = q.get('i') ?? '';
  return {
    title: (q.get('n')?.trim() || 'Clip').slice(0, 100),
    url,
    poster: GIPHY_HOST.test(poster) ? poster : '',
    w: Math.min(4000, Math.max(1, Number(q.get('w')) || 9)),
    h: Math.min(4000, Math.max(1, Number(q.get('h')) || 16)),
  };
}
