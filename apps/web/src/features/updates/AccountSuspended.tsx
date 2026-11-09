import { Mail, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AppLogo } from '../../components/AppLogo.js';
import { isAccountSuspended, onAccountSuspended } from '../../lib/account-suspended.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

const SUPPORT = 'piyushmishra3734@gmail.com';

/**
 * "This account is suspended, and why" - over everything.
 *
 * Shown when the database refuses a banned account (`lib/account-suspended.ts`).
 * One calm screen: what happened, the reason in a single sentence, and the one
 * thing the person can do about it (write to support). The local session is
 * cleared so nothing underneath keeps trying with a refused account.
 */
export function AccountSuspended() {
  const [shown, setShown] = useState(isAccountSuspended);
  useEffect(() => onAccountSuspended(() => setShown(true)), []);

  useEffect(() => {
    if (!shown) return;
    void getSupabaseClient().auth.signOut({ scope: 'local' }).catch(() => undefined);
  }, [shown]);

  if (!shown && !(import.meta.env.DEV && new URLSearchParams(location.search).has('suspended-preview'))) return null;

  const mailto = `mailto:${SUPPORT}?subject=${encodeURIComponent('My account was suspended')}`;

  return (
    <div
      className="fixed inset-0 z-[2100] flex flex-col items-center justify-center bg-page px-6 text-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="suspended-title"
      aria-describedby="suspended-body"
    >
      <div className="relative grid place-items-center">
        <span aria-hidden className="absolute size-32 rounded-full bg-danger/20 opacity-60 blur-2xl" />
        <AppLogo size={72} tile alt="" className="relative opacity-90" />
        <span className="absolute -right-2 -bottom-2 grid size-9 place-items-center rounded-full bg-page shadow-sm ring-1 ring-black/5">
          <ShieldAlert size={19} className="text-danger" aria-hidden />
        </span>
      </div>

      <p className="mt-7 rounded-full bg-danger/10 px-3 py-1 text-[12.5px] font-semibold tracking-[0.04em] text-danger uppercase">
        Account suspended
      </p>
      <h1 id="suspended-title" className="mt-3 max-w-xs text-[26px] font-extrabold leading-tight text-ink">
        We had to pause your account
      </h1>
      <p id="suspended-body" className="mt-3 max-w-xs text-[15.5px] leading-relaxed text-text-secondary">
        We noticed suspicious activity on your account. To keep everyone safe, it has been suspended and you can no longer
        sign in with it.
      </p>

      <div className="mt-6 w-full max-w-xs rounded-2xl bg-surface px-4 py-3 text-left shadow-sm">
        <p className="text-[12.5px] font-semibold tracking-[0.04em] text-text-tertiary uppercase">Reason</p>
        <p className="mt-1 text-[14.5px] leading-snug text-ink">Suspicious activity on this account.</p>
      </div>

      <div className="mt-8 w-full max-w-xs">
        <a
          href={mailto}
          className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-semibold text-white active:scale-[0.98]"
        >
          <Mail size={19} aria-hidden />
          Contact support
        </a>
        <p className="mt-3 text-[13px] leading-snug text-text-tertiary">
          If you think this is a mistake, write to us and we will take another look.
        </p>
      </div>
    </div>
  );
}
