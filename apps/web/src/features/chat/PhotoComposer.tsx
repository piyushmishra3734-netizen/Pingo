import { useProfile } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';

import { SnapEditor } from '../camera/SnapEditor.js';
import { useT } from '../i18n/useT.js';

import { Overlay } from '../../components/Overlay.js';
import { isAnimatedImage } from './animated-image.js';
import { isStillImage, toStandardQuality } from './media-quality.js';

/**
 * Reviewing pictures before they are sent.
 *
 * ## One at a time, with the rest on a shelf
 *
 * Multi-select is normal - nobody picks one holiday photo - but editing several
 * at once is not a thing anyone does. So the batch is a filmstrip and exactly
 * one picture is being worked on, which keeps the editor identical to the
 * single-photo case rather than growing a second mode for "many".
 *
 * ## The caption belongs to the batch, not the picture
 *
 * WhatsApp attaches one caption per image; this attaches one to the send. Three
 * photos of the same thing want one sentence about them, and asking three times
 * is three chances to leave two blank. A per-photo caption is a reasonable thing
 * to want later, and the shape here does not prevent it.
 *
 * ## View limit is a property of the send
 *
 * "Keep in chat" or "View once" - the same control the schema models, so there
 * is no separate disappearing-photo feature with rules of its own.
 */

export interface PhotoComposerProps {
  files: File[];
  onCancel: () => void;
  /** Called once per picture, in order, with the flattened result. */
  onSend: (photos: Blob[], caption: string, viewLimit: number | undefined) => Promise<void>;
}

export function PhotoComposer({ files, onCancel, onSend }: PhotoComposerProps) {
  const t = useT();
  /** Object URLs, made once per file and revoked together. */
  const sources = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => sources.forEach(URL.revokeObjectURL), [sources]);

  const { profile } = useProfile();
  const premium = profile?.isPremium === true;
  /*
   * Off by default, for everybody. HD is the exception a person asks for, not
   * the setting they have to remember to turn off - which is the difference
   * between a feature and a bill.
   */
  const [hd, setHd] = useState(false);

  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState('');
  const [once, setOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /**
   * Pictures already flattened, by position.
   *
   * Kept so moving along the filmstrip and back does not lose the drawing on
   * the one you left - the editor is remounted per picture, and its state goes
   * with it.
   */
  const [edited, setEdited] = useState<Record<number, Blob>>({});

  /**
   * Which of these move, by position.
   *
   * Undefined until the bytes have been read - a moment, and a moment in which
   * the editor must not be shown, because showing tools and then taking them
   * away is worse than a beat of nothing. Reading the header is the only way to
   * know: a keyboard's stickers are WebP, and a WebP animates or does not
   * depending on a flag inside the file.
   */
  const [animated, setAnimated] = useState<boolean[]>();

  useEffect(() => {
    let live = true;
    void Promise.all(files.map(isAnimatedImage)).then((all) => {
      if (live) setAnimated(all);
    });
    return () => {
      live = false;
    };
  }, [files]);

  const last = index === sources.length - 1;

  const finish = async (blob: Blob) => {
    const all = { ...edited, [index]: blob };
    setEdited(all);

    if (!last) {
      setIndex((i) => i + 1);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      /*
       * Every picture, in the order they were chosen. Any the user skipped past
       * without editing are flattened by the editor anyway - or handed straight
       * back untouched, if they move - because reaching the end means each one
       * went through it.
       */
      const blobs = sources.map((_, position) => all[position]).filter(Boolean) as Blob[];

      /*
       * The resize happens here, after every edit, not on the way in.
       *
       * Drawing, cropping and text all work on the picture the user is looking
       * at, and shrinking first would have them editing a 480p preview of their
       * own photo. It also means one pass rather than one per edit.
       *
       * HD sends what the editor produced. Anything that is not a still - a GIF
       * or an animated sticker - is already untouched by the editor and stays
       * untouched here; see the note in `media-quality.ts`.
       */
      const sent =
        hd && premium
          ? blobs
          : await Promise.all(
              blobs.map(async (blob, position) =>
                isStillImage(blob)
                  ? await toStandardQuality(
                      new File([blob], files[position]?.name ?? 'photo', { type: blob.type }),
                    )
                  : blob,
              ),
            );

      await onSend(sent, caption.trim(), once ? 1 : undefined);
    } catch {
      setError('Those did not send. Try again.');
      setBusy(false);
    }
  };

  // A blank backdrop for the instant the headers are being read. See `animated`.
  if (!animated) {
    return (
      <Overlay onDismiss={onCancel}>
        <div className="fixed inset-0 z-500 bg-backdrop" />
      </Overlay>
    );
  }

  return (
    <Overlay onDismiss={onCancel}>
      <div className="fixed inset-0 z-500 bg-backdrop">
        <SnapEditor
          // Remounted per picture, so strokes and text never bleed across.
          key={index}
          src={sources[index]!}
          onCancel={onCancel}
          onDone={(blob) => void finish(blob)}
          // The original bytes when this one moves, which is what stops the
          // export turning a GIF into a picture of its first frame.
          {...(animated[index] ? { untouchable: files[index]! } : {})}
          busy={busy}
          doneLabel={last ? (sources.length > 1 ? 'Send all' : 'Send') : 'Next photo'}
          extras={
            <div className="space-y-2">
              {error && (
                <p role="alert" className="text-center text-caption text-danger">
                  {error}
                </p>
              )}

              {sources.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {sources.map((src, position) => (
                    <button
                      key={src}
                      type="button"
                      aria-label={`Photo ${position + 1} of ${sources.length}`}
                      aria-current={position === index}
                      // Only backwards: going forward is what the confirm button
                      // does, and it is the thing that flattens the current edit.
                      disabled={position > index}
                      onClick={() => setIndex(position)}
                      className={cn(
                        'focus-ring size-12 shrink-0 overflow-hidden rounded-lg',
                        'ring-2 transition-[opacity,box-shadow] duration-instant',
                        position === index ? 'ring-white' : 'ring-white/20',
                        position > index && 'opacity-40',
                      )}
                    >
                      <img src={src} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <input
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder={t('thread.caption')}
                aria-label={t('thread.caption')}
                maxLength={1000}
                className={cn(
                  'focus-ring w-full rounded-full border border-white/20 bg-white/10',
                  'px-4 py-2.5 text-body text-white placeholder:text-white/50',
                )}
              />

              {/*
                HD, and what it costs to say no.

                Shown to everybody rather than hidden from free accounts: a
                control that is not there teaches nothing, and the people most
                likely to want premium are exactly the ones who just noticed
                their photo got smaller. Tapping it without premium says so
                instead of silently doing nothing.
              */}
              <button
                type="button"
                role="switch"
                aria-checked={hd && premium}
                onClick={() => {
                  if (!premium) {
                    setError('HD is part of PINGO premium.');
                    return;
                  }
                  setError(undefined);
                  setHd((was) => !was);
                }}
                className={cn(
                  'focus-ring flex w-full items-center justify-between rounded-full',
                  'border border-white/20 px-4 py-2.5 text-left',
                  'transition-colors duration-instant',
                  hd && premium ? 'bg-white/20' : 'bg-transparent',
                  !premium && 'opacity-70',
                )}
              >
                <span className="text-body text-white">
                  HD{premium ? '' : ' ✦'}
                </span>
                <span className="text-caption text-white/60">
                  {!premium
                    ? 'Premium'
                    : hd
                      ? 'Original quality'
                      : 'Standard — smaller and faster'}
                </span>
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={once}
                onClick={() => setOnce((was) => !was)}
                className={cn(
                  'focus-ring flex w-full items-center justify-between rounded-full',
                  'border border-white/20 px-4 py-2.5 text-left',
                  'transition-colors duration-instant',
                  once ? 'bg-white/20' : 'bg-transparent',
                )}
              >
                <span className="text-body text-white">{t('thread.viewOnce')}</span>
                <span className="text-caption text-white/60">
                  {once ? 'Opens once, then gone' : 'Stays in the chat'}
                </span>
              </button>
            </div>
          }
        />
      </div>
    </Overlay>
  );
}
