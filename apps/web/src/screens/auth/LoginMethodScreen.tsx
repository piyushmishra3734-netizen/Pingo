import { useAuth, type AuthMethodKind } from '@pingo/core';
import { AtIcon, Button, ListGroup, ListRow, PhoneIcon, UserIcon } from '@pingo/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppLogo } from '../../components/AppLogo.js';
import { readLastMethod } from '../../features/auth/last-method.js';
import { useT } from '../../features/i18n/useT.js';

/**
 * Log In - [docs/01 § 13.1](../../../../../docs/01-onboarding-auth.md#131-method-selection).
 *
 * The returning-user twin of Welcome, and a triage screen for the same reason:
 * no gradient button, because there is no single thing the user came here to do.
 *
 * The one behaviour that differs from Welcome is the ordering - § 13.1 moves the
 * **last-used method to the top and captions it `Last used`**. Rows also carry no
 * captions here: a returning user does not need to be told Google is fastest.
 */

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
    { kind: 'google', label: t('login.continueGoogle'), icon: <GoogleMark />, path: '/auth/google' },
    { kind: 'username', label: t('login.username'), icon: <UserIcon size={20} />, path: '/login/username' },
    { kind: 'email', label: t('login.email'), icon: <AtIcon size={20} />, path: '/login/email' },
    { kind: 'phone', label: t('login.phone'), icon: <PhoneIcon size={20} />, path: '/login/phone' },
  ];

  const available = methods.filter((method) => service.supportedMethods.includes(method.kind));
  const ordered = [
    ...available.filter((method) => method.kind === lastUsed),
    ...available.filter((method) => method.kind !== lastUsed),
  ];

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-brand-wash">
      <div
        className="pointer-events-none absolute -right-24 top-1/4 size-[24rem] rounded-full bg-brand-alt/10 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-10 px-6 py-12">
        <div className="flex flex-col items-center">
          <AppLogo size={64} alt="" />
          <h1 className="mt-8 text-h1 text-ink animate-rise">{t('login.welcomeBack')}</h1>
        </div>

        <div className="animate-rise" style={{ animationDelay: '60ms' }}>
          <ListGroup>
            {ordered.map((method) => (
              <ListRow
                key={method.kind}
                icon={method.icon}
                label={method.label}
                description={method.kind === lastUsed ? t('login.lastUsed') : undefined}
                onClick={() => navigate(method.path)}
              />
            ))}
          </ListGroup>
        </div>

        <div
          className="flex flex-col items-center gap-1 animate-rise"
          style={{ animationDelay: '120ms' }}
        >
          <p className="text-caption text-text-secondary">{t('login.newTo')}</p>
          <Button variant="text" size="lg" onClick={() => navigate('/signup')}>
            {t('login.getStarted')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** See the note on the same component in `SignUpMethodScreen`. */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1Z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.5a13 13 0 0 1-19.4-6.8H4.7v5.7A22 22 0 0 0 24 46Z"
      />
      <path fill="#FBBC05" d="M12 28.3a13 13 0 0 1 0-8.6v-5.7H4.7a22 22 0 0 0 0 20l7.3-5.7Z" />
      <path
        fill="#EA4335"
        d="M24 9.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3A21 21 0 0 0 24 2 22 22 0 0 0 4.7 14l7.3 5.7A13 13 0 0 1 24 9.5Z"
      />
    </svg>
  );
}
