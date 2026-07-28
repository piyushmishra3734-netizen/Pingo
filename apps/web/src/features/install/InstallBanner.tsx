import { CloseIcon, cn } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { INSTALL_LABEL, useInstall } from './useInstall.js';

/**
 * "PINGO can live on your home screen."
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
 * ## It says what will actually happen
 *
 * Where the browser has a real install prompt, the button raises it. Where it
 * does not — every iPhone, and Firefox anywhere — the button goes to the
 * download page, which has the actual steps. A button labelled "Install" that
 * cannot install is worse than no button.
 */

const DISMISSED = 'pingo:install-dismissed';

/** What the banner promises, per platform. Specific, because vague is ignored. */
const BLURB: Record<string, string> = {
  android: 'Add PINGO to your home screen. Opens instantly, works offline.',
  ios: 'Add PINGO to your Home Screen from the Share menu.',
  windows: 'Install PINGO as a desktop app. Its own window, its own icon.',
  macos: 'Install PINGO as a desktop app. Its own window, its own icon.',
  other: 'Install PINGO for a faster, full-screen experience.',
};

export function InstallBanner() {
  const { platform, method, install } = useInstall();
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
    if (method === 'prompt') {
      void install().then((accepted) => {
        // Accepted means the app is installing and the banner has done its job.
        // Declined means they have now said no through the browser's own
        // dialog, which is a firmer no than the dismiss button.
        if (accepted) setDismissed(true);
        else dismiss();
      });
      return;
    }
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
        aria-label="Install PINGO"
        className={cn(
          'pointer-events-auto flex w-full max-w-md items-center gap-3',
          'glass-surface rounded-2xl px-3.5 py-3 shadow-lg',
          'motion-safe:animate-install-in',
        )}
      >
        <AppLogo size={40} alt="" className="shrink-0" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">Get the app</p>
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
          {/*
            The platform's own word. "Install for iPhone" on an iPhone reads as
            written for you; "Install PINGO" everywhere reads as a template.
          */}
          {INSTALL_LABEL[platform]}
        </button>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install banner"
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
