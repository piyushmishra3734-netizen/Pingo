import { isValidUsername, normaliseUsername } from '@pingo/core';
import { Button, TextField } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';
import { useIdentityFlow } from '../../features/auth/IdentityFlow.js';

/**
 * Log In - the username.
 *
 * The third way in, and the one people reach for first: a username is the thing
 * you already tell other people, so it is the thing you remember. An address
 * signed up with eighteen months ago is not - which is how somebody ends up
 * locked out of an account whose password they know perfectly well.
 *
 * Structurally identical to the email and phone steps: collect the identifier,
 * hand it to `LoginPasswordScreen`. That screen already serves both other doors
 * without branching, and it serves this one on the same terms.
 *
 * ## Nothing here says whether the username exists
 *
 * The field validates *shape* - 3-20 of `[a-z0-9_]`, the same rule the profile
 * enforces - and stops there. Checking availability would answer "does this
 * person have a PINGO account" for anybody who asks, which is the enumeration
 * oracle § 13.2 refuses. The single generic failure lands one screen later,
 * where a wrong password and an unknown handle are the same answer.
 */
export function LoginUsernameScreen() {
  const navigate = useNavigate();
  const { identity, setIdentity } = useIdentityFlow();

  const [username, setUsername] = useState(
    identity?.kind === 'username' ? identity.value : '',
  );

  const valid = isValidUsername(username);

  const submit = () => {
    if (!valid) return;
    setIdentity({ kind: 'username', value: username });
    navigate('/login/password');
  };

  return (
    <AuthScreen
      title="What's your username?"
      onBack={() => navigate('/login')}
      footer={
        <Button variant="primary" size="lg" block disabled={!valid} onClick={submit}>
          Continue
        </Button>
      }
    >
      <TextField
        label="Username"
        value={username}
        /*
         * Lowercased as you type, exactly as sign-up does it. Usernames are
         * stored lowercase, so a phone that helpfully capitalises the first
         * letter would otherwise produce "no such account" for a handle typed
         * correctly.
         */
        onChange={(event) => setUsername(normaliseUsername(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        leading={<span className="text-body text-text-secondary">@</span>}
        placeholder="yourname"
        maxLength={20}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
    </AuthScreen>
  );
}
