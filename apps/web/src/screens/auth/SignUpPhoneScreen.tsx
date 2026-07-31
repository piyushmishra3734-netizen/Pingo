import { isStructurallyValidPhone } from '@pingo/core';
import { Button } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';
import { useIdentityFlow } from '../../features/auth/IdentityFlow.js';
import { PhoneField, toE164 } from '../../features/auth/PhoneField.js';
import { defaultCountry } from '../../features/auth/countries.js';
import { SIGNUP_PROGRESS } from './progress.js';

/**
 * Sign-up, step 1 (phone)  - 
 * [docs/01 § 6.2](../../../../../docs/01-onboarding-auth.md#62-phone-number).
 *
 * The § 6.2 wireframe without its verification step. Continue is disabled until
 * the number is structurally valid, the country defaults from device locale
 * (never IP - that reveals travel), and there is **no shake on error**.
 *
 * ## What is lost with the code, stated plainly
 *
 * § 6.2's verification proved the number belonged to the person signing up.
 * Without it, a number on an account is a claim, not a fact. Contact discovery
 * (§ 12) matches people *by* phone number, so building it on unverified numbers
 * would let anyone be found as anyone - that feature needs its own verification
 * step before it ships, and cannot lean on this screen.
 */
export function SignUpPhoneScreen() {
  const navigate = useNavigate();
  const { setIdentity } = useIdentityFlow();

  const [country, setCountry] = useState(defaultCountry);
  const [digits, setDigits] = useState('');

  const e164 = toE164(country, digits);
  const valid = isStructurallyValidPhone(e164);

  const submit = () => {
    if (!valid) return;
    setIdentity({ kind: 'phone', value: e164 });
    navigate('/signup/password');
  };

  return (
    <AuthScreen
      progress={SIGNUP_PROGRESS.identifier}
      title="What's your number?"
      subtitle="You'll use this to sign in."
      onBack={() => navigate('/signup')}
      footer={
        <Button variant="primary" size="lg" block disabled={!valid} onClick={submit}>
          Continue
        </Button>
      }
    >
      <PhoneField
        country={country}
        onCountryChange={setCountry}
        digits={digits}
        onDigitsChange={setDigits}
        onSubmit={submit}
        autoFocus
      />
    </AuthScreen>
  );
}
