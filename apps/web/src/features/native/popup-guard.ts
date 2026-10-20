import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * While an embedded video page is on screen, the Android app refuses the
 * windows it tries to open (its ads). Off Android, or on a build without the
 * plugin, this does nothing: a browser has its own popup blocker.
 */
interface PopupGuardPlugin {
  setActive(options: { active: boolean }): Promise<void>;
}

const plugin = registerPlugin<PopupGuardPlugin>('PopupGuard');

export function setPopupGuard(active: boolean): void {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('PopupGuard')) return;
  void plugin.setActive({ active }).catch(() => undefined);
}
