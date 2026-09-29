import { Component, type ErrorInfo, type ReactNode } from 'react';

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
 * A failed chunk is treated as what it is - this build is gone, the one on the
 * server is newer - so the caches are dropped, the worker is unregistered and
 * the page is reloaded once. That is the only repair there is, and it is the
 * one the user was trying to perform by refreshing.
 *
 * Not twice in a row, though. A reload that fails the same way straight away is
 * a real bug, not a stale cache, and a boundary that keeps reloading turns it
 * into an infinite flicker nobody can read or escape - so within twenty seconds
 * of the last try it shows the error instead.
 *
 * It used to be once per *session*, and that was the complaint: PINGO ships
 * several times a day, so the second deploy an open app lived through landed
 * on this error screen instead of quietly reloading. A time window keeps the
 * loop guard and lets every later deploy recover on its own.
 *
 * Anything that is not a chunk failure is not reloaded at all: a component that
 * throws on this data will throw again after a reload, and spinning the page is
 * a worse answer than saying so.
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

/**
 * Every phrasing the browsers use for "the module would not load".
 *
 * There is no error type to check - Chrome, Safari and Firefox each throw a
 * plain `Error` with their own sentence, and the sentence is the only signal.
 * Matched loosely on purpose: a false positive costs one reload, and a false
 * negative costs the white screen this exists to prevent.
 */
export function looksLikeMissingChunk(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|NetworkError when attempting to fetch resource/i.test(
    message,
  );
}

async function dropCachesAndReload(): Promise<void> {
  try {
    /*
     * The worker first. Deleting the caches while it is still controlling the
     * page means it can repopulate them from its own precache manifest - the
     * very list of files that no longer exist - and the reload lands on the
     * same missing chunk.
     */
    if ('serviceWorker' in navigator) {
      const workers = await navigator.serviceWorker.getRegistrations();
      await Promise.all(workers.map((worker) => worker.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
  } catch {
    // Reload anyway. A refusal to clear one cache is not a reason to leave
    // somebody on a blank page.
  }
  // `location.reload()` can be served from the back/forward cache. Replacing
  // the URL with itself cannot.
  window.location.replace(window.location.href);
}

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
  message?: string;
  /** Reloading to repair it: nothing to read, so nothing is shown but a spinner. */
  recovering?: boolean;
}

export class RouteBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return {
      failed: true,
      message: error instanceof Error ? error.message : String(error),
      // Assumed repairable until componentDidCatch finds it was just tried, so the error never flashes first.
      recovering: looksLikeMissingChunk(error),
    };
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
      window.addEventListener('online', () => void dropCachesAndReload(), { once: true });
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
    else window.setTimeout(() => void dropCachesAndReload(), count === 0 ? 0 : 1500);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.state.recovering) {
      return (
        <div className="grid h-full place-items-center bg-page" role="status" aria-label="Loading">
          <span aria-hidden className="size-7 animate-spin rounded-full border-[3px] border-line border-t-brand" />
        </div>
      );
    }

    return (
      <div className="grid h-full place-items-center bg-page p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-h2 text-ink">That screen did not open</h1>
          <p className="mt-2 text-caption text-text-secondary">
            It failed to load a few times in a row. Try once more.
          </p>
          <button
            type="button"
            onClick={() => void dropCachesAndReload()}
            className="focus-ring mt-5 rounded-full bg-brand px-5 py-2.5 text-body font-medium text-on-brand active:scale-[0.98]"
          >
            Try again
          </button>
          {this.state.message ? (
            <p className="mt-4 break-words text-[11px] text-text-tertiary">
              {this.state.message}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
}
