import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AuraCta, AuraFriends, AuraShell } from '../features/auth/AuraShell.js';
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
 * ## One button
 *
 * Accounts are made with Google and nothing else (2026-11-14). Google is the
 * same action either way - it returns a session whether or not the account
 * existed - so it is the only button, and the quiet line underneath is for the
 * people who made an account some other way and come back by username.
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
        title: 'PINGO: chats, calls and stories with your friends',
        description:
          'PINGO is a messaging app for you and your friends: chats, calls, stories and music. No ads.',
        path: '/welcome',
      }),
    [],
  );

  /*
   * The aura card (owner's reference, 2026-11-14): painted art with a torn edge,
   * a large serif, typewriter labels, two friends drawn in light, and one action
   * underlined by hand. See `features/auth/aura.css`.
   */
  return (
    <AuraShell>
      <main className="flex min-h-0 flex-1 flex-col">
        <h1 className="aura-title funnel-enter">
          Your friends, all in <em>one place.</em>
        </h1>
        <p className="aura-lede funnel-enter" style={{ animationDelay: '30ms' }}>
          Chats, calls and stories with the ones who actually matter.
        </p>

        <AuraFriends delayMs={50} />

        {/* Google is the only way in now (owner's decision, 2026-11-14): phone sign-up is gone. Accounts made with a phone
            number come back through `Have an account` -> username and password. */}
        <AuraCta
          icon={<GoogleMark size={22} />}
          label={t('welcome.continueGoogle')}
          onClick={() => navigate('/auth/google')}
          style={{ animationDelay: '70ms' }}
        />

        <p className="aura-mono funnel-enter mt-3 text-center" style={{ animationDelay: '100ms' }}>
          <button type="button" className="aura-link focus-ring rounded-sm" onClick={() => navigate('/login')}>
            {t('welcome.haveAccount')}
          </button>
        </p>

        <p className="aura-legal funnel-enter mt-3" style={{ animationDelay: '120ms' }}>
          {t('welcome.legal')} <Link to="/terms">{t('welcome.terms')}</Link> and{' '}
          <Link to="/privacy">{t('welcome.privacy')}</Link>.
        </p>
      </main>
    </AuraShell>
  );
}
