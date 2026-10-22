import { useCallback, useEffect, useState } from 'react';

import { webPushConfigured, webPushSupported } from '../../lib/firebase/web-push.js';
import { isNative } from '../native/shell.js';

/**
 * Whether this device will show PINGO's notifications, and the way to ask.
 *
 *   granted      nothing to do
 *   ask          never asked, or asked and ignored: a tap can raise the dialog
 *   blocked      refused earlier; the system will not ask again, only Settings can
 *   unsupported  this browser or build cannot be pushed to at all
 *
 * Checked again whenever the app comes back to the front, so turning them on in
 * Settings and returning is noticed without a reload.
 */
export type PushPermission = 'checking' | 'granted' | 'ask' | 'blocked' | 'unsupported';

/** Fired once permission is granted, so push registration can run now instead of at next launch. */
export const PUSH_ALLOWED = 'pingo:push-allowed';

async function current(): Promise<PushPermission> {
  if (isNative()) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const { receive } = await PushNotifications.checkPermissions();
      return receive === 'granted' ? 'granted' : receive === 'denied' ? 'blocked' : 'ask';
    } catch {
      return 'unsupported';
    }
  }
  if (!webPushSupported() || !webPushConfigured()) return 'unsupported';
  return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'blocked' : 'ask';
}

export function usePushPermission(): { state: PushPermission; ask: () => Promise<void> } {
  const [state, setState] = useState<PushPermission>('checking');

  const refresh = useCallback(() => void current().then(setState), []);
  useEffect(() => {
    refresh();
    const visible = () => !document.hidden && refresh();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const ask = useCallback(async () => {
    try {
      if (isNative()) {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        await PushNotifications.requestPermissions();
      } else if ('Notification' in window) {
        await Notification.requestPermission();
      }
    } finally {
      const next = await current();
      setState(next);
      if (next === 'granted') window.dispatchEvent(new Event(PUSH_ALLOWED));
    }
  }, []);

  return { state, ask };
}
