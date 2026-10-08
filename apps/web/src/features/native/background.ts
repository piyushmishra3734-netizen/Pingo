import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect, useState } from 'react';

/**
 * Whether Android lets PINGO keep running once it leaves the screen, and the
 * way to ask. See `BackgroundPlugin.java` for why it matters.
 *
 * Android only. On the web and on iOS there is nothing to ask for, and every
 * call here answers "fine" rather than offering a button that does nothing.
 */

interface BackgroundPlugin {
  status(): Promise<{ unrestricted: boolean; manufacturer: string }>;
  request(): Promise<void>;
  openSettings(): Promise<void>;
}

const plugin = registerPlugin<BackgroundPlugin>('Background');

export const canAskBackground = (): boolean => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('Background');

export interface BackgroundStatus {
  /** Out of battery optimisation: free to run in the background. */
  unrestricted: boolean;
  manufacturer: string;
}

export async function backgroundStatus(): Promise<BackgroundStatus> {
  if (!canAskBackground()) return { unrestricted: true, manufacturer: '' };
  try {
    return await plugin.status();
  } catch {
    return { unrestricted: true, manufacturer: '' };
  }
}

/** Shows Android's own "let PINGO always run in the background?" dialog. */
export async function askBackground(): Promise<void> {
  if (!canAskBackground()) return;
  await plugin.request().catch(() => undefined);
}

/** The app's settings page, where battery and (on some phones) autostart live. */
export async function openBackgroundSettings(): Promise<void> {
  if (!canAskBackground()) return;
  await plugin.openSettings().catch(() => undefined);
}

/**
 * Phones that stop apps beyond what Android asks, and keep their own
 * "Autostart" or "background" switch in the app's settings. The system dialog
 * is not enough on these; the person has to turn that on as well.
 */
export const STRICT_MAKERS = ['xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'vivo', 'iqoo', 'oneplus', 'huawei', 'honor', 'infinix', 'tecno', 'itel'];
export const isStrictMaker = (m: string) => STRICT_MAKERS.some((x) => m.includes(x));

/**
 * The status, live. Checked again whenever PINGO comes back to the front,
 * since that is when somebody returns from the system dialog or settings.
 */
export function useBackgroundStatus(): BackgroundStatus | undefined {
  const [status, setStatus] = useState<BackgroundStatus>();
  useEffect(() => {
    let live = true;
    const check = () => void backgroundStatus().then((s) => live && setStatus(s));
    check();
    const sub = canAskBackground() ? App.addListener('resume', check) : undefined;
    return () => {
      live = false;
      void sub?.then((h) => h.remove());
    };
  }, []);
  return status;
}
