import {
  ProfileError,
  isValidUsername,
  normaliseUsername,
  suggestUsernameFromName,
  useProfile,
} from '@pingo/core';
import { Button, CheckIcon, CloseIcon, PingoDot, TextField, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { useT } from '../../features/i18n/useT.js';
import { useProfileSetup } from '../../features/profile/ProfileSetupFlow.js';
import { SETUP_PROGRESS } from './progress.js';

/**
 * Setup, step 2 - the handle.
 *
 *   Choose Username
 *   @piyush
 *   ✓ Available
 *
 * Everything specified in
 * [docs/01 § 9.2](../../../../../docs/01-onboarding-auth.md#92-name-username-bio):
 * the `@` is a fixed prefix rather than something typed, input is
 * **lowercase-normalised as you type** so the user is never corrected
 * afterwards, availability is debounced 400ms with the brand dots in the
 * trailing slot, and a collision offers three alternatives.
 *
 * ## The check is advisory, and the code says so
 *
 * Two people can pass the same check in the same second. The unique index is
 * the real arbiter, so `create` can still fail with `username_taken` even after
 * a green tick - and when it does, this screen recovers in place with fresh
 * suggestions rather than treating it as an error.
 *
 * **This step writes the profile row.** Name and username are the two required
 * fields; once both exist the account is complete enough to keep, so the photo
 * and permission steps that follow are edits rather than the rest of a
 * half-finished record.
 */

const DEBOUNCE_MS = 400;

export function UsernameScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { service, create } = useProfile();
  const { displayName } = useProfileSetup();

  const [username, setUsername] = useState(() => suggestUsernameFromName(displayName));
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | undefined>();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const wellFormed = isValidUsername(username);

  /** Guards against a slow reply for an old value overwriting a newer one. */
  const requestId = useRef(0);

  useEffect(() => {
    setError(undefined);

    if (!wellFormed) {
      setAvailable(undefined);
      setSuggestions([]);
      setChecking(false);
      return;
    }

    setChecking(true);
    const id = ++requestId.current;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const free = await service.isUsernameAvailable(username);
          if (id !== requestId.current) return;

          setAvailable(free);
          setSuggestions(free ? [] : await service.suggestUsernames(username));
        } catch {
          // A failed check is not a taken name. Left unknown so the user can
          // still press Continue - the write is the real check anyway.
          if (id === requestId.current) setAvailable(undefined);
        } finally {
          if (id === requestId.current) setChecking(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [username, wellFormed, service]);

  const submit = async () => {
    if (!wellFormed || saving || available === false) return;

    setSaving(true);
    setError(undefined);

    try {
      await create({ username, displayName });
      navigate('/setup/photo', { replace: true });
    } catch (cause) {
      if (cause instanceof ProfileError && cause.code === 'username_taken') {
        // Lost the race between the check and the write. Recover in place.
        setAvailable(false);
        setSuggestions(await service.suggestUsernames(username).catch(() => []));
        setError('That one just went. Try another.');
      } else {
        setError("We couldn't save that. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthScreen
      progress={SETUP_PROGRESS.username}
      title={t('setup.usernameTitle')}
      showBack={false}
      message={error && <AuthMessage>{error}</AuthMessage>}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!wellFormed || available === false}
          loading={saving}
          onClick={submit}
        >
          Continue
        </Button>
      }
    >
      <TextField
        label={t('setup.usernameLabel')}
        value={username}
        // § 9.2: normalised as typed, so nothing is "corrected" after the fact.
        onChange={(event) => setUsername(normaliseUsername(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
        }}
        placeholder="piyush"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        disabled={saving}
        maxLength={20}
        // The `@` belongs to the field, not to what the user types.
        leading={<span className="text-body text-text-secondary">@</span>}
        trailing={
          checking ? (
            <PingoDot state="loading" size={5} label={t('setup.usernameChecking')} />
          ) : available === true ? (
            <span className="grid size-5 place-items-center rounded-full bg-brand text-white">
              <CheckIcon size={12} strokeWidth={3} />
            </span>
          ) : available === false ? (
            <span className="grid size-5 place-items-center rounded-full bg-danger text-white">
              <CloseIcon size={12} strokeWidth={3} />
            </span>
          ) : null
        }
      />

      {/* § 9.2: the URL preview, so the handle is concrete rather than abstract. */}
      <p
        className={cn(
          'mt-2 text-caption',
          available === false ? 'text-danger' : 'text-text-secondary',
        )}
        aria-live="polite"
      >
        {!wellFormed
          ? '3-20 characters. Letters, numbers and underscores.'
          : checking
            ? `pingo.chat/${username}`
            : available === true
              ? `pingo.chat/${username} · Available`
              : available === false
                ? `pingo.chat/${username} · Taken`
                : `pingo.chat/${username}`}
      </p>

      {suggestions.length > 0 && (
        <div className="mt-5">
          <p className="text-caption font-medium text-text-secondary">{t('setup.usernameTry')}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setUsername(suggestion)}
                className={cn(
                  'rounded-full px-3.5 py-2 text-caption',
                  'bg-sunken text-ink focus-ring',
                  'transition-colors duration-instant ease-standard',
                  'hover:bg-hover active:bg-pressed',
                )}
              >
                @{suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthScreen>
  );
}
