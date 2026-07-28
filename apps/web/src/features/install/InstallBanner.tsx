import { CloseIcon, cn } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { useInstall } from './useInstall.js';

/**
 * "PINGO is becoming a real app."
 *
 * ## Home only, and above the dock
 *
 * Sitting on every screen would make it furniture — the thing people learn to
 * look past, which is the fate of every banner that follows you. Home is where
 * somebody arrives, and it is the one screen where an offer is not interrupting
 * something.
 *
 * ## Dismissal is permanent, and that is the point
 *
 * Stored in `localStorage`, not in state: a banner that returns on the next
 * visit is a banner that was never really dismissed, and asking twice after
 * being told no is the behaviour that makes people distrust an app. Once is an
 * offer. Twice is nagging.
 *
 * The one thing that legitimately brings it back is uninstalling and returning
 * later, which clears site data anyway.
 *
 * ## It never raises the browser's install prompt
 *
 * It used to, and that was wrong. PINGO is not a Progressive Web App and does
 * not want to be saved as a shortcut — the Android and iOS builds are real
 * store applications. Offering "Add to Home Screen" would teach people to
 * install the thing PINGO is deliberately not.
 *
 * So the banner is an announcement rather than an installer: it says the app is
 * coming to the store for this platform, and the button opens the page that
 * explains where things stand.
 */

const DISMISSED = 'pingo:install-dismissed';

/** What the banner promises, per platform. Specific, because vague is ignored. */
const BLURB: Record<string, string> = {
  android: 'The Android app is on its way to the Play Store.',
  ios: 'The iPhone app is on its way to the App Store.',
  windows: 'A desktop app for Windows is in development.',
  macos: 'A desktop app for macOS is in development.',
  other: 'Native apps for every platform are in development.',
};

export function InstallBanner() {
  const { platform, method } = useInstall();
  const navigate = useNavigate();

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === '1';
    } catch {
      // Private browsing can refuse storage. Showing the banner is the safer
      // failure: an extra offer beats a feature nobody can discover.
      return false;
    }
  });

  // Nothing to offer someone who has already installed it, and nothing to say
  // to someone who has said no.
  if (dismissed || method === 'installed') return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Dismissed for this session at least. See above.
    }
  };

  const act = () => {
    navigate('/download');
  };

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-150 flex justify-center px-4',
        // Clears the floating dock rather than sitting under it.
        'bottom-[calc(6.25rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div
        role="region"
        aria-label="PINGO native apps"
        className={cn(
          'pointer-events-auto flex w-full max-w-md items-center gap-3',
          'glass-surface rounded-2xl px-3.5 py-3 shadow-lg',
          'motion-safe:animate-install-in',
        )}
      >
        <AppLogo size={40} alt="" className="shrink-0" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">PINGO is becoming an app</p>
          <p className="line-clamp-2 text-caption text-text-secondary">
            {BLURB[platform] ?? BLURB.other}
          </p>
        </div>

        <button
          type="button"
          onClick={act}
          className={cn(
            'glass-press shrink-0 rounded-full px-4 py-2',
            'bg-brand-gradient text-caption font-medium text-white',
            'focus-ring',
          )}
        >
          Learn more
        </button>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className={cn(
            'shrink-0 rounded-full p-1.5 text-text-tertiary',
            'transition-colors duration-quick ease-standard hover:bg-hover hover:text-ink',
            'focus-ring touch-target',
          )}
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
