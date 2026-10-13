/**
 * Reading an OpenAI Responses stream, event by event.
 *
 * Pure on purpose: no fetch, no Deno, no database. The request and its
 * retries live in `openai.ts`; this only turns the server-sent events into
 * what a PINGO AI turn needs (the text as it is written, the sources it
 * cited, the pictures it drew, the functions it wants run), so it can be
 * asserted with recorded streams under plain Node. See `_responses_selftest.mjs`.
 */

export interface Source {
  title: string;
  url: string;
}

export interface FunctionCall {
  /** The output item's id (fc_...). */
  id: string;
  /** What a function_call_output answers to. */
  call_id: string;
  name: string;
  arguments: string;
}

export interface DrawnImage {
  id: string;
  /** Base64, no data: prefix. */
  b64: string;
  format: string;
  revisedPrompt?: string;
}

export interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

/** What the turn is busy with, as the stream reveals it. */
export type Activity = 'searching' | 'drawing' | 'writing';

export interface StreamHooks {
  onText?: (delta: string) => void;
  onActivity?: (activity: Activity) => void;
  /** The cited sources so far, whenever a new one arrives. */
  onSources?: (sources: Source[]) => void;
  onPartialImage?: (b64: string, index: number) => void;
}

// deno-lint-ignore no-explicit-any
type Json = any;

const MAX_SOURCES = 12;

/**
 * One response, accumulated. Feed it every parsed `data:` object in order and
 * read the fields when the stream ends.
 */
export class ResponsesStream {
  text = '';
  sources: Source[] = [];
  calls: FunctionCall[] = [];
  images: DrawnImage[] = [];
  /** Every finished output item, as sent: what goes back as input for the next round. */
  items: Json[] = [];
  searches = 0;
  /** The image tool was started but ended without a picture. */
  imageFailed = false;
  status = '';
  incompleteReason = '';
  error: { code?: string; message: string } | undefined;
  usage: ResponsesUsage | undefined;
  responseId = '';

  #args = new Map<string, string>();
  #hooks: StreamHooks;
  #textItems = new Set<string>();

  constructor(hooks: StreamHooks = {}) {
    this.#hooks = hooks;
  }

  feed(e: Json): void {
    if (!e || typeof e !== 'object') return;
    switch (e.type) {
      case 'response.created':
      case 'response.in_progress':
        if (e.response?.id) this.responseId = e.response.id;
        return;

      case 'response.output_text.delta':
      case 'response.refusal.delta':
        if (typeof e.delta === 'string' && e.delta) {
          if (e.item_id) this.#textItems.add(e.item_id);
          this.text += e.delta;
          this.#hooks.onActivity?.('writing');
          this.#hooks.onText?.(e.delta);
        }
        return;

      case 'response.output_text.annotation.added':
        this.#cite(e.annotation);
        return;

      case 'response.web_search_call.in_progress':
      case 'response.web_search_call.searching':
        this.#hooks.onActivity?.('searching');
        return;

      case 'response.image_generation_call.in_progress':
      case 'response.image_generation_call.generating':
        this.#hooks.onActivity?.('drawing');
        return;

      case 'response.image_generation_call.partial_image':
        if (typeof e.partial_image_b64 === 'string') this.#hooks.onPartialImage?.(e.partial_image_b64, e.partial_image_index ?? 0);
        return;

      case 'response.function_call_arguments.delta':
        if (e.item_id && typeof e.delta === 'string') this.#args.set(e.item_id, (this.#args.get(e.item_id) ?? '') + e.delta);
        return;

      case 'response.function_call_arguments.done':
        if (e.item_id && typeof e.arguments === 'string') this.#args.set(e.item_id, e.arguments);
        return;

      case 'response.output_item.added':
        if (e.item?.type === 'web_search_call') this.#hooks.onActivity?.('searching');
        if (e.item?.type === 'image_generation_call') this.#hooks.onActivity?.('drawing');
        return;

      case 'response.output_item.done':
        this.#item(e.item);
        return;

      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed':
        this.#finish(e.response);
        return;

      case 'error':
        this.error = { ...(e.code ? { code: String(e.code) } : {}), message: String(e.message ?? 'stream error') };
        return;
    }
  }

  #cite(a: Json): void {
    if (!a || a.type !== 'url_citation' || typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) return;
    const url = cleanUrl(a.url);
    if (this.sources.some((s) => s.url === url) || this.sources.length >= MAX_SOURCES) return;
    const title = (typeof a.title === 'string' && a.title.trim()) || hostOf(url);
    this.sources.push({ title: title.slice(0, 200), url: url.slice(0, 1000) });
    this.#hooks.onSources?.([...this.sources]);
  }

  #item(item: Json): void {
    if (!item || typeof item !== 'object') return;
    if (item.id && this.items.some((i) => i.id === item.id)) return;
    switch (item.type) {
      case 'function_call': {
        const args = typeof item.arguments === 'string' && item.arguments ? item.arguments : (this.#args.get(item.id) ?? '');
        if (item.name) this.calls.push({ id: item.id ?? '', call_id: item.call_id ?? item.id ?? '', name: item.name, arguments: args });
        this.items.push({ ...item, arguments: args });
        return;
      }
      case 'web_search_call':
        this.searches++;
        this.items.push(item);
        return;
      case 'image_generation_call':
        if (typeof item.result === 'string' && item.result) {
          this.images.push({
            id: item.id ?? '',
            b64: item.result,
            format: typeof item.output_format === 'string' ? item.output_format : 'png',
            ...(item.revised_prompt ? { revisedPrompt: String(item.revised_prompt) } : {}),
          });
        } else {
          this.imageFailed = true;
        }
        this.items.push(item);
        return;
      case 'message':
        /*
         * The finished message carries its annotations too. Read again here so
         * a stream that skipped the annotation events still has its sources,
         * and the text of a message whose deltas never came is not lost.
         */
        for (const part of Array.isArray(item.content) ? item.content : []) {
          for (const a of Array.isArray(part?.annotations) ? part.annotations : []) this.#cite(a);
          if (!this.#textItems.has(item.id) && typeof part?.text === 'string' && part.text) {
            this.text += part.text;
            this.#hooks.onText?.(part.text);
          }
        }
        if (item.id) this.#textItems.add(item.id);
        this.items.push(item);
        return;
      default:
        this.items.push(item);
    }
  }

  #finish(r: Json): void {
    if (!r || typeof r !== 'object') return;
    if (r.id) this.responseId = r.id;
    this.status = String(r.status ?? '');
    if (r.usage) this.usage = r.usage;
    if (r.incomplete_details?.reason) this.incompleteReason = String(r.incomplete_details.reason);
    if (r.error?.message) this.error = { ...(r.error.code ? { code: String(r.error.code) } : {}), message: String(r.error.message) };
    // Items whose own done event was missed are still in the final output.
    for (const item of Array.isArray(r.output) ? r.output : []) this.#item(item);
  }
}

/**
 * Server-sent events, split on the blank line that ends each one. A chunk can
 * end mid-event, so the remainder waits for the next chunk.
 */
export class SseSplitter {
  #buffer = '';

  push(chunk: string): Json[] {
    this.#buffer += chunk.replace(/\r\n?/g, '\n');
    const frames = this.#buffer.split('\n\n');
    this.#buffer = frames.pop() ?? '';
    return frames.flatMap(parseFrame);
  }

  /** Whatever was left when the stream closed without a final blank line. */
  end(): Json[] {
    const rest = this.#buffer;
    this.#buffer = '';
    return rest.trim() ? parseFrame(rest) : [];
  }
}

function parseFrame(frame: string): Json[] {
  const data = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return [];
  try {
    return [JSON.parse(data)];
  } catch {
    return [];
  }
}

/**
 * The inline citation the model writes, "([site](url))", taken out of the
 * text when that url is one of the sources: the thread shows sources under
 * the reply, so the same link in the middle of a sentence is noise on a
 * phone. Links the model wrote on purpose, to something not cited, stay.
 */
export function stripCitations(text: string, sources: Source[]): string {
  if (!sources.length) return text;
  const cited = new Set(sources.map((s) => s.url));
  return text
    .replace(/[ \t]*\(\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)\)/g, (all, _label, url: string) => (cited.has(cleanUrl(url)) ? '' : all))
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** OpenAI tags cited links with utm_source=openai; the person does not need it. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.get('utm_source') !== 'openai') return url;
    u.searchParams.delete('utm_source');
    return u.toString();
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Optional request fields a model may refuse. A 400 naming one of them is
 * retried without them all: a newer or older model should still answer, just
 * without the extra.
 */
const OPTIONAL = ['reasoning', 'prompt_cache_key', 'include', 'parallel_tool_calls', 'tool_choice'];

const MEDIA = new Set(['input_image', 'input_file']);

/**
 * After a 400: change the request so the same refusal cannot happen again, and
 * say what was given up, or null when nothing here explains it (a bad model
 * name, a bad key) and the error should stand.
 *
 * In order: the reasoning effort (some efforts refuse some tools, and the
 * tool is worth more than the effort), a built-in tool the model does not
 * offer, the image model inside the image tool, attachments it cannot open,
 * and last the optional parameters. One thing per call, so a second refusal
 * gets its own retry.
 */
export function relaxRequest(body: Record<string, Json>, detail: string): string | null {
  let message = detail;
  let param = '';
  try {
    const parsed = JSON.parse(detail);
    message = String(parsed?.error?.message ?? detail);
    param = String(parsed?.error?.param ?? '');
  } catch {
    // Not JSON: read the text as it is.
  }
  const said = `${message} ${param}`;
  const tools: Json[] = Array.isArray(body.tools) ? body.tools : [];
  const builtins = tools.filter((t) => t?.type && t.type !== 'function');

  if (body.reasoning && /reasoning|effort/i.test(said)) {
    // gpt-6-luna has refused tools with any effort but 'none'; leaving it out is not 'none'.
    if (tools.length && /'none'|"none"/.test(said) && body.reasoning.effort !== 'none') {
      body.reasoning = { effort: 'none' };
      return 'reasoning.effort=none';
    }
    delete body.reasoning;
    return 'reasoning';
  }

  const named = builtins.find(
    (t) =>
      said.includes(String(t.type)) ||
      param.startsWith(`tools[${tools.indexOf(t)}]`) ||
      (t.type === 'image_generation' && /gpt-image|image[ _-]?generation/i.test(said)) ||
      (t.type === 'web_search' && /web[ _-]?search/i.test(said)),
  );
  if (named) {
    if (named.type === 'image_generation' && named.model && /model|gpt-image/i.test(said)) {
      // The image model this key cannot use: let OpenAI pick its default.
      delete named.model;
      return 'image_generation.model';
    }
    body.tools = tools.filter((t) => t !== named);
    // A forced tool that is gone cannot be forced.
    if (JSON.stringify(body.tool_choice ?? '').includes(`"${named.type}"`)) body.tool_choice = 'auto';
    if (!body.tools.length) {
      delete body.tools;
      delete body.tool_choice;
      delete body.parallel_tool_calls;
    }
    return String(named.type);
  }

  const input: Json[] = Array.isArray(body.input) ? body.input : [];
  const hasMedia = input.some((m) => Array.isArray(m?.content) && m.content.some((p: Json) => MEDIA.has(p?.type)));
  if (hasMedia && /input_image|input_file|image_url|file_data|file_url|download|mime|media type|image|pdf|\bfiles?\b/i.test(said)) {
    for (const m of input) {
      if (!Array.isArray(m?.content)) continue;
      m.content = m.content.map((p: Json) =>
        MEDIA.has(p?.type) ? { type: 'input_text', text: `[${p.type === 'input_image' ? 'A photo' : 'A file'} was attached here, but it could not be opened.]` } : p,
      );
    }
    return 'media';
  }

  const present = OPTIONAL.filter((p) => p in body);
  if (present.length && OPTIONAL.some((p) => said.includes(p))) {
    for (const p of present) delete body[p];
    return 'optional';
  }
  return null;
}

/** The faces the app can draw for PINGO AI. */
export const MOODS = ['default', 'happy', 'excited', 'thinking', 'surprised', 'sleepy', 'confused', 'sad', 'angry', 'listening', 'talking'] as const;
export type Mood = (typeof MOODS)[number];

const MOOD_TAG = /\[\[\s*mood\s*:\s*([a-z]*)\s*\]\]/gi;
/** Everything a tag could be before its last character has arrived. */
const MOOD_PREFIX = /^\[(?:\[(?:\s*(?:m(?:o(?:o(?:d(?:\s*(?::\s*[a-z]*\s*\]?)?)?)?)?)?)?)?)?$/i;

export function asMood(word: string | undefined, fallback: Mood = 'happy'): Mood {
  const w = (word ?? '').toLowerCase();
  return (MOODS as readonly string[]).includes(w) ? (w as Mood) : fallback;
}

/** The finished text without its mood tag, and the mood it named (the last one wins). */
export function takeMood(text: string): { text: string; mood: Mood | undefined } {
  let mood: Mood | undefined;
  const clean = text.replace(MOOD_TAG, (_all, word: string) => {
    mood = asMood(word, mood ?? 'happy');
    return '';
  });
  return { text: clean.replace(/[ \t]+\n/g, '\n').trim(), mood };
}

/**
 * The reply as it streams, with the hidden `[[mood:x]]` tag taken out before
 * anyone sees or hears it. A piece that might be the start of a tag ("[", "[[mo")
 * is held back until the next piece says whether it was one.
 */
export class MoodFilter {
  mood: Mood | undefined;
  #held = '';

  push(piece: string): string {
    this.#held += piece;
    let out = '';
    for (;;) {
      const i = this.#held.indexOf('[');
      if (i < 0) {
        out += this.#held;
        this.#held = '';
        return out;
      }
      out += this.#held.slice(0, i);
      this.#held = this.#held.slice(i);
      const tag = /^\[\[\s*mood\s*:\s*([a-z]*)\s*\]\]/i.exec(this.#held);
      if (tag) {
        this.mood = asMood(tag[1], this.mood ?? 'happy');
        this.#held = this.#held.slice(tag[0].length);
        continue;
      }
      if (MOOD_PREFIX.test(this.#held)) return out;
      // Not a tag after all: the bracket is text.
      out += '[';
      this.#held = this.#held.slice(1);
    }
  }

  /** Whatever was held when the stream ended: an unfinished tag is dropped, anything else is text. */
  end(): string {
    const rest = this.#held;
    this.#held = '';
    return /^\[\[\s*m/i.test(rest) ? '' : rest;
  }
}
