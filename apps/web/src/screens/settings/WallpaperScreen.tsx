import { CheckIcon, cn } from '@pingo/ui';
import { useRef, useState } from 'react';

import { ScreenHeader } from '../../components/ScreenHeader.js';
import {
  WALLPAPERS,
  chosenWallpaperId,
  customWallpaperPhoto,
  setWallpaper,
  setWallpaperPhoto,
} from '../../features/chat/wallpaper.js';

/**
 * Choosing what sits behind a conversation.
 *
 * ## Shown, not named
 *
 * Every option is rendered as the thing itself with a message on it, because a
 * wallpaper is entirely a question of how it looks and a row of words would
 * make somebody try each one to find out. The bubble in each swatch is the
 * point: what matters is not whether the picture is nice, it is whether a
 * message is still easy to read on it.
 */
export function WallpaperScreen() {
  const [chosen, setChosen] = useState(chosenWallpaperId);
  const [photo, setPhoto] = useState(customWallpaperPhoto);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (id: string) => {
    if (id === 'custom' && !photo) {
      fileRef.current?.click();
      return;
    }
    setWallpaper(id);
    setChosen(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <ScreenHeader title="Chat wallpaper" showBack />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <p className="pt-1 pb-4 text-caption text-text-secondary">
          What sits behind your conversations. It is the same on every chat, and
          it is stored on this device only.
        </p>

        {error && (
          <p role="alert" className="mb-3 text-caption text-danger">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {WALLPAPERS.map((wallpaper) => {
            const isCustom = wallpaper.id === 'custom';
            const image = isCustom
              ? photo
                ? `url(${JSON.stringify(photo)})`
                : undefined
              : wallpaper.css;
            const selected = chosen === wallpaper.id;

            return (
              <button
                key={wallpaper.id}
                type="button"
                onClick={() => pick(wallpaper.id)}
                aria-pressed={selected}
                className={cn(
                  'focus-ring relative aspect-[3/4] overflow-hidden rounded-xl text-left',
                  'transition-transform duration-instant active:scale-[0.98]',
                  selected ? 'ring-2 ring-brand ring-offset-2 ring-offset-page' : 'ring-1 ring-line',
                )}
                style={{
                  backgroundColor: wallpaper.dark ? '#14151d' : 'var(--color-page)',
                  ...(image ? { backgroundImage: image, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
                }}
              >
                {/*
                  A message on every swatch. The question a wallpaper has to
                  answer is whether words survive on it, and a bare rectangle
                  of colour does not ask that question.
                */}
                <span
                  className={cn(
                    'glass-surface absolute right-3 bottom-9 left-3 rounded-lg px-2.5 py-1.5',
                    'text-caption',
                    wallpaper.dark ? 'text-white' : 'text-ink',
                  )}
                >
                  Looks good
                </span>

                <span
                  className={cn(
                    'absolute inset-x-0 bottom-0 px-3 py-2 text-caption font-medium',
                    'bg-surface/85 backdrop-blur-glass text-ink',
                  )}
                >
                  {isCustom && !photo ? 'Choose a photo' : wallpaper.name}
                </span>

                {selected && (
                  <span
                    aria-hidden
                    className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-brand text-white"
                  >
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Replacing an existing photo, without having to clear it first. */}
        {photo && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              'focus-ring mt-4 w-full rounded-xl border border-line py-3',
              'text-body text-brand transition-colors duration-instant hover:bg-hover',
            )}
          >
            Choose a different photo
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared first, so picking the same file twice still fires.
            event.target.value = '';
            if (!file) return;
            setError(undefined);
            void setWallpaperPhoto(file).then((ok) => {
              if (!ok) {
                setError('That picture could not be used. Try a smaller one.');
                return;
              }
              setPhoto(customWallpaperPhoto());
              setChosen('custom');
            });
          }}
        />
      </div>
    </div>
  );
}
