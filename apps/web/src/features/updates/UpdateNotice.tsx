/**
 * The operator's card: "here is what is new", and for some people "go get it".
 *
 * One image and one build number, published from Settings → Controlling. Who
 * sees it and for how long depends entirely on whether the person looking can
 * do anything about it — see `shouldShow` in `notice-rules.ts`, which is where
 * that decision lives and where it is tested.
 *
 * Everyone gets the card: the web, and every installed build. Only somebody on
 * an APK older than the published number gets it back after closing it - once
 * a day - because only they have something left to do.
 *
 * Deliberately not re-shown on resume. Switching to another app and back is not
 * "opening PINGO" in the sense that matters, and a card that reappears every
 * time somebody checks a message elsewhere is one people learn to hate.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';

import { publicAppUrl } from '../../lib/public-origin.js';
import { loadLatest, useAppUpdate, type LatestBuild, type UpdateStage } from './app-update.js';
import { UpdateCard } from './UpdateCard.js';

import {
  loadUpdateNotice,
  updateNoticeUrl,
  type UpdateNoticeRow,
} from '../../lib/supabase/update-notice.js';
import { isBehind, shouldShow, versionName } from './notice-rules.js';
import { UpdateRequired } from './UpdateRequired.js';

/**
 * Both update screens, mounted once: the blocking one for a build the server
 * has turned away (`UpdateRequired`), and the operator's notice.
 */
export function UpdateNotice() {
  return (
    <>
      <UpdateRequired />
      <Notice />
    </>
  );
}

function Notice() {
  const [row, setRow] = useState<UpdateNoticeRow | null>(null);
  const [behind, setBehind] = useState(false);
  const [closed, setClosed] = useState(false);
  // The newest build as Cloudflare describes it, when that is what found us behind.
  const [latest, setLatest] = useState<LatestBuild | null>(null);

  useEffect(() => {
    let cancelled = false;
    /*
     * A way to look at the prompt without an old phone: dev builds only, with
     * `?update-preview` on any page. It pretends to be one build behind.
     */
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('update-preview')) {
      setBehind(true);
      setRow({ storage_path: '', content_type: null, min_build: 2603801, updated_at: 'preview' });
      return;
    }
    void (async () => {
      /*
       * `getInfo` only exists in the native shell. In a browser there is no
       * build number to be behind — the page is whatever Cloudflare served a
       * moment ago — so the web is current by definition.
       */
      const native = Capacitor.isNativePlatform();
      const info = native ? await App.getInfo().catch(() => null) : null;

      /*
       * Cloudflare first, and the database only if that has nothing to say.
       *
       * The newest build is described by a small file next to the APK itself
       * (`app-update.ts`), so asking whether this phone is behind costs the
       * database nothing. When it is behind, that is the whole answer: no
       * request to Supabase at all. When it is not, or the file cannot be read,
       * everything below runs as it always did - it is still where the
       * operator's announcement card comes from.
       */
      const newest = native ? await loadLatest() : null;
      if (cancelled) return;
      if (newest && isBehind(info?.build, newest.versionCode)) {
        if (!shouldShow(true, readSeen(), 'latest', readPromptAt())) return;
        writePromptAt();
        setLatest(newest);
        setBehind(true);
        setRow({ storage_path: '', content_type: null, min_build: newest.versionCode, updated_at: 'latest' });
        return;
      }

      const notice = await loadUpdateNotice();
      if (cancelled || !notice) return;

      const isOld = isBehind(info?.build, notice.min_build);
      if (!shouldShow(isOld, readSeen(), notice.updated_at, readPromptAt())) return;
      if (isOld) writePromptAt();

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

  // Somebody who can act on it is asked to; everybody else is shown the news.
  if (behind) {
    return <UpdatePrompt version={latest?.versionName ?? versionName(row.min_build)} latest={latest} onLater={close} />;
  }
  // A text-only notice is for people who are behind; there is no news card to show anyone else.
  if (!row.storage_path) return null;
  return <NoticeCard src={updateNoticeUrl(row)} onClose={close} />;
}

/**
 * "A new version is ready", for somebody on an APK that is behind.
 *
 * A sideloaded app has no store to update it, so this is the only thing that
 * ever will. It is the profile's card - see `UpdateCard` - and in the Android
 * app it does the whole update on the spot: download with a progress bar, check
 * it, hand it to Android's installer (`app-update.ts`). Anywhere that cannot,
 * the button downloads the file in the browser as before. "Not now" closes it
 * for this launch only; it is back next time, until the build on the phone is
 * current.
 *
 * Dev only: `?update-preview` shows it, and `=progress`, `=install`,
 * `=permission` or `=error` show those stages.
 */
const DEMO: LatestBuild = {
  versionCode: 2604405,
  versionName: '2.26.44.5',
  bytes: 65_039_316,
  sha256: '',
  notes: ['PINGO Feedback: tell us what to build', 'The chat list opens faster', 'A calmer update screen'],
};

function previewStage(): UpdateStage['kind'] | undefined {
  if (!import.meta.env.DEV) return undefined;
  const params = new URLSearchParams(location.search);
  if (!params.has('update-preview')) return undefined;
  const value = params.get('update-preview');
  return value === 'progress' ? 'downloading' : value === 'install' || value === 'permission' || value === 'error' ? value : 'ready';
}

export function UpdatePrompt({
  version,
  latest,
  onLater,
}: {
  version: string | undefined;
  latest?: LatestBuild | null;
  onLater: () => void;
}) {
  const preview = previewStage();
  const build = latest ?? (preview ? DEMO : null);
  const update = useAppUpdate(build, preview);

  return (
    <UpdateCard
      mode="sheet"
      version={build?.versionName ?? version}
      bytes={build?.bytes}
      notes={build?.notes}
      stage={update.stage}
      inApp={update.inApp}
      onUpdate={update.start}
      onInstall={update.install}
      onAllow={update.allow}
      onCancel={update.cancel}
      onLater={onLater}
      fallbackHref={publicAppUrl('/download?update=1')}
    />
  );
}

/**
 * The card itself, with no idea whether anybody should be seeing it.
 *
 * Split out so Controlling can show exactly this rather than an impression of
 * it. A preview drawn from its own markup is a promise the real thing does not
 * have to keep: it drifts the first time one of them is touched, and the moment
 * it drifts it is worse than having no preview, because somebody trusts it.
 */
export function NoticeCard({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Update available"
    >
      <div className="relative max-h-full w-full max-w-sm">
        <img
          src={src}
          alt="What is new in this update"
          className="max-h-[80vh] w-full rounded-lg object-contain shadow-lg"
          /*
           * A notice nobody can read is worse than no notice: if the image
           * fails to load there is nothing left but a black screen with a
           * cross, so the card takes itself down instead.
           */
          onError={onClose}
        />
        <button
          type="button"
          onClick={onClose}
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
/** When somebody behind was last asked; see PROMPT_EVERY_MS. */
const PROMPT_KEY = 'pingo:update_prompt_at';

function readPromptAt(): number {
  try {
    return Number(localStorage.getItem(PROMPT_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writePromptAt(): void {
  try {
    localStorage.setItem(PROMPT_KEY, String(Date.now()));
  } catch {
    // Storage disabled: asked on every launch, as before.
  }
}

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
