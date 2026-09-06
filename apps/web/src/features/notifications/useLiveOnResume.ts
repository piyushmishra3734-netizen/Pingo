import { useChat } from '@pingo/core';
import { useEffect } from 'react';

/**
 * How long away counts as having missed something.
 *
 * Below this, the socket is still alive and nothing was queued for this device,
 * so waking costs a torn-down connection and a nine-query rebuild to learn
 * nothing. Above it, the app may well have been backgrounded and the socket
 * closed underneath it, which is what this hook is for.
 */
const AWAY_MS = 10_000;

/**
 * Coming back to the app makes it live again.
 *
 * ## What goes wrong without it
 *
 * A backgrounded WebView has its socket closed by the operating system, and it
 * is closed without the client being told. The realtime channel still believes
 * it is subscribed, so nothing attempts a reconnect - and messages simply stop
 * arriving. The app looks fine: the conversation list is there, the last
 * messages are there, and everything is exactly as stale as the moment the
 * phone was locked. That is the "it does not work in real time in the
 * background" report, and the giveaway is that pulling any screen that
 * refetches makes a dozen messages appear at once.
 *
 * ## Two signals, because neither alone is enough
 *
 * `visibilitychange` is what the web gives us and it fires reliably in a
 * browser tab. Inside the Android shell it is less dependable - the WebView can
 * stay "visible" while the activity is stopped - so Capacitor's own app-state
 * event is used as well where it exists. Both funnel into the same work, and
 * doing it twice is harmless.
 *
 * ## Why it refetches as well as reconnecting
 *
 * A reconnected channel only carries what happens *next*. Anything sent while
 * the socket was dead was never delivered to this device and never will be, so
 * the reconnect has to be paired with a read - otherwise the gap stays a gap
 * until something else happens to reload.
 */
export function useLiveOnResume(): void {
  const { service, refresh } = useChat();

  useEffect(() => {
    let last = 0;
    /** When this app last stopped being watched, or undefined while it is. */
    let awaySince: number | undefined;

    const markAway = () => {
      awaySince ??= Date.now();
    };

    const wake = () => {
      /*
       * Rebuilding a socket costs a round trip, and these events arrive in
       * pairs - Capacitor's and the browser's, for the same resume. One second
       * of quiet is enough to collapse them without ever delaying a real one.
       */
      const now = Date.now();
      if (now - last < 1_000) return;

      /*
       * How long we were gone decides whether any of this is worth doing, and
       * this is the fix for the account reaching 96% of its egress cap.
       *
       * `focus` fires every time the window is clicked back into - alt-tabbing
       * to a browser and back, moving between two windows, answering a
       * notification. Each one tore down a healthy socket and ran the
       * nine-query list rebuild. Traced from the live app: `offline` followed
       * by `connected` 137 ms later, with `listConversations` behind it, on an
       * account doing 925 of those rebuilds an hour from four clients.
       *
       * A glance away missed nothing. Ten seconds of quiet is far shorter than
       * a locked phone or a backgrounded app - which is the case this hook
       * exists for, and which is untouched - and far longer than clicking
       * between windows.
       */
      const away = awaySince === undefined ? Infinity : now - awaySince;
      awaySince = undefined;
      if (away < AWAY_MS) return;

      last = now;

      service.reconnect();
      void refresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
      else markAway();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', wake);
    window.addEventListener('blur', markAway);

    /*
     * Loaded on demand so the browser build never pulls the plugin in. It
     * resolves to a stub off-device, which is why the failure is ignored
     * rather than reported.
     */
    let detach: (() => void) | undefined;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) wake();
          else markAway();
        }),
      )
      .then((handle) => {
        detach = () => void handle.remove();
      })
      .catch(() => undefined);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', wake);
      window.removeEventListener('blur', markAway);
      detach?.();
    };
  }, [service, refresh]);
}
