import { Button, TextField } from '@pingo/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthScreen } from '../../features/auth/AuthScreen.js';
import { useProfileSetup } from '../../features/profile/ProfileSetupFlow.js';
import { SETUP_PROGRESS } from './progress.js';

/**
 * Setup, step 1 — the name.
 *
 *   What should people call you?
 *
 * Required, and framed as a question rather than a form label: "Name" invites a
 * legal name, "what should people call you" invites the true answer. Real names
 * are not required and never have been
 * ([docs/01 § 9.2](../../../../../docs/01-onboarding-auth.md#92-name-username-bio)) —
 * what matters is that *something* is there, because a nameless account is
 * unusable for everyone who talks to it.
 *
 * No Back. The account already exists by this point, so there is nothing behind
 * this screen to return to.
 */

const MAX_NAME_LENGTH = 50;

export function NameScreen() {
  const navigate = useNavigate();
  const { displayName, setDisplayName } = useProfileSetup();
  const [touched, setTouched] = useState(false);

  const trimmed = displayName.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
  const tooLong = trimmed.length > MAX_NAME_LENGTH;

  const submit = () => {
    if (!valid) return;
    navigate('/setup/username');
  };

  return (
    <AuthScreen
      progress={SETUP_PROGRESS.name}
      title="What should people call you?"
      showBack={false}
      footer={
        <Button variant="primary" size="lg" block disabled={!valid} onClick={submit}>
          Continue
        </Button>
      }
    >
      <TextField
        label="Name"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
          setTouched(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        placeholder="Piyush"
        // Names are proper nouns, so capitalise — but never autocorrect one.
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="name"
        autoFocus
        invalid={touched && tooLong}
        hint={tooLong ? `${MAX_NAME_LENGTH} characters at most.` : undefined}
      />
    </AuthScreen>
  );
}
