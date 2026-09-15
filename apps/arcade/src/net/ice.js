/** Google's public STUN: enough on most home Wi-Fi, and the fallback always. */
export const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * The ICE servers to connect with, from the signalling Worker's /ice.
 *
 * The Worker adds Cloudflare TURN when it is configured - the relay that gets
 * two phones on carrier-grade NAT talking. If the Worker is slow or down the
 * match still tries with STUN alone rather than waiting on it: most pairs do
 * not need TURN, and none of them should wait three seconds to find that out.
 */
export async function fetchIceServers(signalUrl, timeoutMs = 3000) {
  try {
    const response = await fetch(`${signalUrl.replace(/^ws/, 'http')}/ice`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return STUN;
    const { iceServers } = await response.json();
    return Array.isArray(iceServers) && iceServers.length > 0 ? iceServers : STUN;
  } catch {
    return STUN;
  }
}
