import { useAuth, type AuthMethodKind } from '@pingo/core';
import { AtIcon, PhoneIcon, cn } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { FunnelBackdrop } from '../../features/auth/FunnelBackdrop.js';
import { FunnelTextLink } from '../../features/auth/FunnelCta.js';
import { GoogleMark } from '../../features/auth/GoogleMark.js';
import { MethodCard } from '../../features/auth/MethodCard.js';
import { useT } from '../../features/i18n/useT.js';

interface MethodRow {
  kind: AuthMethodKind;
  label: string;
  caption?: string;
  icon: ReactNode;
  path: string;
}

export function SignUpMethodScreen() {
  const navigate = useNavigate();
  const { service } = useAuth();
  const t = useT();

  const methods: MethodRow[] = [
    {
      kind: 'google',
      label: t('signup.continueGoogle'),
      caption: t('signup.googleCaption'),
      icon: <GoogleMark size={18} />,
      path: '/auth/google',
    },
    {
      kind: 'email',
      label: t('signup.continueEmail'),
      icon: <AtIcon size={18} />,
      path: '/signup/email',
    },
    {
      kind: 'phone',
      label: t('signup.continuePhone'),
      caption: t('signup.phoneCaption'),
      icon: <PhoneIcon size={18} />,
      path: '/signup/phone',
    },
  ];

  const available = methods.filter((method) => service.supportedMethods.includes(method.kind));
  const showsGoogle = available.some((method) => method.kind === 'google');
  const tagline = t('signup.tagline').split('\n');

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
              className="funnel-enter mt-5 text-[1.75rem] font-semibold leading-[1.12] tracking-[-0.03em] text-ink"
              style={{ animationDelay: '25ms' }}
            >
              {t('signup.welcome')}
            </h1>
            <p
              className="funnel-enter mt-2 max-w-[17rem] text-[0.9375rem] leading-relaxed tracking-[-0.01em] text-[#6B6B6F]"
              style={{ animationDelay: '40ms' }}
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
              'funnel-enter flex flex-col gap-2 rounded-2xl border border-black/[0.06]',
              'bg-white p-2 shadow-[0_8px_28px_rgba(0,0,0,0.04)]',
            )}
            style={{ animationDelay: '55ms' }}
          >
            {available.map((method, i) => (
              <MethodCard
                key={method.kind}
                icon={method.icon}
                label={method.label}
                description={method.caption}
                delayMs={65 + i * 30}
                onClick={() => navigate(method.path)}
              />
            ))}
          </div>

          {showsGoogle && (
            <p
              className="funnel-enter -mt-2 text-center text-[0.75rem] text-[#8B8B90]"
              style={{ animationDelay: `${70 + available.length * 30}ms` }}
            >
              {t('signup.googleNote')}
            </p>
          )}

          <div
            className="funnel-enter flex flex-col items-center gap-0.5"
            style={{ animationDelay: `${80 + available.length * 30}ms` }}
          >
            <p className="text-[0.8125rem] text-[#8B8B90]">{t('signup.already')}</p>
            <FunnelTextLink onClick={() => navigate('/login')}>{t('signup.logIn')}</FunnelTextLink>
          </div>
        </div>
      </div>
    </FunnelBackdrop>
  );
}
