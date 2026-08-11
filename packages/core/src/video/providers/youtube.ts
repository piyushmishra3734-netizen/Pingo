import type { VideoPreview, VideoProvider } from '../types.js';

/**
 * YouTube: the one platform that answers.
 *
 * Everything here is derivable offline. The id fixes the thumbnail (`i.ytimg`
 * serves a predictable path per video) and the embed, so a card is complete
 * before any request is made. oEmbed adds the title and the author, and it is
 * the only endpoint in this whole feature that is actually called - see
 * `enrich`.
 */

/** Exactly eleven of these, which is what makes an id distinguishable. */
const ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Paths that carry the id as the segment after them. */
const PATH_PREFIXES = ['shorts', 'embed', 'live', 'v'];

function videoId(url: URL): string | undefined {
  const host = url.hostname.toLowerCase();

  // youtu.be/<id> - the id is the entire path.
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return ID.test(id) ? id : undefined;
  }

  // youtube.com/watch?v=<id>
  const query = url.searchParams.get('v');
  if (query && ID.test(query)) return query;

  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (first && second && PATH_PREFIXES.includes(first.toLowerCase()) && ID.test(second)) {
    return second;
  }

  return undefined;
}

/**
 * A start offset, in whole seconds.
 *
 * YouTube writes this three ways and accepts a suffixed form (`1h2m10s`) in the
 * two human-facing ones. Parsed rather than passed through, because `start` on
 * the embed only takes a plain integer - handing it `90s` silently starts the
 * video at zero, which reads as the timestamp being ignored.
 */
function startSeconds(url: URL): number | undefined {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (!raw) return undefined;

  if (/^\d+$/.test(raw)) return Number(raw);

  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!match || match[0] === '') return undefined;

  const total =
    Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : undefined;
}

export const youtube: VideoProvider = {
  name: 'youtube',

  canHandle(url) {
    return HOSTS.has(url.hostname.toLowerCase());
  },

  identify(url) {
    const id = videoId(url);
    if (!id) return undefined;

    const start = startSeconds(url);

    /*
     * `youtube-nocookie.com`, deliberately.
     *
     * Same player, but it does not write YouTube's tracking cookies until
     * somebody actually plays something. The card is being rendered inside a
     * private messenger; the reader has asked to see a chat, not to be
     * enrolled in a recommendation profile for a video they may never open.
     */
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
    embed.searchParams.set('autoplay', '1');
    embed.searchParams.set('rel', '0');
    if (start !== undefined) embed.searchParams.set('start', String(start));

    const canonical = new URL(`https://www.youtube.com/watch?v=${id}`);
    if (start !== undefined) canonical.searchParams.set('t', String(start));

    return {
      platform: 'youtube',
      originalUrl: url.href,
      canonicalUrl: canonical.href,
      embedUrl: embed.href,
      /*
       * `hqdefault` rather than `maxresdefault`: every video has one. The
       * maximum-resolution file is only generated for sources that were
       * uploaded large enough, and asking for one that does not exist returns
       * a 404 - which is a broken image on the card for exactly the older and
       * smaller videos least likely to have it.
       */
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  },

  async enrich(preview, signal) {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('url', preview.canonicalUrl);

    const response = await fetch(endpoint, { signal });
    if (!response.ok) return {};

    const data = (await response.json()) as { title?: unknown; author_name?: unknown };

    // Typed off the wire rather than trusted: this is third-party JSON, and a
    // non-string reaching the card is how a render throws.
    return {
      ...(typeof data.title === 'string' ? { title: data.title } : {}),
      ...(typeof data.author_name === 'string' ? { author: data.author_name } : {}),
    };
  },
};
