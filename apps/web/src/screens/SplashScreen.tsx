import { PingoMark, Tagline, Wordmark } from '@pingo/ui';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Splash.
 *
 * A brand moment, not a loading screen — so it shows no progress indicator and
 * makes no promise about what it is waiting for. It holds for a beat and moves on.
 *
 * The 1.4s dwell is deliberate: long enough for the mark to register, short
 * enough that a returning user never feels held up. Onboarding is only shown
 * once; after that the splash goes straight to the conversation list.
 */

const DWELL_MS = 1400;

/** Set after onboarding completes, so it is never shown twice. */
const ONBOARDED_KEY = 'pingo:onboarded';

export function SplashScreen() {
  const navigate = useNavigate();

  useEffect(() => {
    const onboarded = localStorage.getItem(ONBOARDED_KEY) === 'true';
    const timer = setTimeout(() => {
      navigate(onboarded ? '/chats' : '/welcome', { replace: true });
    }, DWELL_MS);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="relative grid h-full place-items-center overflow-hidden bg-brand-wash">
      {/*
        A single soft orb, echoing the branding board's background. One shape,
        heavily blurred — a calm surface, not a gradient mesh competing with the
        logo it exists to frame.
      */}
      <div
        className="pointer-events-none absolute -right-24 top-1/3 size-[28rem] rounded-full bg-brand-alt/12 blur-3xl"
        aria-hidden
      />

      <div className="relative flex flex-col items-center gap-7 animate-fade-in">
        <PingoMark size={96} strokeClassName="text-ink" title="PINGO" />

        <div className="flex flex-col items-center gap-3">
          <Wordmark size={22} />
          <Tagline />
        </div>
      </div>
    </div>
  );
}

/** Exported so onboarding can record completion against the same key. */
export { ONBOARDED_KEY };
