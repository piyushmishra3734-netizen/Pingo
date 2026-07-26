import { Button } from '@pingo/ui';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';

/**
 * Welcome — the first screen a new user sees, after the splash.
 *
 * One screen, one action. The three-panel carousel that used to live here is
 * gone: this replaces it, per the flow spec.
 *
 *   Welcome to PINGO
 *
 *   Private.
 *   Fast.
 *   Beautiful.
 *
 *   [ Get Started ]
 *
 *   By continuing you agree to…
 *
 * ## Two things worth knowing
 *
 * **There is no Log In button.** The spec ends at Get Started, so nothing else
 * is here. A returning user who signs out still reaches Log In — the splash
 * routes them there directly once the device has onboarded
 * ([§ 3](../../../../docs/01-onboarding-auth.md#3-splash)) — but on a *fresh*
 * device there is no visible way back to an existing account. Worth revisiting
 * the day someone reinstalls.
 *
 * **The legal line has no destinations yet.** It is deliberately plain text
 * rather than links: Terms and Privacy pages do not exist, and a link that goes
 * nowhere is worse than a sentence that does not pretend to.
 */
export function OnboardingScreen() {
  const navigate = useNavigate();

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-brand-wash">
      <div
        className="pointer-events-none absolute -left-32 -top-20 size-[26rem] rounded-full bg-brand/10 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pb-8 pt-10">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <AppLogo size={88} alt="" />

          <h1 className="mt-9 text-h1 text-ink animate-rise">Welcome to PINGO</h1>

          <p
            className="mt-6 text-h2 leading-relaxed text-text-secondary animate-rise"
            style={{ animationDelay: '60ms' }}
          >
            Private.
            <br />
            Fast.
            <br />
            Beautiful.
          </p>
        </div>

        <div className="animate-rise" style={{ animationDelay: '120ms' }}>
          <Button variant="primary" size="lg" block onClick={() => navigate('/signup')}>
            Get Started
          </Button>

          {/*
            Sits under the action it qualifies, so the agreement is read in the
            same glance as the button that constitutes it.
          */}
          <p className="mt-5 text-center text-caption text-text-tertiary">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
