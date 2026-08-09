import { useAuth, type AuthMethodKind } from '@pingo/core';
import { AtIcon, PhoneIcon, UserIcon, cn } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { FunnelBackdrop } from '../../features/auth/FunnelBackdrop.js';
import { FunnelTextLink } from '../../features/auth/FunnelCta.js';
import { GoogleMark } from '../../features/auth/GoogleMark.js';
import { MethodCard } from '../../features/auth/MethodCard.js';
import { readLastMethod } from '../../features/auth/last-method.js';
import { useT } from '../../features/i18n/useT.js';

interface MethodRow {
  kind: AuthMethodKind;
  label: string;
  icon: ReactNode;
  path: string;
}

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
      kind: 'email',
      label: t('login.email'),
      icon: <AtIcon size={18} />,
      path: '/login/email',
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
          'mx-auto flex w-full max-w-[22rem] flex-1 flex-col overflow-y-auto',
          'px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]',
          'pt-[max(1.75rem,env(safe-area-inset-top))]',
        )}
      >
        <div className="flex flex-1 flex-col justify-center gap-6 py-5">
          <div className="flex flex-col items-center text-center">
            <div className="funnel-enter">
              <AppLogo size={48} alt="" />
            </div>
            <h1
              className="funnel-enter mt-5 text-[1.75rem] font-semibold leading-[1.12] tracking-[-0.03em] text-[#111113]"
              style={{ animationDelay: '25ms' }}
            >
              {t('login.welcomeBack')}
            </h1>
          </div>

          <div
            className={cn(
              'funnel-enter flex flex-col gap-2 rounded-2xl border border-black/[0.06]',
              'bg-white p-2 shadow-[0_8px_28px_rgba(0,0,0,0.04)]',
            )}
            style={{ animationDelay: '45ms' }}
          >
            {ordered.map((method, i) => (
              <MethodCard
                key={method.kind}
                icon={method.icon}
                label={method.label}
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
            <p className="text-[0.8125rem] text-[#8B8B90]">{t('login.newTo')}</p>
            <FunnelTextLink onClick={() => navigate('/signup')}>
              {t('login.getStarted')}
            </FunnelTextLink>
          </div>
        </div>
      </div>
    </FunnelBackdrop>
  );
}
