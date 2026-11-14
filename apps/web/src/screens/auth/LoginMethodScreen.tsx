import { useAuth, type AuthMethodKind } from '@pingo/core';
import { UserIcon } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuraAlt, AuraCta, AuraFriends, AuraShell } from '../../features/auth/AuraShell.js';
import { GoogleMark } from '../../features/auth/GoogleMark.js';
import { readLastMethod } from '../../features/auth/last-method.js';
import { useT } from '../../features/i18n/useT.js';

interface MethodRow {
  kind: AuthMethodKind;
  label: string;
  icon: ReactNode;
  path: string;
}

/**
 * Coming back.
 *
 * Google is here as well as on Welcome, deliberately: a returning person looks
 * for the way they got in, and finding it only on the screen for new arrivals
 * would be a small cruelty. Email is not here at all, and neither is the phone
 * number any more (2026-11-14): accounts are made with Google, and the ones made
 * with a phone number (or an email) come back by username and password. Somebody
 * whose last sign-in was by phone is told so, in one line, rather than left
 * looking for a button that is gone.
 */
export function LoginMethodScreen() {
  const navigate = useNavigate();
  const { service } = useAuth();
  const t = useT();
  const lastUsed = readLastMethod();

  const methods: MethodRow[] = [
    {
      kind: 'google',
      label: t('login.continueGoogle'),
      icon: <GoogleMark size={22} />,
      path: '/auth/google',
    },
    {
      kind: 'username',
      label: t('login.username'),
      icon: <UserIcon size={18} />,
      path: '/login/username',
    },
  ];

  const available = methods.filter((method) => service.supportedMethods.includes(method.kind));
  const ordered = [
    ...available.filter((method) => method.kind === lastUsed),
    ...available.filter((method) => method.kind !== lastUsed),
  ];

  return (
    <AuraShell size="compact">
      <main className="flex min-h-0 flex-1 flex-col">
        <h1 className="aura-title funnel-enter">{t('login.welcomeBack')}</h1>

        <AuraFriends delayMs={40} />

        {/* No card around them. They are buttons on a page, not a menu. The first is the way most people go. */}
        <div className="flex flex-col gap-2.5">
          {ordered.map((method, i) => {
            const Button = i === 0 ? AuraCta : AuraAlt;
            return (
              <Button
                key={method.kind}
                icon={method.icon}
                label={method.label}
                badge={method.kind === lastUsed ? t('login.lastUsed') : undefined}
                style={{ animationDelay: `${55 + i * 28}ms` }}
                onClick={() => navigate(method.path)}
              />
            );
          })}
        </div>

        {lastUsed === 'phone' && (
          <p
            className="funnel-enter mt-3 text-center text-[13px] leading-relaxed"
            style={{ animationDelay: `${60 + ordered.length * 28}ms`, color: 'var(--aura-soft)' }}
          >
            {t('login.phoneRetired')}
          </p>
        )}

        <p
          className="aura-mono funnel-enter mt-4 text-center"
          style={{ animationDelay: `${70 + ordered.length * 28}ms`, color: 'var(--aura-faint)' }}
        >
          {t('login.newTo')}{' '}
          <button type="button" className="aura-link focus-ring rounded-sm" onClick={() => navigate('/welcome')}>
            {t('login.getStarted')}
          </button>
        </p>
      </main>
    </AuraShell>
  );
}
