import { useChat } from '@pingo/core';
import { useEffect, useRef, useState } from 'react';

/**
 * Whether the app can currently reach anything, and how well.
 *
 * ## The state already existed; nobody was showing it
 *
 * `chat-service` has computed a `ConnectionState` since realtime was added -
 * it is what drains the outbox on reconnect - and it travels all the way to
 * React through `useChat()`. It has never been rendered. So a person whose
 * network dropped saw messages stop arriving and had nothing to tell them why,
 * which is the moment every messaging app they have used shows them a bar.
 *
 * This turns that signal into something a person can read, and adds the two
 * things it cannot know on its own.
 *
 * ## Three sources, because one is not enough
 *
 * **The browser** knows whether there is a network at all. `navigator.onLine`
 * is famously weak evidence of *internet* - a captive portal is "online" - but
 * it is conclusive in the negative direction, which is the one that matters:
 * false means there is definitely nothing.
 *
 * **The realtime channel** knows whether the server is actually reachable,
 * which is what catches the captive portal and the dead Wi-Fi that the browser
 * still calls online.
 *
 * **`navigator.connection`** knows the link is slow before anything has failed.
 * This is the "poor connection" case, and it is the only one of the three that
 * can be reported while everything is still technically working. Chrome and
 * Android only; absent elsewhere, and its absence simply means this state never
 * fires rather than being wrong.
 */
export type ConnectionQuality = 'good' | 'poor' | 'connecting' | 'offline';

/** What `navigator.connection` offers, where it exists at all. */
interface NetworkInformationLike extends EventTarget {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
}

function networkInfo(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

/**
 * A link that is working but barely.
 *
 * `effectiveType` is the browser's own rolling estimate and is the right first
 * answer. The round-trip fallback is for the case it reports `3g` or better
 * while the actual latency is dire - which is what a congested cell or a
 * distant hotspot looks like, and is exactly when somebody most wants to be
 * told the app is not broken.
 */
function linkIsPoor(): boolean {
  const info = networkInfo();
  if (!info) return false;
  if (info.effectiveType === 'slow-2g' || info.effectiveType === '2g') return true;
  return typeof info.rtt === 'number' && info.rtt >= 500;
}

/**
 * How long a bad state must hold before it is worth saying.
 *
 * Realtime reconnects constantly and briefly - a tab waking, a token
 * refreshing, a handover between cells - and a bar that appears for each of
 * those is worse than no bar at all, because it teaches people the app is
 * unreliable when it is doing its job. Nothing here is reported until it has
 * lasted long enough to be a real interruption.
 *
 * Losing the network entirely is exempt. There is no chance it is a blip worth
 * hiding, and the person is usually already reaching for their settings.
 */
const CONNECTING_DELAY_MS = 2_000;
const POOR_DELAY_MS = 4_000;

export function useConnectionStatus(): ConnectionQuality {
  const { connection } = useChat();
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [poorLink, setPoorLink] = useState(false);
  const [quality, setQuality] = useState<ConnectionQuality>('good');

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    const info = networkInfo();
    const read = () => setPoorLink(linkIsPoor());
    read();
    info?.addEventListener('change', read);
    return () => info?.removeEventListener('change', read);
  }, []);

  /*
   * The raw reading, before any patience is applied. Ordered by severity: no
   * network beats an unreachable server, which beats a slow link.
   */
  const raw: ConnectionQuality = !online
    ? 'offline'
    : connection === 'offline' || connection === 'connecting'
      ? 'connecting'
      : poorLink
        ? 'poor'
        : 'good';

  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);

    // Good news, and the total loss of a network, are both immediate.
    if (raw === 'good' || raw === 'offline') {
      setQuality(raw);
      return;
    }

    const delay = raw === 'connecting' ? CONNECTING_DELAY_MS : POOR_DELAY_MS;
    timer.current = window.setTimeout(() => setQuality(raw), delay);
    return () => window.clearTimeout(timer.current);
  }, [raw]);

  return quality;
}
