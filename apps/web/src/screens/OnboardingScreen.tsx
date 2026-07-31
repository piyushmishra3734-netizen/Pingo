import { Button } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { applyPageSeo } from '../lib/seo.js';

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
 * **Terms and Privacy are real destinations.** The legal line links to the
 * public `/terms` and `/privacy` pages so the agreement is not a dead claim.
 */
export function OnboardingScreen() {
  const navigate = useNavigate();

  useEffect(
    () =>
      applyPageSeo({
        title: 'Welcome to PINGO — Private messaging',
        description:
          'Welcome to PINGO. Private, fast, beautiful messaging with disappearing Pings, expiring stories, and a three-post profile. Get started free.',
        path: '/welcome',
      }),
    [],
  );

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-brand-wash">
      <div
        className="pointer-events-none absolute -left-32 -top-20 size-[26rem] rounded-full bg-brand/10 blur-3xl"
        aria-hidden
      />

      <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pb-8 pt-10">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <AppLogo size={88} alt="" fetchPriority="high" />

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
            same glance as the button that constitutes it. Links are public
            pages — not auth-gated settings screens.
          */}
          <p className="mt-5 text-center text-caption text-text-tertiary">
            By continuing you agree to our{' '}
            <Link to="/terms" className="text-brand underline-offset-2 hover:underline">
              Terms of Use
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="text-brand underline-offset-2 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
