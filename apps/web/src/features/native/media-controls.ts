import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * The phone's own player for a PINGO song: notification shade, lock screen,
 * Quick Settings, headphones. Android only, through `MusicService.java`.
 *
 * Chrome shows that player by itself from `navigator.mediaSession`, but the
 * app's WebView ignores the API, so in the app the song had no player outside
 * PINGO. Off Android (or on a build without the plugin) every call here does
 * nothing, and the browser's Media Session in `player.ts` covers it.
 */

export interface NowPlaying {
  title: string;
  artist: string;
  artwork: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  speed: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export type ControlAction = 'play' | 'pause' | 'next' | 'prev' | 'stop' | 'seek';

interface MediaControlsPlugin {
  update(options: NowPlaying): Promise<void>;
  clear(): Promise<void>;
  addListener(event: 'action', fn: (e: { action: ControlAction; positionMs?: number }) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<MediaControlsPlugin>('MediaControls');

const available = (): boolean => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('MediaControls');

let listening = false;

export function showNowPlaying(info: NowPlaying, onAction: (action: ControlAction, positionMs?: number) => void): void {
  if (!available()) return;
  if (!listening) {
    listening = true;
    void plugin.addListener('action', (e) => onAction(e.action, e.positionMs)).catch(() => { listening = false; });
  }
  void plugin.update(info).catch(() => undefined);
}

export function clearNowPlaying(): void {
  if (!available()) return;
  void plugin.clear().catch(() => undefined);
}
