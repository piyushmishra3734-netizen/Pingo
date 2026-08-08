import { useProfile } from '@pingo/core';
import { Avatar, Button, PingoDot } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthMessage, AuthScreen } from '../../features/auth/AuthScreen.js';
import { useT } from '../../features/i18n/useT.js';
import { AvatarPhotoEditor } from '../../features/profile/AvatarPhotoEditor.js';
import { SETUP_PROGRESS } from './progress.js';

/**
 * Setup, step 3 - the photo.
 *
 *   Add Profile Photo
 *   ◉
 *   Take Photo · Choose Gallery · Skip
 *
 * Choosing a file opens the circular crop editor. Upload only runs after Save
 * in the editor - cancel discards the pick and leaves the monogram alone.
 *
 * **The photo is optional and the screen says so.** The default is the live
 * monogram with its real deterministic gradient - presented as *a default*, not
 * an empty slot ([docs/01 § 9.1](../../../../../docs/01-onboarding-auth.md#91-the-photo-is-optional--and-the-design-says-so)).
 */

/** Guards the upload path and the storage bill. */
const MAX_BYTES = 8 * 1024 * 1024;

export function PhotoScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { service, profile, update } = useProfile();

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | undefined>(profile?.avatarUrl);
  const [editorSrc, setEditorSrc] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const objectUrl = useRef<string | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (editorSrc) URL.revokeObjectURL(editorSrc);
    };
  }, [editorSrc]);

  const openEditor = (file: File) => {
    if (file.size > MAX_BYTES) {
      setError('That image is over 8 MB. Try a smaller one.');
      return;
    }
    setError(undefined);
    if (editorSrc) URL.revokeObjectURL(editorSrc);
    setEditorSrc(URL.createObjectURL(file));
  };

  const closeEditor = () => {
    if (editorSrc) URL.revokeObjectURL(editorSrc);
    setEditorSrc(undefined);
  };

  const commitCrop = async (file: File) => {
    setUploading(true);
    setError(undefined);

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);

    try {
      const url = await service.uploadAvatar(file);
      await update({ avatarUrl: url });
      setPreview(url);
      // Editor shows ✓ then closes via onCancel.
    } catch {
      setError("That didn't upload. Try again, or skip for now.");
      setPreview(profile?.avatarUrl);
      throw new Error('upload failed');
    } finally {
      setUploading(false);
    }
  };

  const next = () => navigate('/setup/permissions', { replace: true });

  return (
    <>
      {editorSrc && (
        <AvatarPhotoEditor
          src={editorSrc}
          onCancel={closeEditor}
          onChooseAnother={() => galleryRef.current?.click()}
          onSave={(file) => void commitCrop(file)}
          {...(profile?.avatarUrl || preview
            ? {
                onRemove: async () => {
                  setUploading(true);
                  setError(undefined);
                  try {
                    await update({ avatarUrl: undefined });
                    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
                    objectUrl.current = undefined;
                    setPreview(undefined);
                  } catch {
                    setError("Couldn't remove that photo. Try again.");
                    throw new Error('remove failed');
                  } finally {
                    setUploading(false);
                  }
                },
              }
            : {})}
        />
      )}

      <AuthScreen
        progress={SETUP_PROGRESS.photo}
        title={t('setup.photoTitle')}
        showBack={false}
        message={error && <AuthMessage>{error}</AuthMessage>}
        footer={
          <div className="flex flex-col gap-3">
            <Button variant="primary" size="lg" block onClick={next} disabled={uploading}>
              Continue
            </Button>
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
            Add a photo, or keep your monogram. It looks good.
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

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) openEditor(file);
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) openEditor(file);
            }}
          />
        </div>
      </AuthScreen>
    </>
  );
}
