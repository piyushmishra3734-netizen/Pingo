import { isStructurallyValidPhone, useAuth } from '@pingo/core';
import { Button } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { useIdentityFlow } from '../../features/auth/IdentityFlow.js';
import { PhoneField, toE164 } from '../../features/auth/PhoneField.js';
import { defaultCountry } from '../../features/auth/countries.js';
import { authErrorMessage } from '../../features/auth/messages.js';
import { useT } from '../../features/i18n/useT.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { SIGNUP_PROGRESS } from './progress.js';

/**
 * Sign-up, step 1 (phone)  - 
 * [docs/01 § 6.2](../../../../../docs/01-onboarding-auth.md#62-phone-number).
 *
 * The § 6.2 wireframe without its verification step. Continue is disabled until
 * the number is structurally valid, the country defaults from device locale
 * (never IP - that reveals travel), and there is **no shake on error**.
 *
 * ## The code is back
 *
 * This screen used to hand straight to the password, and said what that cost:
 * a number on an account was a claim rather than a fact, so contact discovery
 * (§ 12) could not be built on it without letting anyone be found as anyone.
 * Continue now sends an SMS and `SignUpPhoneCodeScreen` collects the answer,
 * which makes the number a fact and unblocks that feature.
 *
 * Sending happens here rather than on the next screen so a number the provider
 * refuses is reported on the screen that took it, next to the field somebody
 * can fix - not on a screen that is waiting for a code which is never coming.
 */
export function SignUpPhoneScreen() {
  const navigate = useNavigate();
  const t = useT();
  const { setIdentity } = useIdentityFlow();
  const { service } = useAuth();

  const [country, setCountry] = useState(defaultCountry);
  const [digits, setDigits] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const e164 = toE164(country, digits);
  const valid = isStructurallyValidPhone(e164);

  const submit = async () => {
    if (!valid || sending) return;

    setSending(true);
    setError(undefined);

    try {
      /*
       * § 17, asked before the call rather than after it. A number that already
       * has an account would otherwise get a code that signs into that account,
       * and the password screen next would replace its password. It goes to
       * Log In instead, with "Looks like you're already with us". If the check
       * itself fails, sign-up carries on as before.
       */
      const { data: registered } = await getSupabaseClient().rpc('phone_registered', {
        p_phone: e164,
      });
      if (registered === true) {
        const identity = { kind: 'phone', value: e164 } as const;
        /*
         * Set here as well as handed over: sign-up and log-in are sibling routes
         * with the same `IdentityFlow` element, so React keeps this instance and
         * its state across the move, and the router-state seed never runs.
         */
        setIdentity(identity);
        navigate('/login/password', { state: { identity, collision: true } });
        return;
      }

      await service.phoneOtp.start(e164);
      setIdentity({ kind: 'phone', value: e164 });
      navigate('/signup/code');
    } catch (cause) {
      setError(authErrorMessage(cause, 'signUp'));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthScreen
      progress={SIGNUP_PROGRESS.identifier}
      title={t('auth.phoneTitle')}
      subtitle={t('auth.phoneSubtitle')}
      onBack={() => navigate('/welcome')}
      message={error && <AuthMessage>{error}</AuthMessage>}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!valid || sending}
          loading={sending}
          onClick={() => void submit()}
        >
          {t('common.continue')}
        </Button>
      }
    >
      <PhoneField
        country={country}
        onCountryChange={setCountry}
        digits={digits}
        onDigitsChange={setDigits}
        onSubmit={() => void submit()}
        autoFocus
      />
    </AuthScreen>
  );
}
