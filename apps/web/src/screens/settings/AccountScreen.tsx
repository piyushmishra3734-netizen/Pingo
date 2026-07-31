import {
  ProfileError,
  isValidUsername,
  normaliseUsername,
  useAuth,
  useProfile,
} from '@pingo/core';
import { Avatar, Button, PingoDot, TextField, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';
import { useSignOut } from '../../features/settings/useSignOut.js';

/**
 * Account.
 *
 * The only settings page where everything writes to the database, because this
 * is the only page whose settings are *facts about the account* rather than
 * preferences about this device.
 *
 * ## Saving is explicit here, unlike everywhere else in Settings
 *
 * Every other page writes on change, because a preference is cheap to undo.
 * A username is not: it is public, unique, and someone else can take the one
 * you left. So name and username have a Save, and it only lights up when there
 * is something to save.
 *
 * Phone, email and password are shown but not editable. Changing a sign-in
 * method has to re-authenticate first (docs/01 § 18) - without that step an
 * open tab on a borrowed laptop is an account takeover, so the rows report
 * rather than pretend.
 */
export function AccountScreen() {
  const auth = useAuth();
  const { session } = auth;
  const confirm = useConfirm();
  const signOut = useSignOut();
  const { profile, service, update } = useProfile();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // Seeded once the profile arrives, not on every render, so typing survives.
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setUsername(profile.username);
  }, [profile]);

  if (!profile) {
    return (
      <SettingsPage title="Account">
        <div className="grid place-items-center py-16">
          <PingoDot state="loading" size={7} label="Loading" />
        </div>
      </SettingsPage>
    );
  }

  const trimmedName = displayName.trim();
  const cleanUsername = normaliseUsername(username);
  const dirty = trimmedName !== profile.displayName || cleanUsername !== profile.username;
  const valid =
    trimmedName.length > 0 && trimmedName.length <= 50 && isValidUsername(cleanUsername);

  const save = async () => {
    if (!dirty || !valid || saving) return;

    setSaving(true);
    setError(undefined);
    setStatus(undefined);

    try {
      await update({ displayName: trimmedName, username: cleanUsername });
      setStatus('Saved.');
    } catch (cause) {
      setError(
        cause instanceof ProfileError && cause.code === 'username_taken'
          ? 'That username is taken.'
          : "That didn't save. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const changePhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(undefined);

    try {
      const url = await service.uploadAvatar(file);
      await update({ avatarUrl: url });
      setStatus('Photo updated.');
    } catch {
      setError("That photo didn't upload.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsPage title="Account">
      <div className="mb-7 flex flex-col items-center">
        <span className="relative">
          <Avatar
            name={profile.displayName}
            id={profile.id}
            src={profile.avatarUrl}
            size="xl"
          />
          {uploading && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-surface/70">
              <PingoDot state="loading" size={6} label="Uploading" />
            </span>
          )}
        </span>

        <Button
          variant="text"
          size="md"
          className="mt-3"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          Change photo
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void changePhoto(event.target.files?.[0])}
        />
      </div>

      <Group title="Profile">
        <div className="px-3 py-3">
          <TextField
            label="Name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={50}
            autoCapitalize="words"
            autoCorrect="off"
          />
        </div>
        <div className="px-3 py-3">
          <TextField
            label="Username"
            value={username}
            onChange={(event) => setUsername(normaliseUsername(event.target.value))}
            leading={<span className="text-body text-text-secondary">@</span>}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            hint={
              cleanUsername.length > 0 && !isValidUsername(cleanUsername)
                ? '3-20 characters. Letters, numbers and underscores.'
                : `pingo.chat/${cleanUsername}`
            }
            invalid={cleanUsername.length > 0 && !isValidUsername(cleanUsername)}
          />
        </div>
      </Group>

      {(status || error) && (
        <p
          role="status"
          className={cn('mb-4 px-1 text-caption', error ? 'text-danger' : 'text-text-secondary')}
        >
          {error ?? status}
        </p>
      )}

      <Button
        variant="primary"
        size="lg"
        block
        className="mb-7"
        disabled={!dirty || !valid}
        loading={saving}
        onClick={save}
      >
        Save changes
      </Button>

      <Group
        title="Sign-in methods"
        note="Changing one of these has to re-authenticate first, which is not built yet, so these are shown, not editable."
      >
        <InfoRow label="Phone" value={session?.user.phone ?? 'Not added'} />
        <InfoRow label="Email" value={session?.user.email ?? 'Not added'} />
        <InfoRow label="Password" value="••••••••" />
      </Group>

      <Group
        title="Danger zone"
        note="Deleting an account has to remove messages other people are still holding a copy of, so it needs server-side work before it can be offered honestly."
      >
        <InfoRow label="Logout" onClick={() => void signOut()} destructive />
        <InfoRow
          label="Clear local data"
          onClick={() => {
            /*
             * The shared-device answer, now that logging out no longer wipes
             * anything. Stated in full because it is the one action here that
             * destroys something the server cannot give back.
             */
            void (async () => {
              const go = await confirm({
                title: 'Clear local data?',
                description:
                  'Removes the chats saved on this device and the key that unlocks your end-to-end encrypted messages. Those messages will no longer be readable here, and no backup exists yet. Everything else is still on the server.',
                confirmLabel: 'Clear',
              });
              if (!go) return;
              await auth.service.clearLocalData();
              window.location.reload();
            })();
          }}
          destructive
        />
        <InfoRow label="Delete Account" destructive />
      </Group>
    </SettingsPage>
  );
}
