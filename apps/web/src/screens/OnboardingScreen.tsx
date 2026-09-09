import { PhoneIcon, cn } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { FunnelBackdrop } from '../features/auth/FunnelBackdrop.js';
import { FunnelTextLink } from '../features/auth/FunnelCta.js';
import { GoogleMark } from '../features/auth/GoogleMark.js';
import { MethodButton } from '../features/auth/MethodButton.js';
import { useT } from '../features/i18n/useT.js';
import { applyPageSeo } from '../lib/seo.js';

/**
 * Welcome, and the whole chooser.
 *
 * ## Why there is no "choose a method" screen any more
 *
 * There used to be three screens to get past: this one, then `/signup` to pick
 * a method, then the method itself. With accounts created by Google or phone
 * and nothing else, the middle screen offered two rows - and a screen that
 * exists to show two buttons is a screen those two buttons can live on.
 *
 * ## Why phone still says "new here" rather than just "continue"
 *
 * Google is the same action either way: it returns a session whether or not the
 * account existed. Phone is not. Sign-up sends an SMS and sign-in takes a
 * password, and one button cannot choose between them without either spending
 * an SMS on every sign-in - the cost that made phone OTP affordable in the
 * first place - or asking the server whether a number is registered, which is
 * an enumeration oracle this codebase deliberately does not offer.
 *
 * So the split stays, and it is honest: this screen is for arriving, and the
 * quiet line underneath is for coming back.
 *
 * ## The account sentence
 *
 * HIG, Managing accounts: "write a brief, friendly description of the reasons
 * for the requirement and its benefits. Display this message in your sign-in
 * view." No screen in the funnel did. This one does, and it is true rather than
 * promotional - messages are encrypted to a person, so there has to be one.
 */
export function OnboardingScreen() {
  const navigate = useNavigate();
  const t = useT();

  useEffect(
    () =>
      applyPageSeo({
        title: 'Welcome to PINGO. Private messaging',
        description:
          'Welcome to PINGO. Private, fast, beautiful messaging. Get started free.',
        path: '/welcome',
      }),
    [],
  );

  const tagline = t('welcome.tagline').split('\n');

  return (
    <FunnelBackdrop>
      <main
        className={cn(
          'mx-auto flex w-full max-w-sm flex-1 flex-col justify-center',
          'px-5 pt-[max(2rem,env(safe-area-inset-top))]',
          'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="flex flex-col items-center pt-6 text-center">
          {/*
            Two elements, not one. `funnel-enter` and `funnel-logo-breathe` each
            set the `animation` shorthand, so on a single element the later rule
            wins outright - `funnel-in` never ran, and `.funnel-enter`'s
            `opacity: 0` was never animated away. The logo was invisible.
          */}
          <div className="funnel-enter">
            <div className="funnel-logo-breathe">
              <AppLogo size={72} alt="" fetchPriority="high" />
            </div>
          </div>

          <h1
            className="funnel-enter mt-8 text-h1 text-ink"
            style={{ animationDelay: '30ms' }}
          >
            {t('welcome.title')}
          </h1>

          <p
            className="funnel-enter mt-3 max-w-[17rem] text-body text-text-secondary"
            style={{ animationDelay: '50ms' }}
          >
            {tagline.map((line, index) => (
              <span key={line}>
                {index > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </p>
        </div>

        {/* The reason an account exists at all, said once, where it is asked for. */}
        <p
          className="funnel-enter mt-10 mb-4 text-center text-caption text-text-tertiary"
          style={{ animationDelay: '60ms' }}
        >
          {t('welcome.whyAccount')}
        </p>

        <div className="flex flex-col gap-2.5">
          <MethodButton
            variant="primary"
            label={t('welcome.continueGoogle')}
            icon={<GoogleMark size={18} />}
            onClick={() => navigate('/auth/google')}
            delayMs={70}
          />
          <MethodButton
            label={t('welcome.continuePhone')}
            icon={<PhoneIcon size={18} />}
            onClick={() => navigate('/signup/phone')}
            delayMs={90}
          />
        </div>

        <div
          className="funnel-enter mt-5 text-center"
          style={{ animationDelay: '110ms' }}
        >
          <FunnelTextLink onClick={() => navigate('/login')}>
            {t('welcome.haveAccount')}
          </FunnelTextLink>
        </div>

        <p
          className="funnel-enter mt-5 text-center text-caption leading-relaxed text-text-tertiary"
          style={{ animationDelay: '130ms' }}
        >
          {t('welcome.legal')}{' '}
          <Link to="/terms" className="font-medium text-brand underline-offset-2 hover:underline">
            {t('welcome.terms')}
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="font-medium text-brand underline-offset-2 hover:underline">
            {t('welcome.privacy')}
          </Link>
          .
        </p>
      </main>
    </FunnelBackdrop>
  );
}
