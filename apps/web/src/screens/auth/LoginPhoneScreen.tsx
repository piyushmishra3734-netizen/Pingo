import { isStructurallyValidPhone } from '@pingo/core';
import { Button } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';
import { useIdentityFlow } from '../../features/auth/IdentityFlow.js';
import { PhoneField, toE164 } from '../../features/auth/PhoneField.js';
import { defaultCountry } from '../../features/auth/countries.js';
import { useT } from '../../features/i18n/useT.js';

/**
 * Log In - the number.
 *
 * The phone twin of `LoginEmailScreen`, reusing § 6.2's field so the number is
 * entered the same way whether the user is joining or returning. Same rule
 * about enumeration: this screen learns nothing and says nothing about whether
 * the number has an account.
 */
export function LoginPhoneScreen() {
  const navigate = useNavigate();
  const t = useT();
  const { setIdentity } = useIdentityFlow();

  const [country, setCountry] = useState(defaultCountry);
  const [digits, setDigits] = useState('');

  const e164 = toE164(country, digits);
  const valid = isStructurallyValidPhone(e164);

  const submit = () => {
    if (!valid) return;
    setIdentity({ kind: 'phone', value: e164 });
    navigate('/login/password');
  };

  return (
    <AuthScreen
      title={t('auth.phoneTitle')}
      onBack={() => navigate('/login')}
      footer={
        <Button variant="primary" size="lg" block disabled={!valid} onClick={submit}>
          {t('common.continue')}
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
