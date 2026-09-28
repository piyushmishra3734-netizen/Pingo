import { PhoneIcon, cn } from '@pingo/ui';
import { ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AppLogo } from '../components/AppLogo.js';
import { FunnelBackdrop } from '../features/auth/FunnelBackdrop.js';
import { FunnelTextLink } from '../features/auth/FunnelCta.js';
import { GoogleMark } from '../features/auth/GoogleMark.js';
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

  /*
   * PINGO paper: the same scrapbook as the onboarding art, kept quiet - two
   * small marks, one note, one marker swipe - so the two buttons are still the
   * loudest thing here. See `features/auth/paper.css`.
   */
  return (
    <FunnelBackdrop>
      <Doodle className="right-[12%] top-[max(6.5rem,calc(env(safe-area-inset-top)+5rem))] size-6" path={SPARKLE} />
      <Doodle className="right-[6%] top-[max(9rem,calc(env(safe-area-inset-top)+7.5rem))] size-3.5 rotate-12" path={STAR} />
      <main
        className={cn(
          'mx-auto flex w-full max-w-sm flex-1 flex-col',
          'px-6 pt-[max(3.5rem,calc(env(safe-area-inset-top)+2rem))]',
          'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="funnel-enter flex items-center gap-2.5">
          <AppLogo size={44} alt="" fetchPriority="high" />
          <span className="text-[22px] font-bold tracking-[-0.02em] text-ink">PINGO</span>
        </div>

        <h1
          className="funnel-enter mt-9 text-[44px] font-bold leading-[0.98] tracking-[-0.04em] text-ink"
          style={{ animationDelay: '30ms' }}
        >
          your people.
          <br />
          your <span className="paper-marker">lore.</span>
          <br />
          your space.
        </h1>

        <p
          className="funnel-enter mt-4 max-w-[19rem] text-[16.5px] leading-[1.45] text-text-secondary"
          style={{ animationDelay: '50ms' }}
        >
          Chats, calls and stories with the ones who actually matter.
        </p>

        <div
          className="funnel-enter paper-note mt-7 max-w-[20rem] self-start px-[18px] pt-[18px] pb-4"
          style={{ animationDelay: '60ms', rotate: '-1deg' }}
        >
          <span className="paper-tape left-[84px] -top-[11px] w-[76px] rotate-3" aria-hidden />
          <p className="flex items-center gap-2.5 text-[14.5px] font-semibold text-ink">
            <ShieldCheck size={18} aria-hidden />
            no ads. no spam. no selling you.
          </p>
          <p className="paper-hand mt-1 text-[21px] leading-tight">just your people</p>
        </div>

        <div className="min-h-8 flex-1" aria-hidden />

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => navigate('/auth/google')}
            className={cn(
              'funnel-enter focus-ring flex h-14 w-full items-center justify-center gap-3 rounded-[18px]',
              'bg-ink text-[17px] font-semibold text-page transition-transform duration-instant active:scale-[0.985]',
            )}
            style={{ animationDelay: '70ms' }}
          >
            <span className="grid size-[30px] place-items-center rounded-[9px] bg-white">
              <GoogleMark size={19} />
            </span>
            {t('welcome.continueGoogle')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/signup/phone')}
            className={cn(
              'funnel-enter focus-ring flex h-14 w-full items-center justify-center gap-3 rounded-[18px]',
              'border-[1.5px] border-line bg-surface text-[17px] font-semibold text-ink',
              'transition-transform duration-instant active:scale-[0.985]',
            )}
            style={{ animationDelay: '90ms' }}
          >
            <PhoneIcon size={20} />
            {t('welcome.continuePhone')}
          </button>
        </div>

        <div className="funnel-enter mt-4 text-center" style={{ animationDelay: '110ms' }}>
          <FunnelTextLink onClick={() => navigate('/login')}>{t('welcome.haveAccount')}</FunnelTextLink>
        </div>

        <p
          className="funnel-enter mt-3 text-center text-caption leading-relaxed text-text-tertiary"
          style={{ animationDelay: '130ms' }}
        >
          {t('welcome.legal')}{' '}
          <Link to="/terms" className="font-medium text-ink underline underline-offset-2">
            {t('welcome.terms')}
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="font-medium text-ink underline underline-offset-2">
            {t('welcome.privacy')}
          </Link>
          .
        </p>
      </main>
    </FunnelBackdrop>
  );
}

const SPARKLE = 'M16 2 C16.8 11 21 15.2 30 16 C21 16.8 16.8 21 16 30 C15.2 21 11 16.8 2 16 C11 15.2 15.2 11 16 2 Z';
const STAR = 'M16 3 L19.2 12.2 L29 12.6 L21.4 18.6 L24.2 28 L16 22.4 L7.8 28 L10.6 18.6 L3 12.6 L12.8 12.2 Z';

/** A hand-drawn mark in the margin. Decoration only. */
function Doodle({ className, path }: { className: string; path: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('paper-doodle', className)}
    >
      <path d={path} />
    </svg>
  );
}
