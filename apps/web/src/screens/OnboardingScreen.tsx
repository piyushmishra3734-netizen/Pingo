import { cn } from '@pingo/ui';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { FunnelBackdrop } from '../features/auth/FunnelBackdrop.js';
import { FunnelCta } from '../features/auth/FunnelCta.js';
import { useT } from '../features/i18n/useT.js';
import { applyPageSeo } from '../lib/seo.js';

/**
 * Welcome — snappy enter, solid dock, black CTA. Productive first screen.
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
          'mx-auto flex w-full max-w-[22rem] flex-1 flex-col',
          'px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]',
          'pt-[max(2.5rem,env(safe-area-inset-top))]',
        )}
      >
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="funnel-enter funnel-logo-breathe">
            <AppLogo size={80} alt="" fetchPriority="high" />
          </div>

          <h1
            className={cn(
              'funnel-enter mt-9 text-[2rem] font-semibold leading-[1.1]',
              'tracking-[-0.035em] text-[#111113]',
            )}
            style={{ animationDelay: '30ms' }}
          >
            {t('welcome.title')}
          </h1>

          <p
            className={cn(
              'funnel-enter mt-3 max-w-[16.5rem] text-[0.9375rem] leading-relaxed',
              'tracking-[-0.01em] text-[#6B6B6F]',
            )}
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

        <div
          className={cn(
            'funnel-enter rounded-2xl border border-black/[0.06] bg-white p-4',
            'shadow-[0_8px_28px_rgba(0,0,0,0.05)]',
          )}
          style={{ animationDelay: '70ms' }}
        >
          <FunnelCta onClick={() => navigate('/signup')}>{t('welcome.getStarted')}</FunnelCta>

          <p className="mt-3.5 text-center text-[0.75rem] leading-relaxed text-[#8B8B90]">
            {t('welcome.legal')}{' '}
            <Link
              to="/terms"
              className="font-medium text-[#111113] underline-offset-2 hover:underline"
            >
              {t('welcome.terms')}
            </Link>{' '}
            and{' '}
            <Link
              to="/privacy"
              className="font-medium text-[#111113] underline-offset-2 hover:underline"
            >
              {t('welcome.privacy')}
            </Link>
            .
          </p>
        </div>
      </main>
    </FunnelBackdrop>
  );
}
