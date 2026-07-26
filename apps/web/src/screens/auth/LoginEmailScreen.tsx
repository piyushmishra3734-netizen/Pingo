import { isStructurallyValidEmail } from '@pingo/core';
import { Button, TextField } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';
import { useIdentityFlow } from '../../features/auth/IdentityFlow.js';

/**
 * Log In — the address.
 *
 * § 13.2's wireframe opens with the identity already known (`+91 98765 43210
 * Change`), so the blueprint implies this step without drawing it. It reuses
 * § 6.1's layout rather than inventing a third pattern.
 *
 * Nothing here reveals whether the address has an account. § 13.2's *"generic
 * failure"* rule puts that decision at the end of the flow, once, where an
 * unknown identity and a wrong password are indistinguishable.
 */
export function LoginEmailScreen() {
  const navigate = useNavigate();
  const { identity, setIdentity } = useIdentityFlow();

  const [email, setEmail] = useState(identity?.kind === 'email' ? identity.value : '');

  const valid = isStructurallyValidEmail(email);

  const submit = () => {
    if (!valid) return;
    setIdentity({ kind: 'email', value: email.trim() });
    navigate('/login/password');
  };

  return (
    <AuthScreen
      title="What's your email?"
      onBack={() => navigate('/login')}
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
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
    </AuthScreen>
  );
}
