import * as api from '../saavn/api.js';
import { streamUrl } from '../saavn/api.js';
import type { SharedSong } from '../song-share.js';
import { available, resolveStream, videoIdOf } from './innertube.js';
import { noteYtmFailure, noteYtmOk } from './source.js';

/**
 * A song shared from YouTube Music travels as its page address, not as an audio
 * address: those are tied to one phone's connection and run out in hours, so one
 * pasted into a chat would be dead for everyone else. The page address is
 * stable; each phone turns it into something it can play.
 */

const PAGE = /^https:\/\/music\.youtube\.com\/watch\?v=([\w-]{6,20})/;

export const isYtPage = (url: string): boolean => PAGE.test(url);
export const pageUrl = (id: string): string => `https://music.youtube.com/watch?v=${videoIdOf(id)}`;

/**
 * Something this phone can play for a shared YouTube Music song: YouTube's own
 * stream where the app can ask for it, JioSaavn's version of the song where it
 * cannot (a browser, or YouTube not answering).
 */
export async function playableFor(song: Pick<SharedSong, 'url' | 'name' | 'artist'>): Promise<string | undefined> {
  const id = PAGE.exec(song.url)?.[1];
  if (id && available()) {
    try {
      const stream = await resolveStream(id);
      noteYtmOk();
      const url = stream['160'] ?? stream['96'] ?? stream['48'] ?? stream['320'];
      if (url) return url;
    } catch {
      noteYtmFailure();
    }
  }
  const twin = await api.equivalent(song.name, song.artist);
  return twin ? streamUrl(twin) : undefined;
}
