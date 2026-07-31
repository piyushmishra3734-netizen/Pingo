import { isValidUsername, normaliseUsername, useProfile } from '@pingo/core';
import { Avatar, Button, CameraIcon, TextField, TrashIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { AvatarPhotoEditor } from '../features/profile/AvatarPhotoEditor.js';

/**
 * Editing your own profile: photo, name, username, bio.
 *
 * Exactly the four things a profile is, and nothing else. Settings, privacy and
 * account controls live on the settings screen - putting one of them here
 * because it is "profile-ish" is how a form becomes a second settings screen.
 *
 * ## Why the username is checked while typing but written on save
 *
 * Availability is advisory: two people can pass the check in the same second,
 * and the unique index is the real arbiter. Checking as you type is so the
 * answer arrives before the Save button does, not so the answer can be trusted  - 
 * `update` still handles `username_taken` coming back from the database.
 *
 * ## Why nothing is written until Save
 *
 * A profile is a small form and every field is visible at once, so a per-field
 * autosave would mean four writes to change three things, and a half-applied
 * profile if the connection drops in the middle. One button, one write.
 */

const BIO_LIMIT = 200;

export function EditProfileScreen() {
  const { profile, update, service } = useProfile();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  /** Cropped file from the editor, held until form Save so nothing uploads early. */
  const [photo, setPhoto] = useState<File>();
  const [removePhoto, setRemovePhoto] = useState(false);
  /** Object URL for the file currently open in the crop editor. */
  const [editorSrc, setEditorSrc] = useState<string>();

  const [available, setAvailable] = useState<boolean>();
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const fileRef = useRef<HTMLInputElement>(null);

  // Loaded once the profile arrives, and only then - seeding from an undefined
  // profile would blank the form for anyone who lands here on a slow connection.
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setUsername(profile.username);
    setBio(profile.bio ?? '');
  }, [profile]);

  const preview = photo ? URL.createObjectURL(photo) : undefined;
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    return () => {
      if (editorSrc) URL.revokeObjectURL(editorSrc);
    };
  }, [editorSrc]);

  const openEditor = (file: File) => {
    if (editorSrc) URL.revokeObjectURL(editorSrc);
    setEditorSrc(URL.createObjectURL(file));
  };

  const closeEditor = () => {
    if (editorSrc) URL.revokeObjectURL(editorSrc);
    setEditorSrc(undefined);
  };

  const handle = normaliseUsername(username);
  const unchangedHandle = handle === profile?.username;
  const handleValid = isValidUsername(handle);

  useEffect(() => {
    if (!handleValid || unchangedHandle) {
      setAvailable(undefined);
      return;
    }

    // Debounced: a request per keystroke would be a dozen for one username, and
    // they would arrive out of order.
    let active = true;
    setChecking(true);
    const id = window.setTimeout(() => {
      void service
        .isUsernameAvailable(handle)
        .then((free) => {
          if (active) setAvailable(free);
        })
        .catch(() => {
          if (active) setAvailable(undefined);
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(id);
    };
  }, [service, handle, handleValid, unchangedHandle]);

  const nameValid = displayName.trim().length > 0 && displayName.trim().length <= 50;
  const canSave =
    nameValid && handleValid && (unchangedHandle || available !== false) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(undefined);

    try {
      let avatarUrl: string | null | undefined;
      if (removePhoto) avatarUrl = null;
      else if (photo) avatarUrl = await service.uploadAvatar(photo);

      await update({
        displayName: displayName.trim(),
        username: handle,
        bio,
        // Only sent when it actually changed, so an unrelated save cannot clear
        // a photo that was uploaded from another device in the meantime.
        ...(avatarUrl === undefined ? {} : { avatarUrl: avatarUrl ?? undefined }),
      });

      navigate('/profile', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not save. Try again.');
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <div className="h-full overflow-y-auto">
        <ScreenHeader title="Edit profile" showBack />
      </div>
    );
  }

  const shownAvatar = removePhoto ? undefined : (preview ?? profile.avatarUrl);

  return (
    <div className="h-full overflow-y-auto">
      {editorSrc && (
        <AvatarPhotoEditor
          src={editorSrc}
          onCancel={closeEditor}
          onChooseAnother={() => fileRef.current?.click()}
          onSave={(file) => {
            // Editor flashes ✓ then calls onCancel to unmount.
            setPhoto(file);
            setRemovePhoto(false);
          }}
          {...(profile.avatarUrl || photo
            ? {
                onRemove: () => {
                  setPhoto(undefined);
                  setRemovePhoto(true);
                },
              }
            : {})}
        />
      )}
      <ScreenHeader
        title="Edit profile"
        showBack
        action={
          <Button variant="text" size="sm" onClick={() => void save()} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-md px-5 pb-10">
        {/* ---- photo ---------------------------------------------------- */}
        <div className="flex flex-col items-center pt-6">
          <Avatar name={displayName || profile.displayName} id={profile.id} src={shownAvatar} size="xl" />

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change.
              event.target.value = '';
              if (file) openEditor(file);
            }}
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'focus-ring flex items-center gap-1.5 rounded-full px-4 py-2',
                'text-caption font-medium text-brand hover:bg-hover',
              )}
            >
              <CameraIcon size={16} />
              {shownAvatar ? 'Change photo' : 'Add photo'}
            </button>

            {shownAvatar && (
              <button
                type="button"
                onClick={() => {
                  setPhoto(undefined);
                  setRemovePhoto(true);
                }}
                className={cn(
                  'focus-ring flex items-center gap-1.5 rounded-full px-4 py-2',
                  'text-caption font-medium text-danger hover:bg-hover',
                )}
              >
                <TrashIcon size={16} />
                Remove
              </button>
            )}
          </div>
        </div>

        {/* ---- fields --------------------------------------------------- */}
        <div className="mt-6 space-y-5">
          <TextField
            label="Name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={50}
            invalid={displayName.length > 0 && !nameValid}
            hint={
              displayName.trim().length === 0
                ? 'People need something to call you.'
                : undefined
            }
          />

          <TextField
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            leading={<span className="text-text-tertiary">@</span>}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            invalid={username.length > 0 && (!handleValid || available === false)}
            hint={
              username.length === 0
                ? undefined
                : !handleValid
                  ? '3 to 20 letters, numbers or underscores.'
                  : unchangedHandle
                    ? 'This is your current username.'
                    : checking
                      ? 'Checking…'
                      : available === true
                        ? 'Available.'
                        : available === false
                          ? 'That one is taken.'
                          : undefined
            }
          />

          <div>
            <label
              htmlFor="profile-bio"
              className="mb-2 block text-caption font-medium text-text-secondary"
            >
              Bio
            </label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(event) => setBio(event.target.value.slice(0, BIO_LIMIT))}
              rows={3}
              placeholder="A line about you. Emoji, a link, whatever fits."
              className={cn(
                'focus-ring w-full resize-none rounded-lg bg-surface px-4 py-3',
                'text-body text-ink placeholder:text-text-tertiary',
              )}
            />
            <p
              className={cn(
                'mt-1.5 text-right text-caption',
                bio.length >= BIO_LIMIT ? 'text-danger' : 'text-text-tertiary',
              )}
            >
              {bio.length}/{BIO_LIMIT}
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-center text-caption text-danger">
            {error}
          </p>
        )}

        {/*
          A second Save at the bottom of the form, because on a phone the header
          one is above the keyboard and out of reach of the thumb that just
          finished typing the bio.
        */}
        <Button
          variant="primary"
          className="mt-6 w-full"
          onClick={() => void save()}
          disabled={!canSave}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
