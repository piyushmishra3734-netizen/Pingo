import { BatteryCharging, MessageCircle, Music2, PhoneCall } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { askBackground, isStrictMaker, openBackgroundSettings, useBackgroundStatus } from './background.js';

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

  return (
    <div className="fixed inset-0 z-[890] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="bg-title">
      <div className="w-full max-w-md overflow-hidden rounded-t-[28px] bg-surface shadow-[0_-8px_40px_rgba(16,17,20,0.18)] sm:rounded-[28px]" style={{ animation: 'up-rise .38s cubic-bezier(.2,.8,.2,1)' }}>
        <style>{'@keyframes up-rise { from { transform: translateY(24px); opacity: 0 } }'}</style>
        <div className="px-6 pt-7 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand/10 text-brand">
            <BatteryCharging size={28} />
          </span>
          {step === 'ask' ? (
            <>
              <h2 id="bg-title" className="mt-4 text-[22px] leading-tight font-bold text-ink">
                Keep PINGO running
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
                Your phone pauses apps it thinks you are not using. Let PINGO run in the background so nothing waits for you to open it.
              </p>
              <ul className="mt-4 flex flex-col gap-2.5">
                <Fact icon={<MessageCircle size={18} />}>Messages arrive on time</Fact>
                <Fact icon={<PhoneCall size={18} />}>Calls ring even when PINGO is closed</Fact>
                <Fact icon={<Music2 size={18} />}>Music keeps playing with the screen off</Fact>
              </ul>
              <button
                type="button"
                onClick={() => {
                  remember();
                  askedWith.current = status;
                  setStep('waiting');
                  if (PREVIEW) setPreview({ unrestricted: true, manufacturer: 'xiaomi' });
                  else void askBackground();
                }}
                className="focus-ring bg-sweep mt-6 flex h-12 w-full items-center justify-center rounded-full text-[16px] font-semibold text-white shadow-[0_6px_18px_rgba(139,93,255,0.35)] active:scale-[0.98]"
              >
                Allow
              </button>
              <button type="button" onClick={close} className="focus-ring mt-2 h-11 w-full rounded-full text-[15px] font-medium text-text-secondary active:bg-sunken">
                Not now
              </button>
            </>
          ) : (
            <>
              <h2 id="bg-title" className="mt-4 text-[22px] leading-tight font-bold text-ink">
                One more step on {maker(status.manufacturer)}
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
                {maker(status.manufacturer)} phones also stop apps on their own. In PINGO's settings, turn on <b className="font-semibold text-ink">Autostart</b>, and set Battery to <b className="font-semibold text-ink">No restrictions</b>.
              </p>
              <button
                type="button"
                onClick={() => {
                  void openBackgroundSettings();
                  close();
                }}
                className="focus-ring bg-sweep mt-6 flex h-12 w-full items-center justify-center rounded-full text-[16px] font-semibold text-white shadow-[0_6px_18px_rgba(139,93,255,0.35)] active:scale-[0.98]"
              >
                Open settings
              </button>
              <button type="button" onClick={close} className="focus-ring mt-2 h-11 w-full rounded-full text-[15px] font-medium text-text-secondary active:bg-sunken">
                Done
              </button>
            </>
          )}
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
