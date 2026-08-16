import { getSupabaseClient } from '../supabase/client.js';

/**
 * Screen sharing on a phone, where the browser cannot do it.
 *
 * ## Why any of this exists
 *
 * Chrome and Firefox on Android ship `getDisplayMedia` and reject every call to
 * it. The API is defined and not implemented, and there is no WebView hook that
 * changes that - a Chromium WebView cannot capture a screen either. The only
 * route on Android is `MediaProjection`, which is a platform API, not a web one.
 *
 * ## Why it is a second connection
 *
 * MediaProjection produces frames in the app, not in the page, and there is no
 * supported way to hand them to the WebView's own WebRTC stack. So the native
 * side joins the same LiveKit room itself and publishes the screen from there.
 *
 * LiveKit removes the existing participant when a second one joins under the
 * same identity, so the screen joins as `<user>#screen` with a token minted for
 * exactly that - see the `screen` flag in the `livekit-token` function. It is a
 * weaker pass than the person's: it may publish a screen and nothing else, and
 * it may not subscribe to anybody. A phone should not be downloading everyone
 * else's video twice over mobile data to render it nowhere.
 *
 * ## What the browser side still owns
 *
 * Everything visible. The screen arrives back at this device like anybody
 * else's, through the same `TrackSubscribed` path, so the sharer's own preview,
 * the stage layout and the "you're presenting" line all work without knowing
 * where the frames came from.
 */

/** The plugin the Android shell registers. Absent everywhere else. */
interface ScreenCapturePlugin {
  /** Asks for MediaProjection consent, then joins and publishes. */
  start(options: { url: string; token: string }): Promise<void>;
  stop(): Promise<void>;
}

function plugin(): ScreenCapturePlugin | undefined {
  const capacitor = (
    globalThis as {
      Capacitor?: {
        isPluginAvailable?: (name: string) => boolean;
        Plugins?: Record<string, unknown>;
      };
    }
  ).Capacitor;

  if (!capacitor?.isPluginAvailable?.('ScreenCapture')) return undefined;
  return capacitor.Plugins?.['ScreenCapture'] as ScreenCapturePlugin | undefined;
}

export function nativeScreenCaptureAvailable(): boolean {
  return plugin() !== undefined;
}

/**
 * Starts the native share for this call.
 *
 * The token is fetched here rather than in the plugin so the secret handling
 * stays in one place: the Edge Function is called with the user's own session
 * exactly as it is for the person's own token, and the native side receives a
 * short-lived pass it cannot widen.
 */
export async function startNativeScreenShare(
  callId: string,
  conversationId: string,
): Promise<void> {
  const native = plugin();
  if (!native) throw new Error('Screen capture is not available on this device.');

  const { data, error } = await getSupabaseClient().functions.invoke('livekit-token', {
    body: { callId, conversationId, screen: true },
  });
  if (error) throw new Error('Could not get permission to share.');

  const grant = data as { url?: string; token?: string } | undefined;
  if (!grant?.url || !grant.token) throw new Error('Calling is not configured.');

  await native.start({ url: grant.url, token: grant.token });
}

export async function stopNativeScreenShare(): Promise<void> {
  await plugin()?.stop();
}
