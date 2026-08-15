import { deviceIdentity } from '../../lib/crypto/keys.js';
import { BUILD_ID } from '../../lib/build-id.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { activityStatusOn } from '../settings/privacy-flags.js';

/**
 * Keeps "last seen" true while somebody is actually here.
 *
 * ## What it was reporting instead
 *
 * `last_seen_at` on `device_keys` was written by `publishDeviceKey`, which is
 * memoised and therefore runs exactly once per page load. So the column held
 * the moment the app was *launched*, not the moment the person was last using
 * it - and a session left open for three hours reported "last seen 3 hours ago"
 * the instant it closed. The number was never a guess; it was answering a
 * different question from the one the header asks.
 *
 * ## A minute, and only while the app is in front
 *
 * A write a minute is nothing against the traffic a chat already makes, and it
 * bounds the error to that minute - which is finer than any wording built on it
 * ("just now", "2 minutes ago") can express, so the display can never be caught
 * out.
 *
 * It stops when the app is hidden, which is the point: the last write before
 * going away *is* the moment they left, and continuing to write from a
 * backgrounded tab would report somebody as present while their phone is in
 * their pocket.
 */

/** Fine enough that no phrasing built on it can be wrong. */
const BEAT_MS = 60_000;

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

async function beat(): Promise<void> {
  /*
   * Activity status off means the clock stops here.
   *
   * This write is the *only* thing that says somebody is present, so not doing
   * it is the whole of hiding it - there is nothing left for another client to
   * be asked not to display. The last value written stays where it is and ages
   * into "offline" on its own, which is what somebody turning this off is
   * asking for: not a lie about where they were, just no news from now on.
   *
   * Checked per beat rather than at start, so the switch takes effect within a
   * minute instead of at the next launch.
   */
  if (!activityStatusOn()) return;

  try {
    const identity = await deviceIdentity();
    await getSupabaseClient()
      .from('device_keys')
      .update({ last_seen_at: new Date().toISOString(), build: BUILD_ID })
      .eq('device_id', identity.deviceId);
  } catch {
    /*
     * Silent, deliberately. A missed beat costs at most a minute of accuracy
     * on somebody else's screen, and there is nothing the person holding this
     * phone could do about it.
     */
  }
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

function start(): void {
  stop();
  void beat();
  timer = setInterval(() => void beat(), BEAT_MS);
}

/**
 * Starts the heartbeat, and ties it to whether the app is in front.
 *
 * Returns the teardown. Writing once more on the way out is what makes leaving
 * precise rather than accurate to the last beat - closing a tab is the single
 * moment we most want the timestamp to be right.
 */
export function startHeartbeat(): () => void {
  if (running) return () => undefined;
  running = true;

  const onVisibility = () => {
    if (document.visibilityState === 'visible') start();
    else {
      stop();
      void beat();
    }
  };

  if (document.visibilityState === 'visible') start();
  document.addEventListener('visibilitychange', onVisibility);

  /*
   * `pagehide`, not `beforeunload`. Mobile browsers frequently never fire
   * `beforeunload` - the tab is discarded rather than closed - and `pagehide`
   * is the one that fires on the way into the background/forward cache too.
   */
  const onLeave = () => void beat();
  window.addEventListener('pagehide', onLeave);

  return () => {
    running = false;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onLeave);
  };
}
