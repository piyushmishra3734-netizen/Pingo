import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * A meme sound from Freesound sent in a chat. It is drawn as a voice message
 * (a play button and a waveform), but nothing is uploaded: the message is a line
 * and a link, and the link holds the address of the sound on Freesound's own
 * CDN, which the reader's phone plays directly. Pingo stores and serves none of it.
 */

export interface SharedSound {
  name: string;
  url: string;
  secs: number;
}

/** Only Freesound's own servers: this is played straight from a message somebody else wrote. */
const FREESOUND_HOST = /^https:\/\/([a-z0-9-]+\.)*freesound\.org\//i;

export function soundBody(sound: SharedSound & { by?: string }): string {
  const q = new URLSearchParams({ n: sound.name, u: sound.url, d: String(Math.ceil(sound.secs)), ...(sound.by ? { by: sound.by } : {}) });
  return `Shared a sound: ${sound.name}\n${publicAppUrl(`/sound?${q.toString()}`)}`;
}

export function parseSoundShare(body: string): SharedSound | undefined {
  const match = /https?:\/\/\S+\/sound\?(\S+)/.exec(body);
  if (!match) return undefined;
  const q = new URLSearchParams(match[1]);
  const url = q.get('u') ?? '';
  if (!FREESOUND_HOST.test(url)) return undefined;
  return {
    name: (q.get('n')?.trim() || 'Sound').slice(0, 100),
    url,
    secs: Math.min(60, Math.max(0, Number(q.get('d')) || 0)),
  };
}
