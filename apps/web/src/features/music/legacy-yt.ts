import * as api from './saavn/api.js';
import { streamUrl } from './saavn/api.js';
import type { SharedSong } from './song-share.js';

/**
 * A song shared from YouTube Music, as an old chat message carries it.
 *
 * PINGO Music no longer reads from YouTube Music, but messages sent before that
 * still hold a song as its YouTube Music page address. Those still play: the
 * same song is looked up on JioSaavn by name and artist, and a card with no
 * match simply does not play, as a song that cannot be found always has.
 */

const PAGE = /^https:\/\/music\.youtube\.com\/watch\?v=([\w-]{6,20})/;

export const isYtPage = (url: string): boolean => PAGE.test(url);

/** JioSaavn's version of a song shared from YouTube Music, or undefined when there is none. */
export async function playableFor(song: Pick<SharedSong, 'url' | 'name' | 'artist'>): Promise<string | undefined> {
  const twin = await api.equivalent(song.name, song.artist);
  return twin ? streamUrl(twin) : undefined;
}
