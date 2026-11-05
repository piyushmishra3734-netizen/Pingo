import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { APK_URL } from './update-link.js';

/**
 * Updating PINGO from inside PINGO.
 *
 * ## Why this exists
 *
 * An APK installed from outside a store has nothing to update it. The old flow
 * sent people to a web page, to find a button, to download a file, to find the
 * file, to open it - five places to give up. This does the same four things
 * where they are already looking: download it (with a progress bar), check it,
 * ask Android to install it, and say what Android is about to ask.
 *
 * ## Where the bytes come from, and what it costs
 *
 * Not from Supabase, at any point. The description of the latest build is a
 * small JSON file and the APK is the file itself, both served by the download
 * Worker from Cloudflare R2 (`workers/download`). R2 does not charge for
 * downloads and none of it touches the database, so an update that every phone
 * pulls (60+ MB each) adds nothing to Supabase's egress.
 *
 * ## What Android still insists on
 *
 * The person has to confirm the install, and the first time they have to allow
 * PINGO to install apps ("Install unknown apps"). Neither can be skipped by any
 * app, only explained, which is what the permission stage is for.
 */

/** What the download Worker says the newest build is: `latest.json`, written by the release script. */
export interface LatestBuild {
  /** Android's versionCode; a phone below this is behind. */
  versionCode: number;
  /** What people read: "2.26.44.4". */
  versionName: string;
  /** Size of the APK, for the progress bar and the "62 MB" line. */
  bytes: number;
  /** SHA-256 of the APK, hex. The download is checked against it before Android is asked to install it. */
  sha256: string;
  /** A few plain lines on what changed. */
  notes: string[];
}

const LATEST_URL = 'https://download.pingochat.xyz/latest.json';

/** Read as untrusted: only a well-formed file is believed, and everything is clipped. */
export function parseLatest(raw: unknown): LatestBuild | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const code = typeof o.versionCode === 'number' ? Math.trunc(o.versionCode) : 0;
  const name = typeof o.versionName === 'string' ? o.versionName.trim().slice(0, 24) : '';
  if (code <= 0 || !/^[0-9][0-9.]*$/.test(name)) return null;
  const bytes = typeof o.bytes === 'number' && o.bytes > 0 ? Math.trunc(o.bytes) : 0;
  const sha256 = typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(o.sha256) ? o.sha256.toLowerCase() : '';
  const notes = Array.isArray(o.notes)
    ? o.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).slice(0, 4).map((n) => n.trim().slice(0, 90))
    : [];
  return { versionCode: code, versionName: name, bytes, sha256, notes };
}

/** The newest build, or null when it cannot be read - callers carry on as they did before. */
export async function loadLatest(): Promise<LatestBuild | null> {
  try {
    const response = await fetch(LATEST_URL, { cache: 'no-cache' });
    if (!response.ok) return null;
    return parseLatest(await response.json());
  } catch {
    return null;
  }
}

/** "62 MB". One decimal under 10, none above. */
export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/* -------------------------------------------------------------------------- */
/*  The native side (AppUpdatePlugin.java)                                    */
/* -------------------------------------------------------------------------- */

interface AppUpdatePlugin {
  /** Downloads to the app's own cache, resuming a partial file, and checks the SHA-256. */
  download(options: { url: string; sha256?: string; bytes?: number }): Promise<{ bytes: number }>;
  cancel(): Promise<void>;
  /** Whether Android lets PINGO install apps yet. */
  canInstall(): Promise<{ allowed: boolean }>;
  /** Opens Android's "Install unknown apps" page for PINGO. */
  openInstallSettings(): Promise<void>;
  /** Hands the downloaded file to Android's installer. */
  install(): Promise<void>;
  addListener(event: 'progress', listener: (progress: { received: number; total: number }) => void): Promise<PluginListenerHandle>;
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

/** True only in an installed build that has the plugin; anywhere else the flow falls back to the browser. */
export function inAppUpdateAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AppUpdate');
}

/* -------------------------------------------------------------------------- */
/*  The state a card shows                                                    */
/* -------------------------------------------------------------------------- */

export type UpdateStage =
  | { kind: 'ready' }
  | { kind: 'downloading'; received: number; total: number }
  /** Downloaded and checked; Android's installer is next. */
  | { kind: 'install' }
  /** Android has not yet been told it may install apps from PINGO. */
  | { kind: 'permission' }
  | { kind: 'error'; message: string };

export interface AppUpdate {
  stage: UpdateStage;
  /** True when this update happens inside the app; false means a button hands off to the browser. */
  inApp: boolean;
  start: () => void;
  install: () => void;
  allow: () => void;
  cancel: () => void;
}

function sayError(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/sha|checksum|verify/i.test(text)) return 'The download did not match, so it was not installed. Please try again.';
  if (/space|storage|ENOSPC/i.test(text)) return 'Not enough free space on this phone. Free up some and try again.';
  if (/network|connect|timeout|host|socket|offline/i.test(text)) return 'The connection dropped. Check your internet and try again.';
  return 'The update could not finish. Please try again.';
}

/**
 * Runs an update: tap, one permission the first time, download with progress,
 * Android's installer.
 *
 * The permission comes FIRST. Asking after a 60 MB download means somebody
 * waits through it and is then told they could not have installed it yet; asked
 * before, the first tap goes straight to the one Android page that matters (it
 * opens on PINGO's own switch, not on a list of every app) and, when they come
 * back, the download simply starts. Nothing to tap twice.
 *
 * `previewStage` is for looking at a card without a phone - dev builds only,
 * `?update-preview=progress` - and shows that stage with no native calls.
 */
export function useAppUpdate(latest: LatestBuild | null | undefined, previewStage?: UpdateStage['kind']): AppUpdate {
  const inApp = inAppUpdateAvailable();
  const [stage, setStage] = useState<UpdateStage>(() => previewInitial(previewStage, latest));
  const running = useRef(false);
  const startRef = useRef<() => void>(() => undefined);
  const lastPct = useRef(-1);

  const install = useCallback(() => {
    if (!inApp) return;
    void AppUpdate.install().catch((e: unknown) => setStage({ kind: 'error', message: sayError(e) }));
  }, [inApp]);

  const start = useCallback(() => {
    if (previewStage) return;
    // No in-app updater here (a browser, or a build without the plugin): the file itself, in the browser.
    if (!inApp) {
      window.location.href = APK_URL;
      return;
    }
    if (running.current) return;
    running.current = true;
    lastPct.current = -1;
    let listener: PluginListenerHandle | undefined;
    void (async () => {
      try {
        // Before the download, not after it: see above.
        const { allowed } = await AppUpdate.canInstall();
        if (!allowed) {
          setStage({ kind: 'permission' });
          return;
        }
        setStage({ kind: 'downloading', received: 0, total: latest?.bytes ?? 0 });
        listener = await AppUpdate.addListener('progress', (p) => {
          // Several a second is more than a bar can show; repaint when the percentage moves.
          const total = p.total || latest?.bytes || 0;
          const pct = total > 0 ? Math.floor((p.received / total) * 100) : 0;
          if (pct === lastPct.current) return;
          lastPct.current = pct;
          setStage({ kind: 'downloading', received: p.received, total });
        });
        await AppUpdate.download({ url: APK_URL, ...(latest?.sha256 ? { sha256: latest.sha256 } : {}), ...(latest?.bytes ? { bytes: latest.bytes } : {}) });
        setStage({ kind: 'install' });
        await AppUpdate.install();
      } catch (e) {
        setStage({ kind: 'error', message: sayError(e) });
      } finally {
        running.current = false;
        void listener?.remove();
      }
    })();
  }, [inApp, latest?.bytes, latest?.sha256, previewStage]);
  startRef.current = start;

  // Back from Android's settings page: if installs are allowed now, carry straight on.
  useEffect(() => {
    if (!inApp) return;
    let handle: PluginListenerHandle | undefined;
    void App.addListener('resume', () => {
      setStage((s) => {
        if (s.kind === 'permission') queueMicrotask(() => startRef.current());
        return s;
      });
    }).then((h) => {
      handle = h;
    });
    return () => void handle?.remove();
  }, [inApp]);

  const allow = useCallback(() => {
    if (!inApp) return;
    void AppUpdate.openInstallSettings();
  }, [inApp]);

  const cancel = useCallback(() => {
    if (!inApp) return;
    void AppUpdate.cancel().catch(() => undefined);
    running.current = false;
    setStage({ kind: 'ready' });
  }, [inApp]);

  return { stage, inApp, start, install, allow, cancel };
}

function previewInitial(kind: UpdateStage['kind'] | undefined, latest: LatestBuild | null | undefined): UpdateStage {
  switch (kind) {
    case 'downloading':
      return { kind: 'downloading', received: (latest?.bytes || 65_039_316) * 0.42, total: latest?.bytes || 65_039_316 };
    case 'install':
      return { kind: 'install' };
    case 'permission':
      return { kind: 'permission' };
    case 'error':
      return { kind: 'error', message: 'The connection dropped. Check your internet and try again.' };
    default:
      return { kind: 'ready' };
  }
}
