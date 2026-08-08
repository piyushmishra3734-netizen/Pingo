import { useChat } from '@pingo/core';
import { useEffect } from 'react';

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

    const wake = () => {
      /*
       * Rebuilding a socket costs a round trip, and these events arrive in
       * pairs - Capacitor's and the browser's, for the same resume. One second
       * of quiet is enough to collapse them without ever delaying a real one.
       */
      const now = Date.now();
      if (now - last < 1_000) return;
      last = now;

      service.reconnect();
      void refresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', wake);

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
        }),
      )
      .then((handle) => {
        detach = () => void handle.remove();
      })
      .catch(() => undefined);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', wake);
      detach?.();
    };
  }, [service, refresh]);
}
