import { useEffect, useState, type ReactNode } from 'react';

import '../auth/paper.css';

import { usePushPermission } from '../notifications/usePushPermission.js';
import { askBackground, canAskBackground, isStrictMaker, openBackgroundSettings, useBackgroundStatus, type SettingsTarget } from './background.js';

/**
 * Asks, on Android, for the three things that let PINGO reach somebody who is
 * not looking at it: notifications, running in the background, and (on phones
 * that keep their own list) Autostart.
 *
 * On every launch until all of them are on - not once, not once a week. A phone
 * that has any of these off silently drops messages and calls, and the person
 * only finds out when somebody says "I messaged you". "Not now" closes it for
 * this launch only; the next one asks again. It never shows over the splash or
 * the update card (a few seconds' wait), and never twice in one launch.
 *
 * Notifications and the background choice are read from the phone, so they
 * tick themselves when the person comes back from the system. Autostart cannot
 * be read at all - each maker keeps it somewhere of its own - so it counts as
 * done once the person has opened that page and pressed Done.
 */

const DELAY = 4000;
const AUTOSTART_KEY = 'pingo:autostart-confirmed';

/** One ask per launch, however many times this mounts. */
let askedThisLaunch = false;

function autostartConfirmed(): boolean {
  try {
    return localStorage.getItem(AUTOSTART_KEY) === '1';
  } catch {
    return false;
  }
}

function confirmAutostart() {
  try {
    localStorage.setItem(AUTOSTART_KEY, '1');
  } catch {
    // Not kept: asked again next launch, which is harmless.
  }
}

/** Dev builds only: `?background-preview` shows it in a browser, as a Xiaomi phone with everything off. */
const PREVIEW = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('background-preview');

export function BackgroundPrompt() {
  const background = useBackgroundStatus();
  const push = usePushPermission();
  const [open, setOpen] = useState(false);
  const [autostartOpened, setAutostartOpened] = useState(false);
  const [confirmed, setConfirmed] = useState(autostartConfirmed);

  const native = PREVIEW || canAskBackground();
  const maker = PREVIEW ? 'xiaomi' : (background?.manufacturer ?? '');
  const strict = isStrictMaker(maker);
  const notificationsOff = PREVIEW || push.state === 'ask' || push.state === 'blocked';
  const backgroundOff = PREVIEW || (background !== undefined && !background.unrestricted);
  const autostartOff = strict && !confirmed;
  const anyOff = notificationsOff || backgroundOff || autostartOff;
  const known = PREVIEW || (background !== undefined && push.state !== 'checking');

  // After the wait, once per launch, and only if something is still off.
  useEffect(() => {
    if (!native || !known || askedThisLaunch || !anyOff) return undefined;
    const t = window.setTimeout(() => {
      askedThisLaunch = true;
      setOpen(true);
    }, DELAY);
    return () => window.clearTimeout(t);
    // The first complete answer decides; later changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, known]);

  // Everything is on (the person came back from Settings): nothing left to ask.
  useEffect(() => {
    if (open && known && !anyOff) setOpen(false);
  }, [open, known, anyOff]);

  if (!open || !native) return null;

  const name = maker ? maker.charAt(0).toUpperCase() + maker.slice(1) : 'your phone';

  const notifications = () => {
    if (push.state === 'blocked') void openBackgroundSettings('notifications');
    else void push.ask();
  };
  const visit = (target: SettingsTarget) => {
    if (target === 'autostart') setAutostartOpened(true);
    void openBackgroundSettings(target);
  };

  return (
    <div className="fixed inset-0 z-[890] flex items-end justify-center bg-black/45 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="bg-title">
      <style>{'@keyframes bg-rise { from { transform: translateY(28px); opacity: 0 } } @media (prefers-reduced-motion: reduce) { .bg-rise { animation: none !important } }'}</style>
      <div
        className="paper-ground bg-rise w-full max-w-md overflow-hidden rounded-t-[22px] px-5 pt-9 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[22px]"
        style={{ animation: 'bg-rise .42s cubic-bezier(.2,.8,.2,1)' }}
      >
        {/* A note taped to the page: the same paper as sign-in and calls. */}
        <div className="paper-note -rotate-[0.8deg] px-5 pt-7 pb-5">
          <span aria-hidden className="paper-tape -top-3 left-1/2 w-24 -translate-x-1/2 -rotate-3" />
          <p className="paper-hand text-[24px] leading-none">psst,</p>
          <h2 id="bg-title" className="mt-1.5 text-[25px] leading-tight font-bold tracking-[-0.01em] text-ink">
            Let PINGO <span className="paper-marker">reach you</span>
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
            With these off, {name === 'your phone' ? 'your phone' : `${name} phones`} quietly drop messages and calls. Turn each one on, then come back:
          </p>
          <ol className="mt-3 flex flex-col">
            <Go n="1" done={!notificationsOff} onClick={notifications}>
              Notifications: on
            </Go>
            <Go n="2" done={!backgroundOff} onClick={() => void askBackground()}>
              Run in the background: allow
            </Go>
            {strict && (
              <Go n="3" done={confirmed || autostartOpened} onClick={() => visit('autostart')}>
                Autostart: on
              </Go>
            )}
          </ol>
        </div>

        <button
          type="button"
          onClick={() => {
            if (strict && autostartOpened) {
              confirmAutostart();
              setConfirmed(true);
            }
            setOpen(false);
          }}
          className="focus-ring mt-7 h-12 w-full rounded-xl bg-ink text-[16px] font-semibold text-page shadow-[0_10px_20px_-12px_rgba(20,18,23,0.7)] active:scale-[0.98]"
        >
          Done
        </button>
        <button type="button" onClick={() => setOpen(false)} className="focus-ring mt-1.5 h-11 w-full rounded-xl text-[15px] font-medium text-text-secondary">
          Not now
        </button>
      </div>
    </div>
  );
}

/** A numbered line that does its thing when tapped, and is ticked once it is on. */
function Go({ n, done, onClick, children }: { n: string; done: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <li className="border-b border-dashed border-[var(--paper-doodle)] last:border-0">
      <button type="button" onClick={onClick} disabled={false} className="flex w-full items-center gap-3 py-3 text-left text-[15px] text-ink">
        <span aria-hidden className="paper-hand w-4 shrink-0 text-center text-[20px] leading-none">
          {done ? '✓' : n}
        </span>
        <span className={done ? 'flex-1 text-text-secondary line-through decoration-[#e0559b]/60' : 'flex-1 font-medium'}>{children}</span>
        <span className="shrink-0 text-[13px] font-semibold text-ink underline decoration-[var(--paper-marker)] decoration-[3px] underline-offset-4">
          {done ? 'Open again' : 'Open'}
        </span>
      </button>
    </li>
  );
}
