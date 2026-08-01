import { STORY_AUDIENCES, type StoryAudience, type StoryKind } from '@pingo/core';
import { CameraIcon, ImageIcon, LinkIcon, UsersIcon, cn } from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import { SnapEditor } from '../camera/SnapEditor.js';
import { PeoplePicker } from './PeoplePicker.js';
import { useStories } from './StoryContext.js';

/**
 * Making a story: pick something, work on it, decide who sees it, post.
 *
 * ## Three steps, and the third is not optional
 *
 * Source, edit, audience. The audience step is where the module's whole privacy
 * story either happens or does not - a "post" button that skipped it would make
 * `friends` the only audience anyone ever used, and the four we built would be
 * a settings screen nobody visits.
 *
 * It defaults to Friends, so the common case is still one extra tap and not a
 * decision.
 *
 * ## Why video skips the editor
 *
 * `SnapEditor` composites onto a canvas from a still image. Drawing on video
 * means compositing per frame and re-encoding, which is a different pipeline
 * with a different cost - not a flag on this one. A video story therefore goes
 * straight to the details step, where the caption, place and link still apply.
 * Better an honest gap than an editor whose tools silently do nothing.
 */

type Step = 'source' | 'edit' | 'details';

export function StoryComposer({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const { service, refresh } = useStories();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('source');
  const [picked, setPicked] = useState<{ file: File; kind: StoryKind }>();
  /** The flattened result of the editor, or the original for a video. */
  const [media, setMedia] = useState<Blob>();

  const [caption, setCaption] = useState('');
  const [place, setPlace] = useState('');
  const [link, setLink] = useState('');
  const [audience, setAudience] = useState<StoryAudience>('friends');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const fileRef = useRef<HTMLInputElement>(null);

  const src = useMemo(() => (picked ? URL.createObjectURL(picked.file) : undefined), [picked]);
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const take = (file: File) => {
    const kind: StoryKind = file.type.startsWith('video/') ? 'video' : 'photo';
    setPicked({ file, kind });
    if (kind === 'video') {
      setMedia(file);
      setStep('details');
    } else {
      setStep('edit');
    }
  };

  const post = async () => {
    if (!media || !picked || busy) return;

    if (audience === 'custom' && chosen.size === 0) {
      setError('Choose at least one person, or pick a different audience.');
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      await service.post({
        media,
        kind: picked.kind,
        audience,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(place.trim() ? { location: place.trim() } : {}),
        ...(link.trim() ? { linkUrl: normaliseLink(link) } : {}),
        ...(audience === 'custom' ? { audienceUserIds: [...chosen] } : {}),
      });
      await refresh();
      onPosted();
    } catch (cause) {
      // Surface the real reason - a silent "try again" hides RLS, upload and
      // empty-media failures that the user cannot otherwise diagnose.
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : 'That did not post. Try again.';
      setError(message);
      setBusy(false);
    }
  };

  // ---- step 1: where the media comes from ---------------------------------

  if (step === 'source') {
    return (
      <>
        <Sheet title="Add to your story" onClose={onClose}>
          <div className="mt-3 flex flex-col gap-1">
            <SheetItem
              icon={<CameraIcon size={20} />}
              label="Camera"
              hint="Take a photo now"
              onClick={() => {
                onClose();
                navigate('/camera');
              }}
            />
            <SheetItem
              icon={<ImageIcon size={20} />}
              label="Gallery"
              hint="A photo or a video from this device"
              onClick={() => fileRef.current?.click()}
            />
            <SheetCancel onClick={onClose} />
          </div>
        </Sheet>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the same file twice still fires a change.
            event.target.value = '';
            if (file) take(file);
          }}
        />
      </>
    );
  }

  // ---- step 2: the editor -------------------------------------------------

  if (step === 'edit' && src) {
    return (
      <Overlay>
        <div className="fixed inset-0 z-500 bg-ink">
          <SnapEditor
            src={src}
            onCancel={onClose}
            doneLabel="Next"
            onDone={(blob) => {
              setMedia(blob);
              setStep('details');
            }}
          />
        </div>
      </Overlay>
    );
  }

  // ---- step 3: what it says and who sees it -------------------------------

  if (choosing) {
    return (
      <Sheet
        title="Specific people"
        description="Only the people you tick will see this story."
        onClose={() => setChoosing(false)}
      >
        <PeoplePicker
          selected={chosen}
          onToggle={(userId, next) =>
            setChosen((previous) => {
              const updated = new Set(previous);
              if (next) updated.add(userId);
              else updated.delete(userId);
              return updated;
            })
          }
          emptyLabel="Nobody to choose yet."
        />
        <div className="mt-2">
          <SheetCancel onClick={() => setChoosing(false)} label={`Done (${chosen.size})`} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title="Post to your story"
      onClose={onClose}
      /*
        Craftsmanship only on this share sheet: warmer page wash, softer line,
        quieter brand-tinted lift. Radius and layout stay the product default.
      */
      className={cn(
        'border-line/55 bg-page',
        'shadow-[0_4px_20px_rgba(16,17,20,0.05),0_14px_36px_rgba(92,108,255,0.07)]',
      )}
    >
      {src && (
        <div className="mt-3 overflow-hidden rounded-xl bg-sunken/80 ring-1 ring-line/50">
          {picked?.kind === 'video' ? (
            <video src={src} className="max-h-48 w-full object-contain" muted playsInline />
          ) : (
            <img src={src} alt="" className="max-h-48 w-full object-contain" />
          )}
        </div>
      )}

      {/* Preview → caption tightened ~8–12px (was mt-3 + equal field weight). */}
      <div className="mt-2 space-y-1.5">
        <textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value.slice(0, 500))}
          rows={2}
          placeholder="Say something. @mentions and links work."
          aria-label="Caption"
          className={cn(
            // Primary field - most presence so the eye lands here first.
            'focus-ring w-full resize-none rounded-xl border border-line/70 bg-surface',
            'px-3.5 py-3 text-body text-ink placeholder:text-text-tertiary',
            'transition-[border-color,box-shadow] duration-150 ease-standard',
            'focus:border-brand/30 focus:shadow-sm',
          )}
        />

        <label
          className={cn(
            // Secondary - quieter wash, thinner edge.
            'flex items-center gap-2 rounded-xl border border-line/40 bg-sunken/70 px-3',
            'transition-colors duration-150 ease-standard focus-within:border-line/70',
          )}
        >
          <span aria-hidden className="text-text-tertiary">
            📍
          </span>
          <input
            value={place}
            onChange={(event) => setPlace(event.target.value.slice(0, 80))}
            placeholder="Add a place (optional)"
            aria-label="Place"
            className="min-w-0 flex-1 bg-transparent py-2 text-caption text-ink outline-none placeholder:text-text-tertiary"
          />
        </label>

        <label
          className={cn(
            // Tertiary - softest of the three.
            'flex items-center gap-2 rounded-xl border border-transparent bg-sunken/45 px-3',
            'transition-colors duration-150 ease-standard focus-within:border-line/40',
          )}
        >
          <LinkIcon size={15} className="shrink-0 text-text-tertiary" />
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Add a link (optional)"
            aria-label="Link"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2 text-caption text-ink outline-none placeholder:text-text-tertiary"
          />
        </label>
      </div>

      {/* ---- audience: selectable cards, not a settings list ------------- */}
      <fieldset className="mt-4">
        <legend className="mb-2 px-0.5 text-caption font-medium tracking-wide text-text-secondary">
          Who can see it
        </legend>

        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Audience">
          {STORY_AUDIENCES.map((option) => {
            const selected = audience === option.value;
            const closeSelected = option.value === 'close' && selected;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setAudience(option.value);
                  setError(undefined);
                  if (option.value === 'custom') setChoosing(true);
                }}
                className={cn(
                  'focus-ring flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left',
                  'border transition-[background-color,border-color,box-shadow] duration-150 ease-standard',
                  selected
                    ? closeSelected
                      ? 'border-online/30 bg-online/8 shadow-sm'
                      : 'border-brand/25 bg-selected shadow-sm'
                    : 'border-line/45 bg-surface/70 hover:bg-hover/70',
                )}
              >
                {/* Quiet indicator - typography carries the choice. */}
                <span
                  aria-hidden
                  className={cn(
                    'grid size-3.5 shrink-0 place-items-center rounded-full border',
                    selected
                      ? closeSelected
                        ? 'border-online'
                        : 'border-brand'
                      : 'border-line-strong/70',
                  )}
                >
                  {selected && (
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        closeSelected ? 'bg-online' : 'bg-brand',
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-body',
                      selected ? 'font-medium text-ink' : 'text-ink',
                    )}
                  >
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block text-caption',
                      selected ? 'text-text-secondary' : 'text-text-tertiary',
                    )}
                  >
                    {option.value === 'custom' && chosen.size > 0
                      ? `${chosen.size} chosen`
                      : option.hint}
                  </span>
                </span>
                {option.value === 'custom' && (
                  <UsersIcon size={15} className="shrink-0 text-text-tertiary" />
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => void post()}
          disabled={busy || !media}
          className={cn(
            'focus-ring w-full rounded-full px-5 py-3 text-body font-medium',
            'bg-brand-gradient text-white',
            // Same gradient; ~20% quieter brand glow than `shadow-brand`.
            'shadow-[0_3px_12px_rgba(109,124,255,0.26)]',
            'transition-transform duration-150 ease-standard active:scale-[0.99]',
            (busy || !media) && 'opacity-50',
          )}
        >
          {busy ? 'Posting…' : 'Share to story'}
        </button>
        {/*
          Tertiary text action, same column as Share - not a second full pill
          that floats below the sheet.
        */}
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'focus-ring w-full rounded-full px-5 py-2.5',
            'text-caption font-medium text-text-tertiary',
            'transition-colors duration-150 ease-standard',
            'hover:bg-hover/60 hover:text-text-secondary',
          )}
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Accepts what people actually type.
 *
 * Nobody types `https://`. Without this, "pingochat.pages.dev" would be stored
 * as a relative URL and open as a path on our own origin - a link that appears
 * to work and goes somewhere else entirely.
 */
function normaliseLink(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
