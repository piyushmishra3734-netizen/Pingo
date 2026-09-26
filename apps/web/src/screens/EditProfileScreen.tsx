import { isValidUsername, normaliseUsername, useProfile } from '@pingo/core';
import { Avatar, Button, CameraIcon, TextField, TrashIcon, cn } from '@pingo/ui';
import { AtSign, Briefcase, MapPin } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { useT } from '../features/i18n/useT.js';
import { AvatarPhotoEditor } from '../features/profile/AvatarPhotoEditor.js';
import { ProfileCover } from '../features/profile/ProfileCover.js';
import { prepareCover } from '../features/profile/cover-gif.js';

/**
 * Editing your own profile: photo, cover, name, username, bio, work, place.
 *
 * Exactly the things a profile shows, and nothing else. Settings, privacy and
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
 *
 * ## One primary action
 *
 * Save lives at the bottom of the form - after the last field, under the thumb
 * that finished typing. A second Save in the header is two primaries; the
 * header stays navigation only.
 */

const BIO_LIMIT = 200;
/** A job title or a city, not a second bio. Matches the check constraint. */
const DETAIL_LIMIT = 40;
/** One tap for the common answers; anything else is typed. */
const WORK_CHIPS = ['Student', 'Developer', 'Designer', 'Creator', 'Gamer', 'Founder'];

export function EditProfileScreen() {
  const t = useT();
  const { profile, update, service } = useProfile();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [work, setWork] = useState('');
  const [place, setPlace] = useState('');
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
    setWork(profile.work ?? '');
    setPlace(profile.location ?? '');
  }, [profile]);

  /*
   * The cover is staged like the photo: nothing is uploaded until Save. Backing
   * out of this screen has to leave the profile exactly as it was, and a cover
   * that uploaded on pick would already have changed it.
   */
  const coverRef = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState<File>();
  const [coverOffset, setCoverOffset] = useState<number>();
  // A GIF is checked and, over 480p, re-encoded before it can be staged.
  const [preparingCover, setPreparingCover] = useState(false);

  const coverPreview = cover ? URL.createObjectURL(cover) : undefined;
  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

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
    nameValid &&
    handleValid &&
    (unchangedHandle || available !== false) &&
    !saving &&
    !preparingCover;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(undefined);

    try {
      let avatarUrl: string | null | undefined;
      if (removePhoto) avatarUrl = null;
      else if (photo) avatarUrl = await service.uploadAvatar(photo);

      let bannerUrl: string | undefined;
      if (cover) bannerUrl = await service.uploadCover(cover);

      await update({
        displayName: displayName.trim(),
        username: handle,
        bio,
        // Only when changed: a save that did not touch them should not write
        // columns an older database may not have yet.
        ...(work.trim() === (profile?.work ?? '') ? {} : { work }),
        ...(place.trim() === (profile?.location ?? '') ? {} : { location: place }),
        ...(bannerUrl ? { bannerUrl } : {}),
        ...(coverOffset === undefined ? {} : { bannerOffset: coverOffset }),
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
        <ScreenHeader title={t('profile.editTitle')} showBack />
      </div>
    );
  }

  const shownAvatar = removePhoto ? undefined : (preview ?? profile.avatarUrl);
  const hasPhoto = Boolean(shownAvatar);
  const shownName = displayName.trim() || 'Your name';

  return (
    <div className="h-full overflow-y-auto bg-page">
      {editorSrc && (
        <AvatarPhotoEditor
          src={editorSrc}
          onCancel={closeEditor}
          onChooseAnother={() => fileRef.current?.click()}
          onSave={(file) => {
            // Editor flashes a tick then calls onCancel to unmount.
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

      {/* Header is navigation only - one primary Save lives at the form foot. */}
      <ScreenHeader title={t('profile.editTitle')} showBack />

      <div className="mx-auto flex w-full max-w-md flex-col gap-2 px-2 pt-2">
        {/*
          The profile card itself, live.

          Every field below writes into it as it is typed, so the form answers
          "what will people see" without a round trip to the profile - the same
          card, the same cover fade, the same lines under the bio.
        */}
        <article className="rounded-[34px] bg-surface/70 p-[5px] ring-1 ring-line">
          <div className="relative overflow-hidden rounded-[29px] bg-surface">
            <ProfileCover
              src={coverPreview ?? profile.bannerUrl}
              offset={coverOffset ?? profile.bannerOffset}
              editable
              onPick={() => coverRef.current?.click()}
              onOffsetChange={setCoverOffset}
            />

            <div className="pointer-events-none relative px-[18px] pb-[18px] pt-[92px] [&>*]:pointer-events-auto">
              <div className="flex items-end justify-between gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label={hasPhoto ? 'Change photo' : 'Add photo'}
                  className="focus-ring relative inline-flex rounded-full ring-[3px] ring-surface transition-transform duration-instant active:scale-[0.97]"
                >
                  <Avatar name={shownName} id={profile.id} src={shownAvatar} size="xl" />
                  <span className="absolute -bottom-0.5 -right-0.5 grid size-8 place-items-center rounded-full border-[3px] border-surface bg-brand text-on-brand">
                    <CameraIcon size={14} />
                  </span>
                </button>

                {hasPhoto && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhoto(undefined);
                      setRemovePhoto(true);
                    }}
                    className={cn(
                      'focus-ring mb-2 flex items-center gap-1.5 rounded-full bg-sunken px-3.5 py-2',
                      'text-caption font-medium text-text-secondary',
                      'transition-colors duration-150 ease-standard hover:text-danger',
                    )}
                  >
                    <TrashIcon size={14} />
                    Remove photo
                  </button>
                )}
              </div>

              <h2 className="mt-3 truncate text-[24px] font-bold leading-tight tracking-[-0.04em] text-ink">
                {shownName}
              </h2>
              {bio.trim() && (
                <p className="mt-1 line-clamp-2 text-body leading-snug text-text-secondary">{bio}</p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-text-secondary">
                {handle && <Fact icon={<AtSign size={14} />}>{handle}</Fact>}
                {work.trim() && <Fact icon={<Briefcase size={14} />}>{work.trim()}</Fact>}
                {place.trim() && <Fact icon={<MapPin size={14} />}>{place.trim()}</Fact>}
              </div>
            </div>
          </div>
        </article>

        <input
          ref={coverRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setError(undefined);
            setPreparingCover(true);
            void prepareCover(file, profile?.isPremium === true).then((result) => {
              setPreparingCover(false);
              if (!result.ok) {
                setError(result.reason);
                return;
              }
              setCover(result.file);
              // A new picture starts centred; the old number described the old
              // photo and means nothing about this one.
              setCoverOffset(50);
            });
          }}
        />
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

        {/* Form hierarchy: display name primary, then username, then bio. */}
        <section className="space-y-4 rounded-[28px] bg-surface p-[18px]">
          <h3 className="text-body font-semibold text-ink">About you</h3>
          <TextField
            label={t('profile.displayName')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={50}
            autoComplete="name"
            invalid={displayName.length > 0 && !nameValid}
            labelClassName="text-caption font-medium text-text-secondary"
            fieldClassName="h-12"
            hint={displayName.trim().length === 0 ? 'People need something to call you.' : undefined}
          />

          <TextField
            label={t('profile.username')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            leading={<span className="text-text-tertiary">@</span>}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            invalid={username.length > 0 && (!handleValid || available === false)}
            labelClassName="text-caption font-medium text-text-secondary"
            fieldClassName="h-12"
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
              className="mb-1.5 block text-caption font-medium text-text-secondary"
            >
              Bio
            </label>
            <div
              className={cn(
                'relative rounded-xl border border-line/40 bg-sunken',
                'transition-[background-color,border-color,box-shadow] duration-150 ease-standard',
                'focus-within:border-brand/25 focus-within:bg-surface focus-within:shadow-sm',
              )}
            >
              <textarea
                id="profile-bio"
                value={bio}
                onChange={(event) => setBio(event.target.value.slice(0, BIO_LIMIT))}
                rows={3}
                maxLength={BIO_LIMIT}
                placeholder={t('profile.bioPlaceholder')}
                className={cn(
                  'w-full resize-none bg-transparent px-4 pt-3 pb-8',
                  'text-body text-ink outline-none placeholder:text-text-tertiary',
                )}
              />
              {/* Counter lives inside the field, bottom-right - not detached. */}
              <p
                className={cn(
                  'pointer-events-none absolute right-3 bottom-2.5 text-caption tabular-nums',
                  bio.length >= BIO_LIMIT ? 'text-danger/80' : 'text-text-tertiary',
                )}
              >
                {bio.length}/{BIO_LIMIT}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-[28px] bg-surface p-[18px]">
          <div>
            <h3 className="text-body font-semibold text-ink">Details</h3>
            <p className="mt-0.5 text-caption text-text-secondary">
              Shown under your bio. Leave one empty to hide it.
            </p>
          </div>

          <div>
            <TextField
              label="Work"
              value={work}
              onChange={(event) => setWork(event.target.value.slice(0, DETAIL_LIMIT))}
              leading={<Briefcase size={16} className="text-text-tertiary" />}
              maxLength={DETAIL_LIMIT}
              placeholder="What do you do?"
              labelClassName="text-caption font-medium text-text-secondary"
              fieldClassName="h-12"
            />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {WORK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={work.trim() === chip}
                  onClick={() => setWork(chip)}
                  className={cn(
                    'focus-ring h-8 rounded-full px-3 text-caption font-medium',
                    'transition-colors duration-instant active:scale-[0.97]',
                    work.trim() === chip ? 'bg-brand text-on-brand' : 'bg-sunken text-ink hover:bg-hover',
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          <TextField
            label="Location"
            value={place}
            onChange={(event) => setPlace(event.target.value.slice(0, DETAIL_LIMIT))}
            leading={<MapPin size={16} className="text-text-tertiary" />}
            maxLength={DETAIL_LIMIT}
            placeholder="City, Country"
            autoComplete="address-level2"
            labelClassName="text-caption font-medium text-text-secondary"
            fieldClassName="h-12"
          />
        </section>

        {error && (
          <p
            role="alert"
            className={cn(
              'rounded-xl border border-danger/20 bg-danger-soft/70',
              'px-3.5 py-2.5 text-center text-caption text-danger/90',
            )}
          >
            {error}
          </p>
        )}

        {/*
          One primary Save, held at the foot of the screen so it is under the
          thumb whichever field was touched last.
        */}
        <div className="sticky bottom-0 -mx-2 bg-gradient-to-b from-transparent to-page to-35% px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <Button
            variant="primary"
            className="h-12 w-full rounded-full"
            onClick={() => void save()}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One short fact under the bio, the same as on the profile. */
function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-text-tertiary">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}
