/**
 * A `fetch` for a bad connection: reads that give up on a dead socket and try
 * again, and writes that are left exactly as they were.
 *
 * ## What goes wrong without it
 *
 * On a weak connection a request does not fail, it hangs: the socket is open and
 * nothing comes back. The screen waits behind it with a spinner (the activity
 * feed sat on "Loading activity" for as long as the phone was offline), and a
 * single dropped packet turns a list into an empty one. So a read here
 *
 *   - is abandoned after a time limit instead of waiting for ever,
 *   - is tried again, twice, after a short and growing pause, when the network
 *     failed it or the server said it was briefly unavailable (502, 503, 504), and
 *   - when the device says it has no network at all, is given one short attempt
 *     instead of a full one, so the screen falls back to what is kept on the
 *     device at once.
 *
 * ## What it never does
 *
 * It never retries or times out a write. A write that timed out may have
 * happened, and sending it again is how a message is sent twice or a request
 * accepted twice; those go through the outbox, which knows how to be safe. Reads
 * are told apart by method (GET and HEAD) and, for the few reads the API only
 * offers as a POST to a function, by name: anything not on that list is a write.
 */

/** A read the API only exposes as a POST to a function. Anything else is a write. */
const READ_FUNCTIONS = new Set([
  'conversation_previews',
  'messages_page',
  'my_streaks',
  'profile_stats',
  'notes_feed',
  'latest_reactions',
  'get_ai_public_identity',
  'visible_media',
  'visible_chat_media',
  'app_flag',
  'conversation_can_use_r2',
]);

export const ATTEMPT_MS = 25_000;
/** One short attempt when the device already knows it is offline. */
export const OFFLINE_ATTEMPT_MS = 4_000;
const RETRIES = 2;
const RETRY_STATUS = new Set([502, 503, 504]);

export interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

function isRead(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  if (typeof Request !== 'undefined' && input instanceof Request) return false;
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  if (method !== 'POST') return false;
  try {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : String(input)).pathname;
    const name = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path)?.[1];
    return name !== undefined && READ_FUNCTIONS.has(name);
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Limits {
  attemptMs: number;
  offlineMs: number;
  /** The pause before attempt number `n + 1`, in milliseconds. */
  pauseMs: (n: number) => number;
}

const LIMITS: Limits = {
  attemptMs: ATTEMPT_MS,
  offlineMs: OFFLINE_ATTEMPT_MS,
  pauseMs: (n) => 400 * 3 ** n + Math.floor(Math.random() * 150),
};

export function resilient(
  base: FetchLike,
  onLine: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  limits: Limits = LIMITS,
): FetchLike {
  return async (input, init) => {
    if (!isRead(input, init)) return base(input, init);

    const offline = !onLine();
    const attempts = offline ? 1 : RETRIES + 1;
    let failure: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const outer = init?.signal ?? undefined;
      if (outer?.aborted) throw outer.reason ?? new DOMException('Aborted', 'AbortError');

      const own = new AbortController();
      const stop = () => own.abort(outer?.reason);
      outer?.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(() => own.abort(new DOMException('Timed out', 'TimeoutError')), offline ? limits.offlineMs : limits.attemptMs);

      try {
        const response = await base(input, { ...init, signal: own.signal });
        if (RETRY_STATUS.has(response.status) && attempt < attempts - 1) {
          failure = new Error(`HTTP ${response.status}`);
        } else {
          return response;
        }
      } catch (cause) {
        // The caller's own cancel is theirs to see, not something to retry.
        if (outer?.aborted) throw cause;
        failure = cause;
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', stop);
      }

      if (attempt < attempts - 1) await sleep(limits.pauseMs(attempt));
    }
    throw failure instanceof Error ? failure : new TypeError('Failed to fetch');
  };
}
