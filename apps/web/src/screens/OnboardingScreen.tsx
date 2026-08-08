import { Button } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { useT } from '../features/i18n/useT.js';
import { applyPageSeo } from '../lib/seo.js';

/**
 * Welcome - the first screen a new user sees, after the splash / intro slides.
 *
 * Copy follows the active language voice (`en` / `en-genz`).
 */
export function OnboardingScreen() {
  const navigate = useNavigate();
  const t = useT();

  useEffect(
    () =>
      applyPageSeo({
        title: 'Welcome to PINGO. Private messaging',
        description:
          'Welcome to PINGO. Private, fast, beautiful messaging with disappearing Pings, expiring stories, and a three-post profile. Get started free.',
        path: '/welcome',
      }),
    [],
  );

  const tagline = t('welcome.tagline').split('\n');

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-brand-wash">
      <div
        className="pointer-events-none absolute -left-32 -top-20 size-[26rem] rounded-full bg-brand/10 blur-3xl"
        aria-hidden
      />

      <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pb-8 pt-10">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <AppLogo size={88} alt="" fetchPriority="high" />

          <h1 className="mt-9 text-h1 text-ink animate-rise">{t('welcome.title')}</h1>

          <p
            className="mt-6 text-h2 leading-relaxed text-text-secondary animate-rise"
            style={{ animationDelay: '60ms' }}
          >
            {tagline.map((line, index) => (
              <span key={line}>
                {index > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </p>
        </div>

        <div className="animate-rise" style={{ animationDelay: '120ms' }}>
          <Button variant="primary" size="lg" block onClick={() => navigate('/signup')}>
            {t('welcome.getStarted')}
          </Button>

          <p className="mt-5 text-center text-caption text-text-tertiary">
            {t('welcome.legal')}{' '}
            <Link to="/terms" className="text-brand underline-offset-2 hover:underline">
              {t('welcome.terms')}
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="text-brand underline-offset-2 hover:underline">
              {t('welcome.privacy')}
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
