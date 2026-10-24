/**
 * A post from X or Pinterest, as plain data a card can draw.
 *
 * Neither platform lets a browser read a post, and an embed is somebody else's
 * page in a frame. So the edge reads it and hands back what a native card
 * needs: who, what they said, the pictures, the numbers.
 *
 *   GET /api/social?p=x&user=NAME&id=123        -> an X post
 *   GET /api/social?p=pin&id=123                -> a pin
 *   GET /api/social?p=pin&short=CODE            -> a pin.it link, resolved
 *
 * ## X
 *
 * Through FxTwitter's public JSON, which is built for exactly this: it turns a
 * status id into its text, author and media without a login. The host is a
 * constant here and the id a number, so a sender cannot point this anywhere.
 *
 * ## Pinterest
 *
 * oEmbed first, which Pinterest publishes for pins, then the page's own
 * `og:` tags, as link previews do. A short link is followed by hand, a few hops
 * at most, and must land on a pin.
 *
 * ## Pictures
 *
 * Every picture is named as a `/api/social-img` address, so a reader's browser
 * talks to this app and never to X or Pinterest for a post it merely scrolled
 * past. A video is the exception, and only on tap: it streams from the
 * platform's own CDN because proxying video through here would be the bill.
 */

declare const caches: { default: { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> } };
declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: Record<string, unknown>): unknown;
    transform(response: Response): Response;
  };
};

const HOUR = 3600;
const TIMEOUT_MS = 7000;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const NUMERIC = /^\d{5,25}$/;
const SHORT = /^[A-Za-z0-9]{4,20}$/;

/** The hosts a picture may come from. Nothing else is ever fetched or named. */
const IMAGE_HOSTS = ['pbs.twimg.com', 'abs.twimg.com', 'i.pinimg.com', 's.pinimg.com'];
const VIDEO_HOSTS = ['video.twimg.com', 'v1.pinimg.com', 'v.pinimg.com'];

export function isAllowedImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && IMAGE_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAllowedVideo(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && VIDEO_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const proxied = (url: string | undefined): string | undefined =>
  url && isAllowedImage(url) ? `/api/social-img?u=${encodeURIComponent(url)}` : undefined;

export interface SocialMedia {
  kind: 'photo' | 'video' | 'gif';
  /** Photo: the proxied picture. Video: the stream, played on tap. */
  src: string;
  poster?: string;
  w?: number;
  h?: number;
}

export interface SocialPost {
  platform: 'x' | 'pinterest';
  url: string;
  author?: { name: string; handle?: string; avatar?: string; verified?: boolean; url?: string };
  text?: string;
  title?: string;
  createdAt?: string;
  stats?: { replies?: number; reposts?: number; likes?: number; views?: number };
  media: SocialMedia[];
  quote?: { author?: { name: string; handle?: string }; text?: string; media: SocialMedia[] };
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

function mediaOf(raw: unknown): SocialMedia[] {
  const media = obj(raw);
  if (!media) return [];
  const out: SocialMedia[] = [];
  const all = Array.isArray(media.all) ? (media.all as unknown[]) : [];
  const list = all.length ? all : [...((media.photos as unknown[]) ?? []), ...((media.videos as unknown[]) ?? [])];
  for (const item of list) {
    const m = obj(item);
    if (!m) continue;
    const type = str(m.type);
    const url = str(m.url);
    if (!url) continue;
    const w = num(m.width);
    const h = num(m.height);
    const size = { ...(w ? { w } : {}), ...(h ? { h } : {}) };
    if (type === 'photo') {
      const src = proxied(url);
      if (src) out.push({ kind: 'photo', src, ...size });
    } else if ((type === 'video' || type === 'gif') && isAllowedVideo(url)) {
      const poster = proxied(str(m.thumbnail_url));
      out.push({ kind: type, src: url, ...(poster ? { poster } : {}), ...size });
    }
  }
  return out.slice(0, 4);
}

/** FxTwitter's answer, reduced to what a card draws. */
export function normalizeTweet(json: unknown): SocialPost | undefined {
  const tweet = obj(obj(json)?.tweet);
  if (!tweet) return undefined;
  const author = obj(tweet.author);
  const name = str(author?.name) ?? str(author?.screen_name);
  const handle = str(author?.screen_name);
  const avatar = proxied(str(author?.avatar_url));
  const verified = obj(author?.verification)?.verified === true || author?.verified === true;
  const replies = num(tweet.replies);
  const reposts = num(tweet.retweets);
  const likes = num(tweet.likes);
  const views = num(tweet.views);
  const quote = obj(tweet.quote);
  const quoteAuthor = obj(quote?.author);
  const quoteName = str(quoteAuthor?.name) ?? str(quoteAuthor?.screen_name);
  const quoteHandle = str(quoteAuthor?.screen_name);
  const quoteText = str(quote?.text);
  const createdAt = str(tweet.created_at);

  return {
    platform: 'x',
    url: str(tweet.url) ?? '',
    ...(name ? { author: { name, ...(handle ? { handle } : {}), ...(avatar ? { avatar } : {}), ...(verified ? { verified } : {}) } } : {}),
    ...(str(tweet.text) ? { text: str(tweet.text)! } : {}),
    ...(createdAt ? { createdAt } : {}),
    stats: {
      ...(replies !== undefined ? { replies } : {}),
      ...(reposts !== undefined ? { reposts } : {}),
      ...(likes !== undefined ? { likes } : {}),
      ...(views !== undefined ? { views } : {}),
    },
    media: mediaOf(tweet.media),
    ...(quote
      ? {
          quote: {
            ...(quoteName ? { author: { name: quoteName, ...(quoteHandle ? { handle: quoteHandle } : {}) } } : {}),
            ...(quoteText ? { text: quoteText } : {}),
            media: mediaOf(quote.media),
          },
        }
      : {}),
  };
}

/**
 * The pin id in a Pinterest path. A share link lands on `/pin/123/sent/?invite_code=...`,
 * and the older form is `/pin/some-title--123/`, so anything may follow the id.
 */
export function pinIdFromPath(pathname: string): string | undefined {
  return /^\/pin\/(?:[^/]*--)?(\d{5,25})(?:\/.*)?$/.exec(pathname)?.[1];
}

/** Pinterest serves the same pin at several widths; the original is the largest. */
export function biggestPin(url: string): string {
  return url.replace(/\/(\d+x|\d+x\d+|originals)\//, '/736x/');
}

const headers = (type: string, maxAge: number) => ({
  'Content-Type': type,
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
  'X-Content-Type-Options': 'nosniff',
});
const nothing = (maxAge: number) => new Response(null, { status: 404, headers: headers('text/plain', maxAge) });
const json = (body: unknown, maxAge: number) => new Response(JSON.stringify(body), { headers: headers('application/json; charset=utf-8', maxAge) });

/** vxtwitter's answer, the second source when FxTwitter will not give the post. */
export function normalizeVx(json: unknown): SocialPost | undefined {
  const t = obj(json);
  if (!t || !str(t.tweetID)) return undefined;
  const name = str(t.user_name) ?? str(t.user_screen_name);
  const handle = str(t.user_screen_name);
  const avatar = proxied(str(t.user_profile_image_url));
  const media: SocialMedia[] = [];
  for (const item of Array.isArray(t.media_extended) ? (t.media_extended as unknown[]) : []) {
    const m = obj(item);
    const url = str(m?.url);
    if (!m || !url) continue;
    const size = obj(m.size);
    const w = num(size?.width);
    const h = num(size?.height);
    const dims = { ...(w ? { w } : {}), ...(h ? { h } : {}) };
    if (m.type === 'image') {
      const src = proxied(url);
      if (src) media.push({ kind: 'photo', src, ...dims });
    } else if ((m.type === 'video' || m.type === 'gif') && isAllowedVideo(url)) {
      const poster = proxied(str(m.thumbnail_url));
      media.push({ kind: m.type, src: url, ...(poster ? { poster } : {}), ...dims });
    }
  }
  const replies = num(t.replies);
  const reposts = num(t.retweets);
  const likes = num(t.likes);
  return {
    platform: 'x',
    url: '',
    ...(name ? { author: { name, ...(handle ? { handle } : {}), ...(avatar ? { avatar } : {}) } } : {}),
    ...(str(t.text) ? { text: str(t.text)! } : {}),
    ...(str(t.date) ? { createdAt: str(t.date)! } : {}),
    stats: {
      ...(replies !== undefined ? { replies } : {}),
      ...(reposts !== undefined ? { reposts } : {}),
      ...(likes !== undefined ? { likes } : {}),
    },
    media: media.slice(0, 4),
  };
}

async function tweet(user: string, id: string): Promise<SocialPost | undefined> {
  const first = await tweetFromFx(user, id);
  if (first) return first;
  const res = await fetch(`https://api.vxtwitter.com/${user}/status/${id}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', 'User-Agent': 'PingoPreview/1.0' },
  }).catch(() => undefined);
  if (!res?.ok) return undefined;
  const post = normalizeVx(await res.json().catch(() => undefined));
  if (post) post.url = `https://x.com/${post.author?.handle ?? user}/status/${id}`;
  return post;
}

async function tweetFromFx(user: string, id: string): Promise<SocialPost | undefined> {
  const res = await fetch(`https://api.fxtwitter.com/${user}/status/${id}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', 'User-Agent': 'PingoPreview/1.0' },
  }).catch(() => undefined);
  if (!res?.ok) return undefined;
  const post = normalizeTweet(await res.json().catch(() => undefined));
  if (post) post.url = `https://x.com/${post.author?.handle ?? user}/status/${id}`;
  return post;
}

/** A pin.it link to the pin it points at, following a few redirects by hand. */
async function resolveShort(code: string): Promise<string | undefined> {
  let url = `https://pin.it/${code}`;
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => undefined);
    const next = res?.headers.get('location');
    if (!next) return undefined;
    try {
      const target = new URL(next, url);
      const pinId = pinIdFromPath(target.pathname);
      if (/(^|\.)pinterest\.[a-z.]{2,6}$/.test(target.hostname) && pinId) return pinId;
      if (target.protocol !== 'https:' || !(target.hostname === 'pin.it' || /(^|\.)pinterest\.[a-z.]{2,6}$/.test(target.hostname))) return undefined;
      url = target.toString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * A pin's video as a file a <video> can play. The page lists several renditions;
 * a plain mp4 is taken when there is one, and a streaming playlist (which most
 * browsers cannot play) is turned into the mp4 that sits beside it.
 */
export function pinVideo(html: string): string | undefined {
  const clean = (u: string) => u.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const mp4 = [...html.matchAll(/https:(?:\\?\/){2}v1\.pinimg\.com(?:\\?\/)videos[^"'\s<>]*?\.mp4/g)].map((m) => clean(m[0]));
  const best = mp4.find((u) => /720p/.test(u)) ?? mp4[0];
  if (best && isAllowedVideo(best)) return best;
  const hls = /https:(?:\\?\/){2}v1\.pinimg\.com(?:\\?\/)videos[^"'\s<>]*?\.m3u8/.exec(html)?.[0];
  if (!hls) return undefined;
  const converted = clean(hls).replace('/hls/', '/720p/').replace(/\.m3u8$/, '.mp4');
  return isAllowedVideo(converted) ? converted : undefined;
}

async function pin(id: string): Promise<SocialPost | undefined> {
  const page = `https://www.pinterest.com/pin/${id}/`;
  const found: Record<string, string> = {};
  let html = '';

  const crawled = await fetch(page, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', Accept: 'text/html' },
  }).catch(() => undefined);
  if (crawled?.ok) {
    const grab = (key: string) => ({
      element(element: { getAttribute(name: string): string | null }) {
        const value = element.getAttribute('content');
        if (value && !found[key]) found[key] = value;
      },
    });
    // The page is read once as text: its tags for the card, and its data for a video's file.
    html = await crawled.text().catch(() => '');
    const rewriter = new HTMLRewriter();
    rewriter.on('meta[property="og:image"]', grab('image'));
    rewriter.on('meta[property="og:title"]', grab('title'));
    rewriter.on('meta[property="og:description"]', grab('description'));
    rewriter.on('meta[property="og:video"]', grab('video'));
    rewriter.on('meta[property="og:image:width"]', grab('w'));
    rewriter.on('meta[property="og:image:height"]', grab('h'));
    rewriter.on('meta[name="pinterestapp:pinner"]', grab('author'));
    await rewriter.transform(new Response(html, { headers: { 'Content-Type': 'text/html' } })).text().catch(() => undefined);
  }

  const oembed = await fetch(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(page)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);
  const o = oembed?.ok ? obj(await oembed.json().catch(() => undefined)) : undefined;

  const image = [str(found.image), str(o?.thumbnail_url)].find((u): u is string => Boolean(u && isAllowedImage(u)));
  if (!image) return undefined;
  const w = Number(found.w) || num(o?.thumbnail_width);
  const h = Number(found.h) || num(o?.thumbnail_height);
  const src = proxied(biggestPin(image));
  if (!src) return undefined;
  const videoUrl = pinVideo(html) ?? str(found.video);
  const video = videoUrl && isAllowedVideo(videoUrl) ? videoUrl : undefined;
  const title = str(o?.title) ?? str(found.title);
  const author = str(o?.author_name) ?? str(found.author);
  const description = str(found.description);

  return {
    platform: 'pinterest',
    url: page,
    ...(author ? { author: { name: author, ...(str(o?.author_url) ? { url: str(o?.author_url)! } : {}) } } : {}),
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(description && description !== title ? { text: description.slice(0, 300) } : {}),
    media: [
      video
        ? { kind: 'video', src: video, poster: src, ...(w ? { w } : {}), ...(h ? { h } : {}) }
        : { kind: 'photo', src, ...(w ? { w } : {}), ...(h ? { h } : {}) },
    ],
  };
}

async function answer(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const p = q.get('p');

  if (p === 'x') {
    const user = q.get('user') ?? 'i';
    const id = q.get('id') ?? '';
    if (!HANDLE.test(user) || !NUMERIC.test(id)) return nothing(HOUR);
    const post = await tweet(user, id);
    return post ? json(post, HOUR) : nothing(300);
  }

  if (p === 'pin') {
    let id = q.get('id') ?? '';
    const short = q.get('short');
    if (short) {
      if (!SHORT.test(short)) return nothing(HOUR);
      id = (await resolveShort(short)) ?? '';
    }
    if (!NUMERIC.test(id)) return nothing(300);
    const post = await pin(id);
    return post ? json(post, 6 * HOUR) : nothing(300);
  }

  return nothing(HOUR);
}

/** A good answer is kept at the edge, so a viral post costs one fetch an hour, not one per reader. */
export const onRequestGet = async (context: { request: Request; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const key = new Request(new URL(context.request.url).toString(), { method: 'GET' });
  const cache = typeof caches === 'undefined' ? undefined : caches.default;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;
  const response = await answer(context.request);
  if (response.ok && cache) {
    const kept = cache.put(key, response.clone()).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(kept);
    else await kept;
  }
  return response;
};
