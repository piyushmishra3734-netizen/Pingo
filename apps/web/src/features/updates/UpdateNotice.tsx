/**
 * The operator's card: "here is what is new", and for some people "go get it".
 *
 * One image and one build number, published from Settings → Controlling. Who
 * sees it and for how long depends entirely on whether the person looking can
 * do anything about it — see `shouldShow` in `notice-rules.ts`, which is where
 * that decision lives and where it is tested.
 *
 * Everyone gets the card: the web, and every installed build. Only somebody on
 * an APK older than the published number gets it back after closing it, because
 * only they have something left to do.
 *
 * Deliberately not re-shown on resume. Switching to another app and back is not
 * "opening PINGO" in the sense that matters, and a card that reappears every
 * time somebody checks a message elsewhere is one people learn to hate.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';

import {
  loadUpdateNotice,
  updateNoticeUrl,
  type UpdateNoticeRow,
} from '../../lib/supabase/update-notice.js';
import { isBehind, shouldShow } from './notice-rules.js';

export function UpdateNotice() {
  const [row, setRow] = useState<UpdateNoticeRow | null>(null);
  const [behind, setBehind] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      /*
       * `getInfo` only exists in the native shell. In a browser there is no
       * build number to be behind — the page is whatever Cloudflare served a
       * moment ago — so the web is current by definition.
       */
      const native = Capacitor.isNativePlatform();
      const [info, notice] = await Promise.all([
        native ? App.getInfo().catch(() => null) : Promise.resolve(null),
        loadUpdateNotice(),
      ]);
      if (cancelled || !notice) return;

      const isOld = isBehind(info?.build, notice.min_build);
      if (!shouldShow(isOld, readSeen(), notice.updated_at)) return;

      setBehind(isOld);
      setRow(notice);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    setClosed(true);
    /*
     * Only recorded for people with nothing to do about it. Writing this for
     * somebody on an old build would turn the one card that has to keep asking
     * into one they can silence in a tap.
     */
    if (!behind) writeSeen(row?.updated_at);
  };

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
          onClick={close}
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

/**
 * The last notice this browser dismissed, by its `updated_at`.
 *
 * localStorage rather than the profile: the card is shown before sign-in too,
 * and "I already read this" is a fact about a device, not an account. It can
 * come back empty — a private window, cleared data, a reinstall — and the worst
 * that costs is seeing an announcement a second time.
 */
const SEEN_KEY = 'pingo:update_notice_seen';

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(updatedAt: string | undefined): void {
  if (!updatedAt) return;
  try {
    localStorage.setItem(SEEN_KEY, updatedAt);
  } catch {
    // Storage disabled. They will see it once more; nothing else breaks.
  }
}
