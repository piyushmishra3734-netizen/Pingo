/**
 * "There is a newer PINGO than the one you are holding."
 *
 * The operator publishes an image and the build number it applies to, from
 * Settings → Controlling. Every device running an older build sees the image
 * on launch; every device already on the new build never fetches it.
 *
 * ## Why the cross does not remember
 *
 * The whole point of this card is that it keeps coming back. A sideloaded APK
 * has no store behind it — nothing will ever update it on the user's behalf, so
 * a notice they can dismiss permanently is a notice they will dismiss once and
 * then stay a year behind. Closing it clears it for this launch only; the next
 * cold start shows it again, and it stops appearing the moment the build number
 * on the device catches up. Nothing is written down, which is also why there is
 * no state to migrate when a notice is replaced.
 *
 * Deliberately not re-shown on resume. Switching to another app and back is not
 * "opening PINGO" in the sense that matters, and a card that reappears every
 * time somebody checks a message in another app is one people learn to hate.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';

import {
  loadUpdateNotice,
  updateNoticeUrl,
  type UpdateNoticeRow,
} from '../../lib/supabase/update-notice.js';
import { isBehind } from './is-behind.js';

export function UpdateNotice() {
  const [row, setRow] = useState<UpdateNoticeRow | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    /*
     * Native only. The web app is whatever Cloudflare served a moment ago, so
     * a browser is current by definition and has nothing to be told.
     */
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    void (async () => {
      const [info, notice] = await Promise.all([
        App.getInfo().catch(() => null),
        loadUpdateNotice(),
      ]);
      if (cancelled || !notice || !info) return;

      if (!isBehind(info.build, notice.min_build)) return;

      setRow(notice);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!row || closed) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Update available"
    >
      <div className="relative max-h-full w-full max-w-sm">
        <img
          src={updateNoticeUrl(row)}
          alt="What is new in this update"
          className="max-h-[80vh] w-full rounded-lg object-contain shadow-lg"
          /*
           * A notice nobody can read is worse than no notice: if the image
           * fails to load there is nothing left but a black screen with a
           * cross, so the card takes itself down instead.
           */
          onError={() => setClosed(true)}
        />
        <button
          type="button"
          onClick={() => setClosed(true)}
          aria-label="Close"
          className="absolute -right-2 -top-2 grid h-9 w-9 place-items-center rounded-full bg-surface text-ink shadow-md active:scale-95"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
