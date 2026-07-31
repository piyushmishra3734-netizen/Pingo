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
    } catch {
      setError('That did not post. Try again.');
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
    <Sheet title="Post to your story" onClose={onClose}>
      {src && (
        <div className="mt-3 overflow-hidden rounded-lg bg-hover">
          {picked?.kind === 'video' ? (
            <video src={src} className="max-h-48 w-full object-contain" muted playsInline />
          ) : (
            <img src={src} alt="" className="max-h-48 w-full object-contain" />
          )}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value.slice(0, 500))}
          rows={2}
          placeholder="Say something. @mentions and links work."
          aria-label="Caption"
          className={cn(
            'focus-ring w-full resize-none rounded-lg border border-line bg-page',
            'px-3 py-2.5 text-body text-ink placeholder:text-text-tertiary',
          )}
        />

        <label className="flex items-center gap-2 rounded-lg border border-line bg-page px-3">
          <span aria-hidden className="text-text-tertiary">
            📍
          </span>
          <input
            value={place}
            onChange={(event) => setPlace(event.target.value.slice(0, 80))}
            placeholder="Add a place (optional)"
            aria-label="Place"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-body text-ink outline-none placeholder:text-text-tertiary"
          />
        </label>

        <label className="flex items-center gap-2 rounded-lg border border-line bg-page px-3">
          <LinkIcon size={16} className="shrink-0 text-text-tertiary" />
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Add a link (optional)"
            aria-label="Link"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2.5 text-body text-ink outline-none placeholder:text-text-tertiary"
          />
        </label>
      </div>

      {/* ---- audience ------------------------------------------------- */}
      <fieldset className="mt-4">
        <legend className="mb-2 text-caption font-medium text-text-secondary">Who can see it</legend>

        <div className="flex flex-col gap-1">
          {STORY_AUDIENCES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={audience === option.value}
              onClick={() => {
                setAudience(option.value);
                setError(undefined);
                if (option.value === 'custom') setChoosing(true);
              }}
              className={cn(
                'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                'transition-colors duration-instant hover:bg-hover',
                audience === option.value && 'bg-hover',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border-2',
                  audience === option.value ? 'border-brand' : 'border-line',
                  // Close friends is green everywhere it appears, including the
                  // control that chooses it.
                  option.value === 'close' && audience === option.value && 'border-online',
                )}
              >
                {audience === option.value && (
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      option.value === 'close' ? 'bg-online' : 'bg-brand',
                    )}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink">{option.label}</span>
                <span className="block text-caption text-text-secondary">
                  {option.value === 'custom' && chosen.size > 0
                    ? `${chosen.size} chosen`
                    : option.hint}
                </span>
              </span>
              {option.value === 'custom' && (
                <UsersIcon size={16} className="shrink-0 text-text-tertiary" />
              )}
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void post()}
          disabled={busy || !media}
          className={cn(
            'focus-ring w-full rounded-full px-5 py-3 text-body font-medium',
            'bg-brand-gradient text-white shadow-brand',
            'transition-transform duration-instant active:scale-[0.98]',
            (busy || !media) && 'opacity-50',
          )}
        >
          {busy ? 'Posting…' : 'Share to story'}
        </button>
        <SheetCancel onClick={onClose} />
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
