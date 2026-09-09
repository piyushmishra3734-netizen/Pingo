import { useAuth, type AuthMethodKind } from '@pingo/core';
import { PhoneIcon, UserIcon, cn } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { FunnelBackdrop } from '../../features/auth/FunnelBackdrop.js';
import { FunnelTextLink } from '../../features/auth/FunnelCta.js';
import { GoogleMark } from '../../features/auth/GoogleMark.js';
import { MethodButton } from '../../features/auth/MethodButton.js';
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
 * would be a small cruelty. Email is not here at all - accounts are Google or
 * phone now, and the addresses that already exist sign in by username.
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
      icon: <GoogleMark size={18} />,
      path: '/auth/google',
    },
    {
      kind: 'username',
      label: t('login.username'),
      icon: <UserIcon size={18} />,
      path: '/login/username',
    },
    {
      kind: 'phone',
      label: t('login.phone'),
      icon: <PhoneIcon size={18} />,
      path: '/login/phone',
    },
  ];

  const available = methods.filter((method) => service.supportedMethods.includes(method.kind));
  const ordered = [
    ...available.filter((method) => method.kind === lastUsed),
    ...available.filter((method) => method.kind !== lastUsed),
  ];

  return (
    <FunnelBackdrop>
      <div
        className={cn(
          'mx-auto flex w-full max-w-sm flex-1 flex-col overflow-y-auto',
          'px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'pt-[max(1.75rem,env(safe-area-inset-top))]',
        )}
      >
        <div className="flex flex-1 flex-col justify-center gap-6 py-5">
          <div className="flex flex-col items-center text-center">
            <div className="funnel-enter">
              <AppLogo size={48} alt="" />
            </div>
            <h1 className="funnel-enter mt-5 text-h1 text-ink" style={{ animationDelay: '25ms' }}>
              {t('login.welcomeBack')}
            </h1>
          </div>

          {/* No card around them. They are buttons on a page, not a menu. */}
          <div className="flex flex-col gap-2.5">
            {ordered.map((method, i) => (
              <MethodButton
                key={method.kind}
                icon={method.icon}
                label={method.label}
                variant={i === 0 ? 'primary' : 'outline'}
                badge={method.kind === lastUsed ? t('login.lastUsed') : undefined}
                delayMs={55 + i * 28}
                onClick={() => navigate(method.path)}
              />
            ))}
          </div>

          <div
            className="funnel-enter flex flex-col items-center gap-0.5"
            style={{ animationDelay: `${70 + ordered.length * 28}ms` }}
          >
            <p className="text-caption text-text-tertiary">{t('login.newTo')}</p>
            <FunnelTextLink onClick={() => navigate('/welcome')}>
              {t('login.getStarted')}
            </FunnelTextLink>
          </div>
        </div>
      </div>
    </FunnelBackdrop>
  );
}
