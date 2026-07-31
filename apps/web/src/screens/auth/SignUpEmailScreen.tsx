import { isStructurallyValidEmail } from '@pingo/core';
import { Button, TextField } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';
import { useIdentityFlow } from '../../features/auth/IdentityFlow.js';
import { SIGNUP_PROGRESS } from './progress.js';

/**
 * Sign-up, step 1 (email)  - 
 * [docs/01 § 6.1](../../../../../docs/01-onboarding-auth.md#61-email-address).
 *
 * **Validation is structural only**, as § 6.1 requires. Anything cleverer
 * rejects valid but unusual addresses, and this screen has no way to know
 * whether an address is real.
 *
 * It no longer sends anything. The subtitle promising a code is gone with the
 * code - a screen that says "we'll send a code to confirm it's yours" and then
 * does not is worse than one that says nothing.
 *
 * It also does **not** say whether the address is already registered. § 6.1
 * keeps that off this screen; the collision surfaces at sign-up submit, where
 * § 17 routes the user to Log In.
 */
export function SignUpEmailScreen() {
  const navigate = useNavigate();
  const { identity, setIdentity } = useIdentityFlow();

  const [email, setEmail] = useState(identity?.kind === 'email' ? identity.value : '');

  const valid = isStructurallyValidEmail(email);

  const submit = () => {
    if (!valid) return;
    setIdentity({ kind: 'email', value: email.trim() });
    navigate('/signup/password');
  };

  return (
    <AuthScreen
      progress={SIGNUP_PROGRESS.identifier}
      title="What's your email?"
      subtitle="You'll use this to sign in."
      onBack={() => navigate('/signup')}
      footer={
        <Button variant="primary" size="lg" block disabled={!valid} onClick={submit}>
          Continue
        </Button>
      }
    >
      <TextField
        label="Email"
        type="email"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        placeholder="you@example.com"
        // § 6.1: email keyboard, no autocapitalise, no autocorrect. An address
        // is not prose, and a capitalised first letter is a failed sign-in.
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
    </AuthScreen>
  );
}
