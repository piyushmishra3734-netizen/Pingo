import { useEffect, useRef, useState, type ReactNode } from 'react';

import '../auth/paper.css';

import { askBackground, isStrictMaker, openBackgroundSettings, useBackgroundStatus, type SettingsTarget } from './background.js';

/**
 * Asks, on Android, to let PINGO keep running in the background.
 *
 * Once at first, a few seconds after the app opens so it never lands on top
 * of the splash or the update card, and again a week after a "Not now". The
 * system's own dialog does the actual granting; this only says why, so the
 * person is not handed a bare "allow this app to run in the background?" with
 * no reason given.
 *
 * On phones that stop apps beyond what Android asks (Xiaomi, Oppo, Vivo and
 * the rest), a second step points at the app's settings for Autostart, since
 * the system dialog alone is not enough there.
 */

const KEY = 'pingo:background-asked';
const AGAIN_AFTER = 7 * 24 * 3600_000;
const DELAY = 4000;

function due(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY) || 0);
    return !at || Date.now() - at > AGAIN_AFTER;
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Not kept: asked again next launch, which is harmless.
  }
}

const maker = (m: string) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'this phone');

/** Dev builds only: `?background-preview` shows it in a browser, as a Xiaomi phone that has not allowed it. */
const PREVIEW = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('background-preview');

export function BackgroundPrompt() {
  const live = useBackgroundStatus();
  const [preview, setPreview] = useState(PREVIEW ? { unrestricted: false, manufacturer: 'xiaomi' } : undefined);
  const status = preview ?? live;
  const [step, setStep] = useState<'hidden' | 'ask' | 'waiting' | 'autostart'>('hidden');
  /** The status when the system dialog was opened: the answer is the next one read after it. */
  const askedWith = useRef<typeof status>(undefined);
  /** Which of the phone's own pages were opened from the second step, ticked off by hand. */
  const [visited, setVisited] = useState<Set<SettingsTarget>>(new Set());

  // First the wait, so it never shows over the splash or the update card.
  useEffect(() => {
    if (!status || status.unrestricted || step !== 'hidden' || (!PREVIEW && !due())) return undefined;
    const t = window.setTimeout(() => setStep('ask'), DELAY);
    return () => window.clearTimeout(t);
    // Only on the first answer; later changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === undefined]);

  // Back from the system dialog: allowed, or not.
  useEffect(() => {
    if (step !== 'waiting' || !status || status === askedWith.current) return;
    if (status.unrestricted) setStep(isStrictMaker(status.manufacturer) ? 'autostart' : 'hidden');
    else setStep('hidden');
  }, [status, step]);

  if (step === 'hidden' || step === 'waiting' || !status) return null;

  const close = () => {
    remember();
    setStep('hidden');
  };

  const name = maker(status.manufacturer);
  const visit = (target: SettingsTarget) => {
    setVisited((v) => new Set(v).add(target));
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
          {step === 'ask' ? (
            <>
              <p className="paper-hand text-[24px] leading-none">psst,</p>
              <h2 id="bg-title" className="mt-1.5 text-[25px] leading-tight font-bold tracking-[-0.01em] text-ink">
                Keep PINGO <span className="paper-marker">running</span>
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
                Your phone pauses apps it thinks you are not using. Let PINGO stay awake in the background, and:
              </p>
              <ol className="mt-3.5 flex flex-col gap-2">
                <Line n="1">messages arrive on time</Line>
                <Line n="2">calls ring even when PINGO is closed</Line>
                <Line n="3">music keeps playing with the screen off</Line>
              </ol>
            </>
          ) : (
            <>
              <p className="paper-hand text-[24px] leading-none">one more thing,</p>
              <h2 id="bg-title" className="mt-1.5 text-[25px] leading-tight font-bold tracking-[-0.01em] text-ink">
                On {name}, turn on <span className="paper-marker">Autostart</span>
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">{name} phones stop apps on their own, even after Android says yes. Tap each one, switch it on, and come back:</p>
              <ol className="mt-3 flex flex-col">
                <Go n="1" done={visited.has('autostart')} onClick={() => visit('autostart')}>
                  Autostart: on
                </Go>
                <Go n="2" done={visited.has('battery')} onClick={() => visit('battery')}>
                  Battery: No restrictions
                </Go>
              </ol>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (step === 'ask') {
              remember();
              askedWith.current = status;
              setStep('waiting');
              if (PREVIEW) setPreview({ unrestricted: true, manufacturer: 'xiaomi' });
              else void askBackground();
            } else {
              close();
            }
          }}
          className="focus-ring mt-7 h-12 w-full rounded-xl bg-ink text-[16px] font-semibold text-page shadow-[0_10px_20px_-12px_rgba(20,18,23,0.7)] active:scale-[0.98]"
        >
          {step === 'ask' ? 'Allow' : 'Done'}
        </button>
        {step === 'ask' && (
          <button type="button" onClick={close} className="focus-ring mt-1.5 h-11 w-full rounded-xl text-[15px] font-medium text-text-secondary">
            Not now
          </button>
        )}
      </div>
    </div>
  );
}

/** A numbered line, the number written by hand. */
function Line({ n, children }: { n: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 text-[15px] text-ink">
      <span aria-hidden className="paper-hand w-4 shrink-0 text-center text-[20px] leading-none">
        {n}
      </span>
      {children}
    </li>
  );
}

/** A line that opens the phone's exact settings page for it, and is ticked once it has been. */
function Go({ n, done, onClick, children }: { n: string; done: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <li className="border-b border-dashed border-[var(--paper-doodle)] last:border-0">
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 py-3 text-left text-[15px] text-ink">
        <span aria-hidden className="paper-hand w-4 shrink-0 text-center text-[20px] leading-none">
          {done ? '\u2713' : n}
        </span>
        <span className={done ? 'flex-1 text-text-secondary line-through decoration-[#e0559b]/60' : 'flex-1 font-medium'}>{children}</span>
        <span className="shrink-0 text-[13px] font-semibold text-ink underline decoration-[var(--paper-marker)] decoration-[3px] underline-offset-4">
          {done ? 'Open again' : 'Open'}
        </span>
      </button>
    </li>
  );
}
