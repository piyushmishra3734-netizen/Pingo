import { useChat } from '@pingo/core';
import { CheckIcon, cn } from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ScreenHeader } from '../../components/ScreenHeader.js';
import { useT } from '../../features/i18n/useT.js';
import {
  MAX_SHARED_WALLPAPER_BYTES,
  WALLPAPERS,
  chosenGlobalWallpaperId,
  chosenWallpaperId,
  customWallpaperPhoto,
  globalCustomWallpaperPhoto,
  hydrateWallpaper,
  markSharedWallpaperCached,
  onWallpaperChange,
  prepareSharedWallpaperPhoto,
  setGlobalWallpaper,
  setGlobalWallpaperPhoto,
  setWallpaper,
  setWallpaperPhoto,
  type WallpaperScope,
} from '../../features/chat/wallpaper.js';
import { rainSoundEnabled, setRainSoundEnabled } from '../../features/chat/rain-sound.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

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
 *
 * ## Scoped to a chat when opened from one
 *
 * `?c=<conversationId>` means this pick applies only to that thread. Direct
 * chats store the choice on this device; groups push it to the server so every
 * member sees the same room. Without `?c=` the page still sets the global
 * default used for chats that have never been personalised.
 */
export function WallpaperScreen() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get('c') ?? undefined;
  const { conversations, service, currentUser } = useChat();

  const conversation = useMemo(
    () => (conversationId ? conversations.find((c) => c.id === conversationId) : undefined),
    [conversations, conversationId],
  );

  const isGroup =
    conversation?.kind === 'group' || conversation?.kind === 'community';

  const scope: WallpaperScope | undefined = conversationId
    ? {
        conversationId,
        shared: isGroup,
        ...(conversation?.wallpaperId ? { serverWallpaperId: conversation.wallpaperId } : {}),
        ...(conversation?.wallpaperPhotoUrl
          ? { serverWallpaperPhotoUrl: conversation.wallpaperPhotoUrl }
          : {}),
      }
    : undefined;

  const [chosen, setChosen] = useState(() =>
    scope ? chosenWallpaperId(scope) : chosenGlobalWallpaperId(),
  );
  const [photo, setPhoto] = useState(() =>
    scope ? customWallpaperPhoto(scope) : globalCustomWallpaperPhoto(),
  );
  const [sound, setSound] = useState(rainSoundEnabled);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (conversationId) {
      hydrateWallpaper(
        conversationId,
        isGroup ? conversation?.wallpaperPhotoUrl : undefined,
      );
    }
  }, [conversationId, isGroup, conversation?.wallpaperPhotoUrl]);

  /*
   * The original arrives after this screen has already rendered, since
   * IndexedDB is opened asynchronously. Without this the swatch would keep
   * showing the small preview - and on a GIF, a still one - until the screen
   * was left and come back to.
   *
   * Groups also refresh when the shared row changes under us.
   */
  useEffect(
    () =>
      onWallpaperChange(() => {
        if (scope) {
          setPhoto(customWallpaperPhoto(scope));
          setChosen(chosenWallpaperId(scope));
        } else {
          setChosen(chosenGlobalWallpaperId());
        }
      }),
    // scope fields are recreated; conversation ids are the real deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, isGroup, conversation?.wallpaperId, conversation?.wallpaperPhotoUrl],
  );

  useEffect(() => {
    if (!scope) return;
    setChosen(chosenWallpaperId(scope));
    setPhoto(customWallpaperPhoto(scope));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isGroup, conversation?.wallpaperId, conversation?.wallpaperPhotoUrl]);

  const applyPreset = async (id: string) => {
    if (id === 'custom' && !photo) {
      fileRef.current?.click();
      return;
    }

    setError(undefined);

    if (!conversationId) {
      setGlobalWallpaper(id);
      setChosen(id);
      return;
    }

    if (isGroup) {
      setBusy(true);
      try {
        await service.setGroupWallpaper(
          conversationId,
          id,
          id === 'custom' ? photo : undefined,
        );
        setChosen(id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
      return;
    }

    setWallpaper(conversationId, id);
    setChosen(id);
  };

  /**
   * Group custom wallpaper.
   *
   * 1. Original file stays on *this* device (GIF intact, full size).
   * 2. Same original is uploaded once so other members can find the URL.
   * 3. Each member downloads the original onto *their* device the first time
   *    they open the group — after that it plays from local storage, not as a
   *    live stream from the server every open.
   */
  const uploadSharedPhoto = async (
    file: File,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!conversationId || !currentUser) {
      return { ok: false, reason: 'That picture could not be used.' };
    }

    if (file.size > MAX_SHARED_WALLPAPER_BYTES) {
      const mb = Math.round(MAX_SHARED_WALLPAPER_BYTES / (1024 * 1024));
      return {
        ok: false,
        reason: `That file is too large for a wallpaper (max ${mb} MB). Try a shorter GIF or a smaller photo.`,
      };
    }

    // 1) Identical to a normal chat: original file on this device, GIF intact.
    const localOk = await setWallpaperPhoto(conversationId, file);
    if (!localOk) {
      return { ok: false, reason: 'That picture could not be saved on this device.' };
    }
    setPhoto(customWallpaperPhoto(conversationId));
    setChosen('custom');

    // 2) Share the same original bytes so other members can download them once.
    const prepared = await prepareSharedWallpaperPhoto(file);
    if (!prepared) {
      return {
        ok: false,
        reason: 'Saved here, but could not prepare a copy for the group.',
      };
    }

    const client = getSupabaseClient();
    // Long cache: members keep a local copy; URL is only the first hop.
    const path = `${currentUser.id}/wallpapers/${conversationId}/${crypto.randomUUID()}.${prepared.ext}`;
    const { error: upErr } = await client.storage.from('avatars').upload(path, prepared.blob, {
      contentType: prepared.contentType,
      cacheControl: '31536000',
      upsert: false,
    });
    if (upErr) {
      return {
        ok: false,
        reason:
          upErr.message ||
          'Saved on this device, but upload failed — check your connection and try again.',
      };
    }

    const { data } = client.storage.from('avatars').getPublicUrl(path);
    const url = data.publicUrl;
    try {
      await service.setGroupWallpaper(conversationId, 'custom', url);
    } catch (cause) {
      return {
        ok: false,
        reason: cause instanceof Error ? cause.message : 'Could not save wallpaper for the group.',
      };
    }
    // Uploader already has the original; mark source so we do not re-download.
    markSharedWallpaperCached(conversationId, url);
    setPhoto(customWallpaperPhoto(conversationId));
    setChosen('custom');
    return { ok: true };
  };

  const onPickFile = async (file: File) => {
    setError(undefined);
    setBusy(true);
    try {
      if (isGroup && conversationId) {
        const result = await uploadSharedPhoto(file);
        if (!result.ok) setError(result.reason);
        return;
      }

      if (!conversationId) {
        const ok = await setGlobalWallpaperPhoto(file);
        if (!ok) {
          setError('That picture could not be used. Try a smaller one.');
          return;
        }
        setPhoto(globalCustomWallpaperPhoto());
        setChosen('custom');
        return;
      }

      // Direct chat: original blob only (this is the path groups now mirror).
      const ok = await setWallpaperPhoto(conversationId, file);
      if (!ok) {
        setError('That picture could not be used. Try a smaller one.');
        return;
      }
      setPhoto(customWallpaperPhoto(conversationId));
      setChosen('custom');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That picture could not be used.');
    } finally {
      setBusy(false);
    }
  };

  const subtitle = !conversationId
    ? 'Default for chats that have not been personalised yet. Open a chat menu to set a wallpaper for that chat only.'
    : isGroup
      ? 'Shared with the group at full original quality (GIFs included). Each member downloads it once onto their own device when they open the chat — it is not re-streamed from the server every time.'
      : 'Only for this chat, on this device. Other people keep their own backdrop.';

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <ScreenHeader title={t('page.wallpaper')} showBack />

      {/*
        Held to a column, and clear of the dock.

        Stretched to a desktop width the swatches became six enormous panels -
        a wallpaper is previewed at the size of a phone, because that is the
        thing it will be behind. `pb-28` is what the other settings pages use
        to keep their last row above the tab bar.
      */}
      <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto px-4 pt-1 pb-28">
        <p className="pb-4 text-caption text-text-secondary">{subtitle}</p>

        {conversation && (
          <p className="mb-4 truncate text-caption font-medium text-ink">
            {conversation.title}
          </p>
        )}

        {error && (
          <p role="alert" className="mb-3 text-caption text-danger">
            {error}
          </p>
        )}

        {/*
          Only while it is raining, because it is the only thing that makes a
          sound. A switch for something that cannot happen is a switch that
          teaches somebody the setting does nothing.
        */}
        {chosen === 'rain' && (
          <button
            type="button"
            role="switch"
            aria-checked={sound}
            onClick={() => {
              setRainSoundEnabled(!sound);
              setSound(!sound);
            }}
            className={cn(
              'focus-ring mb-4 flex w-full items-center justify-between rounded-xl',
              'border border-line px-4 py-3 text-left',
              'transition-colors duration-instant hover:bg-hover',
            )}
          >
            <span className="text-body text-ink">Rain sound</span>
            <span className="text-caption text-text-secondary">
              {sound ? 'On, quietly' : 'Off'}
            </span>
          </button>
        )}

        <div className="grid grid-cols-3 gap-3">
          {WALLPAPERS.map((wallpaper) => {
            const isCustom = wallpaper.id === 'custom';
            const image = isCustom
              ? undefined
              : wallpaper.css;
            const selected = chosen === wallpaper.id;

            return (
              <button
                key={wallpaper.id}
                type="button"
                disabled={busy}
                onClick={() => void applyPreset(wallpaper.id)}
                aria-pressed={selected}
                className={cn(
                  'focus-ring relative aspect-[3/4] overflow-hidden rounded-xl text-left',
                  'transition-transform duration-instant active:scale-[0.98]',
                  selected ? 'ring-2 ring-brand ring-offset-2 ring-offset-page' : 'ring-1 ring-line',
                  busy && 'opacity-70',
                )}
                style={{
                  backgroundColor: wallpaper.dark ? '#14151d' : 'var(--color-page)',
                  ...(image
                    ? { backgroundImage: image, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : {}),
                }}
              >
                {/*
                  Custom photos use <img> so GIFs animate in the swatch (and
                  match the chat thread, which also avoids CSS background GIFs).
                */}
                {isCustom && photo ? (
                  <img
                    src={photo}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  />
                ) : null}
                {/*
                  A message on every swatch. The question a wallpaper has to
                  answer is whether words survive on it, and a bare rectangle
                  of colour does not ask that question.
                */}
                <span
                  className={cn(
                    'glass-surface absolute right-3 bottom-9 left-3 z-[1] rounded-lg px-2.5 py-1.5',
                    'text-caption',
                    wallpaper.dark ? 'text-white' : 'text-ink',
                  )}
                >
                  Looks good
                </span>

                <span
                  className={cn(
                    'absolute inset-x-0 bottom-0 z-[1] px-3 py-2 text-caption font-medium',
                    'bg-surface/85 backdrop-blur-glass text-ink',
                  )}
                >
                  {isCustom && !photo ? 'Choose a photo' : wallpaper.name}
                </span>

                {selected && (
                  <span
                    aria-hidden
                    className="absolute top-2 right-2 z-[1] grid size-6 place-items-center rounded-full bg-brand text-on-brand"
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
            disabled={busy}
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
          accept="image/*,image/gif,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared first, so picking the same file twice still fires.
            event.target.value = '';
            if (!file) return;
            void onPickFile(file);
          }}
        />
      </div>
    </div>
  );
}
