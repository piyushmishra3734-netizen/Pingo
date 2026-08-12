import { CloseIcon, cn } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { useT } from '../i18n/useT.js';
import { isNative } from '../native/shell.js';
import { useInstall } from './useInstall.js';

/**
 * "PINGO is becoming a real app."
 *
 * ## Home only, and above the dock
 *
 * Sitting on every screen would make it furniture - the thing people learn to
 * look past, which is the fate of every banner that follows you. Home is where
 * somebody arrives, and it is the one screen where an offer is not interrupting
 * something.
 *
 * ## Dismissal lasts for the visit, not forever
 *
 * Closing it hides it until the page is reloaded, then it returns. That is a
 * deliberate product choice: PINGO has native apps on the way and this is the
 * only place that says so, and a banner dismissed once and never seen again is
 * a launch announcement most people would miss entirely.
 *
 * It is held in component state rather than storage, which is what makes a
 * refresh bring it back - there is nothing to remember and nothing to clear.
 * The cost is real and worth naming: somebody who closes it every session will
 * keep seeing it. That is the trade being made on purpose.
 *
 * ## It never raises the browser's install prompt
 *
 * It used to, and that was wrong. PINGO is not a Progressive Web App and does
 * not want to be saved as a shortcut, the Android and iOS builds are real
 * store applications. Offering "Add to Home Screen" would teach people to
 * install the thing PINGO is deliberately not.
 *
 * So the banner is an announcement rather than an installer: it says the app is
 * coming to the store for this platform, and the button opens the page that
 * explains where things stand.
 */

export function InstallBanner() {
  const t = useT();
  const { platform, method } = useInstall();
  const navigate = useNavigate();

  const [dismissed, setDismissed] = useState(false);

  /*
   * Never inside the app itself.
   *
   * The banner announces that native apps are coming. Showing it to somebody
   * already reading it *in* the Android app would be absurd, and
   * `display-mode: standalone` does not reliably match in a Capacitor WebView  - 
   * so the platform is asked directly rather than inferred from a media query.
   */
  if (isNative() || dismissed || method === 'installed') return null;

  const blurbKey =
    platform === 'android'
      ? 'install.android'
      : platform === 'ios'
        ? 'install.ios'
        : platform === 'windows'
          ? 'install.windows'
          : platform === 'macos'
            ? 'install.macos'
            : 'install.other';

  const dismiss = () => setDismissed(true);

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
        aria-label={t('install.aria')}
        className={cn(
          'pointer-events-auto flex w-full max-w-md items-center gap-3',
          'glass-surface rounded-2xl px-3.5 py-3 shadow-lg',
          'motion-safe:animate-install-in',
        )}
      >
        <AppLogo size={40} alt="" className="shrink-0" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">{t('install.title')}</p>
          <p className="line-clamp-2 text-caption text-text-secondary">{t(blurbKey)}</p>
        </div>

        <button
          type="button"
          onClick={act}
          className={cn(
            'glass-press shrink-0 rounded-full px-4 py-2',
            'bg-brand-gradient text-caption font-medium text-on-brand',
            'focus-ring',
          )}
        >
          {t('install.learnMore')}
        </button>

        <button
          type="button"
          onClick={dismiss}
          aria-label={t('install.dismiss')}
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
