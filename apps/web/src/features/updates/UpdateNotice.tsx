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
import { ArrowDownToLine, MessagesSquare, Timer } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { AppLogo } from '../../components/AppLogo.js';
import { publicAppUrl } from '../../lib/public-origin.js';

import {
  loadUpdateNotice,
  updateNoticeUrl,
  type UpdateNoticeRow,
} from '../../lib/supabase/update-notice.js';
import { isBehind, shouldShow, versionName } from './notice-rules.js';

export function UpdateNotice() {
  const [row, setRow] = useState<UpdateNoticeRow | null>(null);
  const [behind, setBehind] = useState(false);
  const [closed, setClosed] = useState(false);

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
      const [info, notice] = await Promise.all([
        native ? App.getInfo().catch(() => null) : Promise.resolve(null),
        loadUpdateNotice(),
      ]);
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
    return (
      <UpdatePrompt
        version={versionName(row.min_build)}
        {...(row.storage_path ? { image: updateNoticeUrl(row) } : {})}
        onLater={close}
      />
    );
  }
  return <NoticeCard src={updateNoticeUrl(row)} onClose={close} />;
}

/**
 * "A new version is ready", for somebody on an APK that is behind.
 *
 * A sideloaded app has no store to update it, so this is the only thing that
 * ever will. It used to be the operator's picture with a cross and nothing to
 * press - the one person who had something to do was given no way to do it.
 *
 * Update opens the download page in the phone's browser: the address is on the
 * public site, so the app's web view hands it to Chrome instead of loading it,
 * and Chrome is what downloads and installs an APK. Later closes it for this
 * launch only; it is back next time, until the build on the phone is current.
 *
 * The operator's picture, when there is one, sits on top as the "what's new".
 */
export function UpdatePrompt({
  version,
  image,
  onLater,
}: {
  version: string | undefined;
  image?: string;
  onLater: () => void;
}) {
  const [picture, setPicture] = useState(image);

  const update = () => {
    window.location.href = publicAppUrl('/download?update=1');
  };

  return (
    <div
      className="fixed inset-0 z-[900] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-title"
    >
      <style>{'@keyframes up-rise { from { transform: translateY(24px); opacity: 0 } } @media (prefers-reduced-motion: reduce) { .up-rise { animation: none !important } }'}</style>
      <div
        className="up-rise w-full max-w-md overflow-hidden rounded-t-[28px] bg-surface shadow-[0_-8px_40px_rgba(16,17,20,0.18)] sm:rounded-[28px]"
        style={{ animation: 'up-rise .38s cubic-bezier(.2,.8,.2,1)' }}
      >
        {picture ? (
          <img
            src={picture}
            alt="What is new in this version"
            className="block max-h-56 w-full object-cover"
            // No picture is better than a broken one; the prompt stands on its own.
            onError={() => setPicture(undefined)}
          />
        ) : (
          <div className="relative grid place-items-center overflow-hidden pt-8 pb-2">
            <span aria-hidden className="bg-sweep absolute top-6 size-28 rounded-full opacity-25 blur-2xl" />
            <AppLogo size={72} tile alt="" className="relative" />
          </div>
        )}

        <div className="px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.06em] text-brand uppercase">
            New version{version && <span className="rounded-full bg-brand/10 px-2 py-0.5 tracking-normal normal-case tabular-nums">{version}</span>}
          </p>
          <h2 id="update-title" className="mt-1.5 text-[22px] leading-tight font-bold text-ink">
            Update PINGO
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
            A new version is ready on the download page. It installs over this one, so nothing is lost.
          </p>

          <ul className="mt-4 flex flex-col gap-2.5">
            <Fact icon={<MessagesSquare size={18} />}>Your chats, photos and account stay as they are</Fact>
            <Fact icon={<Timer size={18} />}>Takes about a minute</Fact>
          </ul>

          <button
            type="button"
            onClick={update}
            className="focus-ring bg-sweep mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white shadow-[0_6px_18px_rgba(139,93,255,0.35)] active:scale-[0.98]"
          >
            <ArrowDownToLine size={19} />
            Update now
          </button>
          <button
            type="button"
            onClick={onLater}
            className="focus-ring mt-2 h-11 w-full rounded-full text-[15px] font-medium text-text-secondary active:bg-sunken"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-[14px] text-ink">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-brand">
        {icon}
      </span>
      {children}
    </li>
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
