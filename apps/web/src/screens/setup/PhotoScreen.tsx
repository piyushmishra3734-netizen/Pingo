import { useProfile } from '@pingo/core';
import { Avatar, Button, PingoDot } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { SETUP_PROGRESS } from './progress.js';

/**
 * Setup, step 3 — the photo.
 *
 *   Add Profile Photo
 *   ◉
 *   Take Photo · Choose Gallery · Skip
 *
 * **The photo is optional and the screen says so.** The default is the live
 * monogram with its real deterministic gradient — presented as *a default*, not
 * an empty slot ([docs/01 § 9.1](../../../../../docs/01-onboarding-auth.md#91-the-photo-is-optional--and-the-design-says-so)).
 * Most drop-off at a photo step is people who do not have one they like, and
 * removing that pressure is worth more than a filled avatar.
 *
 * ## Take Photo, honestly
 *
 * On the web both buttons are file inputs; the difference is `capture="user"`,
 * which asks the OS for the front camera. **On a phone that opens the camera. On
 * a desktop browser it opens the file picker**, because there is no camera
 * intent to hand off to — the button is kept rather than hidden, so the flow
 * matches the phone it was designed for, and it degrades to something that
 * still works rather than to an error.
 *
 * The profile row already exists by now, so this is an update. Skip leaves it
 * exactly as it is.
 */

/** Guards the upload path and the storage bill. */
const MAX_BYTES = 5 * 1024 * 1024;

export function PhotoScreen() {
  const navigate = useNavigate();
  const { service, profile, update } = useProfile();

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | undefined>(profile?.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // A blob URL is a document-lifetime resource; without this the preview leaks
  // for as long as the tab is open.
  const objectUrl = useRef<string | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const choose = async (file: File | undefined) => {
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError('That image is over 5 MB. Try a smaller one.');
      return;
    }

    setError(undefined);
    setUploading(true);

    // Shown immediately, from the local file — the upload does not gate it.
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);

    try {
      const url = await service.uploadAvatar(file);
      await update({ avatarUrl: url });
      setPreview(url);
    } catch {
      setError("That didn't upload. Try again, or skip for now.");
      setPreview(profile?.avatarUrl);
    } finally {
      setUploading(false);
    }
  };

  const next = () => navigate('/setup/permissions', { replace: true });

  return (
    <AuthScreen
      progress={SETUP_PROGRESS.photo}
      title="Add Profile Photo"
      showBack={false}
      message={error && <AuthMessage>{error}</AuthMessage>}
      footer={
        <div className="flex flex-col gap-3">
          <Button variant="primary" size="lg" block onClick={next} disabled={uploading}>
            Continue
          </Button>
          {/*
            A text button, never hidden — § 2.1 lists the photo as skippable and
            requires skips to be visible rather than tucked away.
          */}
          <Button variant="text" size="lg" block onClick={next} disabled={uploading}>
            Skip
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center">
        <div className="relative">
          <Avatar
            name={profile?.displayName ?? 'PINGO'}
            id={profile?.id}
            src={preview}
            size="2xl"
          />
          {uploading && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-surface/70">
              <PingoDot state="loading" size={7} label="Uploading" />
            </span>
          )}
        </div>

        <p className="mt-6 max-w-[19rem] text-center text-body text-text-secondary">
          Add a photo — or keep your monogram, it looks good.
        </p>

        <div className="mt-7 flex w-full flex-col gap-3">
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
          >
            Take Photo
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={uploading}
            onClick={() => galleryRef.current?.click()}
          >
            Choose Gallery
          </Button>
        </div>

        {/* Both hidden: the buttons above are the affordance. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
    </AuthScreen>
  );
}
