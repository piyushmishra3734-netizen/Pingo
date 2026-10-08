import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { chunkUrlFrom, healPoisonedAssets, looksLikeMissingChunk } from '../lib/chunk-recovery.js';

/**
 * The thing that stops a bad render from being a white page forever.
 *
 * ## What was happening
 *
 * Every screen is a `React.lazy` import inside one `<Suspense>`, and there was
 * no error boundary anywhere above it. So a chunk that failed to load - and
 * they do fail: a deploy changes every hash, a service worker keeps serving the
 * `index.html` that names the old ones, a phone loses signal mid-navigation -
 * threw, nothing caught it, and React unmounted the entire application. The
 * result is a blank white screen with no message, no button and no way back.
 *
 * Refreshing did not help, which is the part that made it look like corruption
 * rather than a failed request: the worker answered the reload from its own
 * cache with the same stale HTML, which asked for the same missing chunk.
 * Going back and returning did the same thing for the same reason.
 *
 * ## What happens now
 *
 * The lazy wrappers retry a failed chunk under a fresh URL first
 * (`importWithRetry`), so most failures never reach this boundary. One that
 * does is treated as what it is - this build is gone, or a cache holds HTML
 * under a script's name - so the poisoned HTTP cache entries are replaced,
 * the caches dropped, the worker unregistered and the page reloaded.
 *
 * Not forever, though. A reload that fails the same way straight away is a
 * real bug, not a stale cache, and a boundary that keeps reloading turns it
 * into an infinite flicker nobody can read or escape - so after three tries
 * in two minutes it shows the error instead.
 *
 * Anything that is not a chunk failure is not reloaded at all: a component that
 * throws on this data will throw again after a reload, and spinning the page is
 * a worse answer than saying so. It gets its own page, with the error on it.
 */

/** The repair reloads so far: `{ at, count }`. Survives the reloads it triggers. */
const RECOVERY_KEY = 'pingo:chunk-reloads';
/**
 * Silent reloads allowed inside the window before it is called a real fault.
 *
 * One was not enough, and the fallback was a whole page saying "a new version
 * landed - Reload PINGO". People met that page after nearly every deploy and
 * found it maddening: a new version should just be there. So a stale build
 * now gets three quiet reloads, and the page is kept for the case where three
 * fresh loads all fail - which is not a new version, it is a bug.
 */
const MAX_RELOADS = 3;
const RETRY_WINDOW_MS = 2 * 60_000;
/** How long the app has to stay up before the reload count is forgotten. */
const HEALTHY_MS = 30_000;

/*
 * Re-exported for anything that imported it from here. The test itself moved
 * beside `importWithRetry`, which marks its own failures as `ChunkLoadError`.
 */
export { looksLikeMissingChunk };

const isCodeCache = (name: string) => name.startsWith('workbox-precache') || name === 'pingo-chunks' || name === 'pingo-shell';

async function dropCachesAndReload(error?: unknown): Promise<void> {
  try {
    /*
     * The HTTP cache first, while the worker can still answer for the files it
     * holds. This is the cache the old repair never reached, and the reason
     * three reloads in a row could all fail the same way (chunk-recovery.ts).
     */
    await healPoisonedAssets([chunkUrlFrom(error)]);
    /*
     * Then the worker. Deleting the caches while it is still controlling the
     * page means it can repopulate them from its own precache manifest - the
     * very list of files that no longer exist - and the reload lands on the
     * same missing chunk.
     */
    if ('serviceWorker' in navigator) {
      const workers = await navigator.serviceWorker.getRegistrations();
      await Promise.all(workers.map((worker) => worker.unregister()));
    }
    /*
     * Only the caches that hold the app's own code: the precache, the chunks
     * and the HTML shell. Those are what a stale build is made of. Photos,
     * videos and fonts already seen (`pingo-media`, `pingo-fonts`) have
     * nothing to do with a missing chunk, and they stay until the person
     * clears them in Settings.
     */
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.filter(isCodeCache).map((name) => caches.delete(name)));
    }
  } catch {
    // Reload anyway. A refusal to clear one cache is not a reason to leave
    // somebody on a blank page.
  }
  // `location.reload()` can be served from the back/forward cache. Replacing
  // the URL with itself cannot.
  window.location.replace(window.location.href);
}

function forgetReloads(): void {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* nothing to forget */
  }
}

interface Props {
  children: ReactNode;
  /** The path. A new one clears a failure: one broken screen must not take every other one with it. */
  resetKey: string;
}

interface State {
  failed: boolean;
  error?: unknown;
  message?: string;
  /** A missing chunk rather than a screen that threw. Decides what the page says and what retry does. */
  chunk?: boolean;
  /** Reloading to repair it: nothing to read, so nothing is shown but a spinner. */
  recovering?: boolean;
}

class Boundary extends Component<Props, State> {
  override state: State = { failed: false };
  private healthy: number | undefined;

  static getDerivedStateFromError(error: unknown): State {
    const chunk = looksLikeMissingChunk(error);
    return {
      failed: true,
      error,
      message: error instanceof Error ? error.message : String(error),
      chunk,
      // Assumed repairable until componentDidCatch finds it was just tried, so the error never flashes first.
      recovering: chunk,
    };
  }

  /*
   * A recovery that worked is forgotten. The count used to live for two
   * minutes after the last attempt whatever happened next, so a repaired
   * launch followed by one more stale screen started at "already tried".
   */
  override componentDidMount(): void {
    this.healthy = window.setTimeout(() => {
      if (!this.state.failed) forgetReloads();
    }, HEALTHY_MS);
  }

  override componentWillUnmount(): void {
    window.clearTimeout(this.healthy);
  }

  /*
   * Navigating away clears the failure. This boundary wraps every route, and
   * without this one screen that threw left the error page over all of them:
   * the dock went to Calls, Settings, the chat list, and each showed the same
   * "did not open" until the app was reloaded. One broken screen looked like
   * a broken app.
   */
  override componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Logged before anything else, because the repair below reloads the page
    // and takes the console with it.
    console.error('RouteBoundary caught', error, info.componentStack);

    if (!looksLikeMissingChunk(error)) return;

    /*
     * Offline is not a stale build. Unregistering the worker there would take
     * away the offline app itself, so it waits for the connection and then
     * reloads.
     */
    if (!navigator.onLine) {
      window.addEventListener('online', () => void dropCachesAndReload(error), { once: true });
      return;
    }

    let alreadyTried = false;
    let count = 0;
    try {
      const last = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? 'null') as { at: number; count: number } | null;
      count = last && Date.now() - last.at < RETRY_WINDOW_MS ? last.count : 0;
      alreadyTried = count >= MAX_RELOADS;
      if (!alreadyTried) sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: Date.now(), count: count + 1 }));
    } catch {
      /*
       * No sessionStorage means no way to know whether this is the second
       * attempt, and a reload loop is worse than a message. Treated as "already
       * tried", so it explains itself rather than spinning.
       */
      alreadyTried = true;
    }

    if (alreadyTried) this.setState({ recovering: false });
    // A beat before the second and third tries, for a deploy still settling.
    else window.setTimeout(() => void dropCachesAndReload(error), count === 0 ? 0 : 1500);
  }

  private retry = (): void => {
    if (this.state.chunk) {
      // A deliberate tap is a fresh start: the count is for automatic reloads.
      forgetReloads();
      this.setState({ recovering: true });
      void dropCachesAndReload(this.state.error);
    } else {
      // A screen that threw: draw it again in place. No reload, no cache wipe.
      this.setState({ failed: false });
    }
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.state.recovering) {
      return (
        <div className="grid h-full place-items-center bg-page" role="status" aria-label="Loading">
          <span aria-hidden className="size-7 animate-spin rounded-full border-[3px] border-line border-t-brand" />
        </div>
      );
    }

    /*
     * Two pages, because they are two different faults.
     *
     * Every error used to get "It failed to load a few times in a row" - also
     * a screen that had loaded fine and simply threw on its data, which had
     * been reloaded zero times. That sentence sent people to retry something
     * retrying could not fix, and buried the one line that said what was
     * wrong. A screen that threw now says so and shows the error itself.
     */
    const { chunk, message } = this.state;
    return (
      <div className="grid h-full place-items-center bg-page p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-h2 text-ink">{chunk ? 'That screen did not open' : 'Something went wrong on this screen'}</h1>
          <p className="mt-2 text-caption text-text-secondary">
            {chunk
              ? 'Part of the app could not be downloaded, even after a few tries. Check the connection and try once more.'
              : 'The rest of PINGO is fine. Go back, or try this screen again.'}
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="focus-ring mt-5 rounded-full bg-brand px-5 py-2.5 text-body font-medium text-on-brand active:scale-[0.98]"
          >
            Try again
          </button>
          {chunk ? null : (
            <button
              type="button"
              onClick={() => window.location.replace(window.location.href)}
              className="focus-ring mx-auto mt-3 block text-caption text-text-secondary hover:underline"
            >
              Reload PINGO
            </button>
          )}
          {message ? (
            <p
              className={
                chunk
                  ? 'mt-4 break-words text-[11px] text-text-tertiary'
                  : 'mt-4 break-words rounded-xl bg-sunken px-3 py-2 text-left font-mono text-[12px] text-text-secondary'
              }
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
}

/** Keyed on the path from inside the router, so a failure belongs to the screen that had it. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
