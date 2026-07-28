import { useEffect, useState } from 'react';

/**
 * Whether PINGO can be installed here, and how.
 *
 * ## Why the platform is detected at all
 *
 * Installing is not one thing. Chrome on Android and Edge on Windows raise a
 * real prompt the page can trigger. Safari on iOS has no such API and never
 * will — installing there is a manual trip through the share sheet, and the
 * only useful thing a page can do is say so precisely. Firefox on desktop does
 * not install web apps at all.
 *
 * So "Install" is a different sentence on each platform, and a single button
 * that says "Install" everywhere is wrong in three of the five cases.
 *
 * ## User-agent sniffing, deliberately
 *
 * Feature detection is the better instinct and it cannot answer this question:
 * there is no capability that distinguishes "iPhone, where the user must use
 * the share sheet" from "Firefox, where installing is impossible". Both simply
 * lack `beforeinstallprompt`. The platform is the fact being asked about.
 */

export type Platform = 'android' | 'ios' | 'windows' | 'macos' | 'other';

export type InstallMethod =
  /** The browser will raise its own prompt; `install()` triggers it. */
  | 'prompt'
  /** No API. The user must be told the steps — see the download page. */
  | 'manual'
  /** Already running as an installed app. Nothing to offer. */
  | 'installed';

export interface InstallState {
  platform: Platform;
  method: InstallMethod;
  /** Raises the browser's prompt. Resolves true if the user accepted. */
  install: () => Promise<boolean>;
}

/**
 * The event Chromium fires when it decides a site is installable.
 *
 * Not in TypeScript's DOM library, because it is not a standard — which is
 * itself the reason `method` exists rather than the whole feature assuming it.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';

  const ua = navigator.userAgent;
  const platform = navigator.platform ?? '';

  if (/android/i.test(ua)) return 'android';

  /*
   * iPadOS reports itself as a Mac.
   *
   * Since iPadOS 13 the user agent is desktop Safari's, so an iPad is
   * indistinguishable from a MacBook by string alone — and telling an iPad user
   * to install from the Dock is nonsense. A touch-capable "Mac" is an iPad;
   * Apple does not make a touchscreen laptop.
   */
  const iPadPretendingToBeAMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/i.test(ua) || iPadPretendingToBeAMac) return 'ios';

  if (/mac/i.test(platform) || /mac os x/i.test(ua)) return 'macos';
  if (/win/i.test(platform) || /windows/i.test(ua)) return 'windows';

  return 'other';
}

/** True when the page is running as an installed app rather than in a tab. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own, non-standard, and the only signal iOS gives.
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

export function useInstall(): InstallState {
  const [platform] = useState(detectPlatform);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent>();
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      /*
       * Prevented, and kept.
       *
       * Chromium fires this instead of showing its own mini-infobar, and the
       * event is only usable once — letting it through means the browser shows
       * its own bar at the bottom of the screen and the page can never offer
       * installing again. Holding it is what lets the banner ask at a moment
       * that makes sense.
       */
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setDeferred(undefined);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const method: InstallMethod = installed ? 'installed' : deferred ? 'prompt' : 'manual';

  const install = async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // Spent either way: the event cannot be reused, and keeping it would leave
    // a button that silently does nothing the second time.
    setDeferred(undefined);
    return outcome === 'accepted';
  };

  return { platform, method, install };
}

/** What the button says, per platform. */
export const INSTALL_LABEL: Record<Platform, string> = {
  android: 'Install for Android',
  ios: 'Install for iPhone',
  windows: 'Download for Windows',
  macos: 'Download for macOS',
  other: 'Install PINGO',
};
