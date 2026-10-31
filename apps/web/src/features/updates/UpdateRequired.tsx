import { Capacitor } from '@capacitor/core';
import { ArrowDownToLine, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AppLogo } from '../../components/AppLogo.js';
import { publicAppUrl } from '../../lib/public-origin.js';
import { isUpdateRequired, onUpdateRequired } from '../../lib/update-required.js';

/**
 * "A new version is out, and this one is outdated" - over everything, with no
 * way past it but updating.
 *
 * Shown when the database refuses this build (`PINGO_UPDATE_REQUIRED`, see
 * `lib/update-required.ts`). Nothing works underneath by then, so the honest
 * screen is one that says so and offers the one thing that helps, rather than a
 * chat list of errors.
 *
 * The app goes to the download page in the phone's browser; a web page has
 * nothing to download, and only needs to load its new version.
 */
export function UpdateRequired() {
  const [shown, setShown] = useState(isUpdateRequired);
  useEffect(() => onUpdateRequired(() => setShown(true)), []);
  if (!shown && !(import.meta.env.DEV && new URLSearchParams(location.search).has('update-required-preview'))) return null;

  const native = Capacitor.isNativePlatform();
  const downloadUrl = publicAppUrl('/download?update=1');

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-page px-6 text-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
      aria-describedby="update-required-body"
    >
      <div className="relative grid place-items-center">
        <span aria-hidden className="bg-sweep absolute size-32 rounded-full opacity-25 blur-2xl" />
        <AppLogo size={84} tile alt="" className="relative" />
      </div>
      <p className="mt-6 rounded-full bg-brand/10 px-3 py-1 text-[12.5px] font-semibold tracking-[0.04em] text-brand uppercase">Update required</p>
      <h1 id="update-required-title" className="mt-3 max-w-xs text-[26px] font-extrabold leading-tight text-ink">
        A new version of PINGO is here
      </h1>
      <p id="update-required-body" className="mt-3 max-w-xs text-[15.5px] leading-relaxed text-text-secondary">
        You are using an outdated version that no longer works. Update to keep chatting - your chats, photos and account stay
        as they are.
      </p>
      <div className="mt-8 w-full max-w-xs">
        {native ? (
          <a
            href={downloadUrl}
            className="focus-ring bg-sweep flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(139,93,255,0.65)] active:scale-[0.98]"
          >
            <ArrowDownToLine size={19} aria-hidden />
            Update now
          </a>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="focus-ring bg-sweep flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(139,93,255,0.65)] active:scale-[0.98]"
          >
            <RotateCw size={19} aria-hidden />
            Load the new version
          </button>
        )}
        {native && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener"
            className="focus-ring mt-3 block truncate text-[13px] font-medium text-brand underline underline-offset-2"
          >
            {downloadUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}
          </a>
        )}
      </div>
    </div>
  );
}
