import { STORY_AUDIENCES, type StoryAudience, type StoryKind } from '@pingo/core';
import { CameraIcon, ImageIcon, LinkIcon, UsersIcon, cn } from '@pingo/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import { SnapEditor } from '../camera/SnapEditor.js';
import { useT } from '../i18n/useT.js';
import { PeoplePicker } from './PeoplePicker.js';
import { useStories } from './StoryContext.js';

/**
 * Making a story: pick something, work on it, decide who sees it, post.
 *
 * ## Sources
 *
 * Camera · Gallery (multi). Stickers and custom GIFs live **inside** the
 * photo editor (SnapEditor), not on this sheet — same place as draw / emoji.
 *
 * ## Multi-photo
 *
 * Each file becomes its own story slide under the same audience. Caption,
 * place and link land on the first slide only.
 */

type Step = 'source' | 'edit' | 'details';

interface QueueItem {
  id: string;
  kind: StoryKind;
  media: Blob;
  previewUrl: string;
}

const MAX_BATCH = 20;

export function StoryComposer({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const t = useT();
  const { service, refresh } = useStories();
  const navigate = useNavigate();
  const galleryInputId = useId();

  const [step, setStep] = useState<Step>('source');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [editSrc, setEditSrc] = useState<string>();
  /** Original file for GIF/video passthrough (editor must not flatten). */
  const [editUntouchable, setEditUntouchable] = useState<Blob>();

  const [caption, setCaption] = useState('');
  const [place, setPlace] = useState('');
  const [link, setLink] = useState('');
  const [audience, setAudience] = useState<StoryAudience>('friends');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<string>();

  /*
   * Always mounted (not only on source step). A `display:none` input that
   * unmounts with the sheet, or lives under `hidden`, is ignored by several
   * mobile WebViews when opened via `.click()` — gallery appeared dead.
   */
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      for (const item of queue) URL.revokeObjectURL(item.previewUrl);
      if (editSrc) URL.revokeObjectURL(editSrc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replaceQueue = (next: QueueItem[]) => {
    setQueue((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return next;
    });
  };

  const makeItem = (media: Blob, kind: StoryKind): QueueItem => ({
    id: crypto.randomUUID(),
    kind,
    media,
    previewUrl: URL.createObjectURL(media),
  });

  const openGallery = () => {
    const input = galleryRef.current;
    if (!input) return;
    // Same file again still fires change.
    input.value = '';
    // Defer one frame so the sheet's press handlers finish first (iOS).
    window.requestAnimationFrame(() => {
      input.click();
    });
  };

  const takeFiles = (list: FileList | File[]) => {
    const files = [...list].slice(0, MAX_BATCH);
    if (files.length === 0) return;
    setError(undefined);

    if (files.length === 1) {
      const file = files[0]!;
      if (file.type.startsWith('video/')) {
        replaceQueue([makeItem(file, 'video')]);
        setStep('details');
        return;
      }
      // GIF: open in editor as untouchable so animation is kept.
      if (isGifLike(file)) {
        if (editSrc) URL.revokeObjectURL(editSrc);
        setEditSrc(URL.createObjectURL(file));
        setEditUntouchable(file);
        setStep('edit');
        return;
      }
      if (editSrc) URL.revokeObjectURL(editSrc);
      setEditSrc(URL.createObjectURL(file));
      setEditUntouchable(undefined);
      setStep('edit');
      return;
    }

    // Multi: skip per-slide editor (Instagram multi-share style).
    replaceQueue(
      files.map((file) => {
        const kind: StoryKind = file.type.startsWith('video/') ? 'video' : 'photo';
        return makeItem(file, kind);
      }),
    );
    setStep('details');
  };

  const post = async () => {
    if (queue.length === 0 || busy) return;

    if (audience === 'custom' && chosen.size === 0) {
      setError('Choose at least one person, or pick a different audience.');
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const total = queue.length;
      for (let i = 0; i < total; i += 1) {
        const item = queue[i]!;
        if (total > 1) setProgress(`Posting ${i + 1} of ${total}…`);
        await service.post({
          media: item.media,
          kind: item.kind,
          audience,
          ...(i === 0 && caption.trim() ? { caption: caption.trim() } : {}),
          ...(i === 0 && place.trim() ? { location: place.trim() } : {}),
          ...(i === 0 && link.trim() ? { linkUrl: normaliseLink(link) } : {}),
          ...(audience === 'custom' ? { audienceUserIds: [...chosen] } : {}),
        });
      }
      await refresh();
      onPosted();
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : 'That did not post. Try again.';
      setError(message);
      setBusy(false);
      setProgress(undefined);
    }
  };

  const removeFromQueue = (id: string) => {
    setQueue((prev) => {
      const next = prev.filter((item) => {
        if (item.id === id) {
          URL.revokeObjectURL(item.previewUrl);
          return false;
        }
        return true;
      });
      if (next.length === 0) setStep('source');
      return next;
    });
  };

  // File input always in the tree so gallery works from any step re-open.
  const galleryInput = (
    <input
      id={galleryInputId}
      ref={galleryRef}
      type="file"
      accept="image/*,video/*,image/gif,.gif"
      multiple
      /*
       * Not `hidden` / `display:none` — many Android WebViews refuse
       * programmatic click on fully hidden file inputs.
       */
      className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        const files = event.target.files;
        // Reset after read so picking the same set again still works.
        const list = files ? [...files] : [];
        event.target.value = '';
        if (list.length) takeFiles(list);
      }}
    />
  );

  // ---- step 1: source -----------------------------------------------------

  if (step === 'source') {
    return (
      <>
        {galleryInput}
        <Sheet title={t('story.composeTitle')} onClose={onClose}>
          <div className="mt-3 flex flex-col gap-1">
            <SheetItem
              icon={<CameraIcon size={20} />}
              label={t('story.camera')}
              hint="Take a photo now"
              onClick={() => {
                onClose();
                navigate('/camera');
              }}
            />
            <SheetItem
              icon={<ImageIcon size={20} />}
              label={t('story.gallery')}
              hint="One photo, or many — like Instagram"
              onClick={openGallery}
            />
            <SheetCancel onClick={onClose} />
          </div>
        </Sheet>
      </>
    );
  }

  // ---- single-photo editor (stickers / custom GIF live here) --------------

  if (step === 'edit' && editSrc) {
    return (
      <>
        {galleryInput}
        <Overlay>
          <div className="fixed inset-0 z-500 bg-backdrop">
            <SnapEditor
              src={editSrc}
              onCancel={onClose}
              doneLabel="Next"
              {...(editUntouchable ? { untouchable: editUntouchable } : {})}
              onDone={(blob) => {
                replaceQueue([
                  makeItem(blob, blob.type.startsWith('video/') ? 'video' : 'photo'),
                ]);
                if (editSrc) URL.revokeObjectURL(editSrc);
                setEditSrc(undefined);
                setEditUntouchable(undefined);
                setStep('details');
              }}
            />
          </div>
        </Overlay>
      </>
    );
  }

  // ---- audience picker ----------------------------------------------------

  if (choosing) {
    return (
      <>
        {galleryInput}
        <Sheet
          title={t('story.specificPeople')}
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
      </>
    );
  }

  // ---- details / post -----------------------------------------------------

  const multi = queue.length > 1;
  const primary = queue[0];

  return (
    <>
      {galleryInput}
      <Sheet
        title={multi ? t('story.postMany').replace('{n}', String(queue.length)) : t('story.post')}
        onClose={onClose}
        className={cn(
          'border-line/50 bg-page',
          'shadow-[0_8px_32px_rgba(16,17,20,0.08),0_2px_8px_rgba(16,17,20,0.04)]',
        )}
      >
        {multi ? (
          <div className="mt-3">
            <ul className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
              {queue.map((item, index) => (
                <li key={item.id} className="relative shrink-0">
                  <div className="overflow-hidden rounded-xl bg-sunken ring-1 ring-black/5">
                    {item.kind === 'video' ? (
                      <video
                        src={item.previewUrl}
                        className="h-28 w-20 object-cover"
                        muted
                        playsInline
                      />
                    ) : (
                      <img src={item.previewUrl} alt="" className="h-28 w-20 object-cover" />
                    )}
                  </div>
                  <span className="absolute top-1 left-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.625rem] font-medium text-white tabular-nums">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(item.id)}
                    className={cn(
                      'absolute -top-1.5 -right-1.5 grid size-5 place-items-center',
                      'rounded-full bg-ink text-[0.65rem] font-bold text-white',
                      'focus-ring shadow-sm',
                    )}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-text-tertiary">
              {queue.length} slides · same audience for all · caption on the first
            </p>
          </div>
        ) : (
          primary && (
            <div
              className={cn(
                'relative mt-3 overflow-hidden rounded-2xl',
                'bg-sunken ring-1 ring-black/5',
                'shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]',
              )}
            >
              {primary.kind === 'video' ? (
                <video
                  src={primary.previewUrl}
                  className="max-h-56 w-full object-cover"
                  muted
                  playsInline
                />
              ) : (
                <img src={primary.previewUrl} alt="" className="max-h-56 w-full object-cover" />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/25 to-transparent"
              />
            </div>
          )
        )}

        <div className="mt-3 space-y-2">
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value.slice(0, 500))}
            rows={2}
            placeholder={t('story.captionPh')}
            aria-label={t('story.caption')}
            className={cn(
              'focus-ring w-full resize-none rounded-2xl border border-line/60 bg-surface',
              'px-3.5 py-3 text-body text-ink placeholder:text-text-tertiary',
              'transition-[border-color,box-shadow] duration-[160ms] ease-standard',
              'focus:border-brand/25 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_10%,transparent)]',
            )}
          />

          <label
            className={cn(
              'flex items-center gap-2.5 rounded-2xl border border-line/35 bg-sunken/65 px-3.5',
              'transition-colors duration-[160ms] ease-standard focus-within:border-line/65',
            )}
          >
            <span aria-hidden className="text-[0.95rem] text-text-tertiary">
              📍
            </span>
            <input
              value={place}
              onChange={(event) => setPlace(event.target.value.slice(0, 80))}
              placeholder={t('story.placePh')}
              aria-label={t('story.place')}
              className="min-w-0 flex-1 bg-transparent py-2.5 text-caption text-ink outline-none placeholder:text-text-tertiary"
            />
          </label>

          <label
            className={cn(
              'flex items-center gap-2.5 rounded-2xl border border-transparent bg-sunken/40 px-3.5',
              'transition-colors duration-[160ms] ease-standard focus-within:border-line/40',
            )}
          >
            <LinkIcon size={15} className="shrink-0 text-text-tertiary" />
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder={t('story.linkPh')}
              aria-label={t('story.link')}
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-2.5 text-caption text-ink outline-none placeholder:text-text-tertiary"
            />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="mb-2 px-0.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-text-tertiary uppercase">
            Who can see it
          </legend>

          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('story.audience')}>
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
                    'focus-ring flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left',
                    'border transition-[background-color,border-color,box-shadow,transform] duration-[160ms] ease-standard',
                    'active:scale-[0.99]',
                    selected
                      ? closeSelected
                        ? 'border-online/35 bg-online/10 shadow-sm'
                        : 'border-brand/30 bg-selected shadow-sm'
                      : 'border-line/40 bg-surface/75 hover:bg-hover/60',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]',
                      selected
                        ? closeSelected
                          ? 'border-online'
                          : 'border-brand'
                        : 'border-line-strong/60',
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
                        'block text-body tracking-[-0.01em]',
                        selected ? 'font-semibold text-ink' : 'text-ink',
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
        {progress && (
          <p className="mt-2 text-caption text-text-secondary" aria-live="polite">
            {progress}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => void post()}
            disabled={busy || queue.length === 0}
            className={cn(
              'focus-ring w-full rounded-full px-5 py-3.5 text-body font-semibold tracking-[-0.01em]',
              'bg-brand-gradient text-white',
              'shadow-[0_4px_16px_color-mix(in_srgb,var(--gradient-from,#111113)_28%,transparent)]',
              'transition-transform duration-[160ms] ease-standard',
              'active:scale-[0.97]',
              (busy || queue.length === 0) && 'opacity-50',
            )}
          >
            {busy
              ? progress || t('story.posting')
              : multi
                ? t('story.postMany').replace('{n}', String(queue.length))
                : t('story.post')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'focus-ring w-full rounded-full px-5 py-2.5',
              'text-caption font-medium text-text-tertiary',
              'transition-colors duration-[160ms] ease-standard',
              'hover:bg-hover/50 hover:text-text-secondary',
              'active:scale-[0.98]',
            )}
          >
            Cancel
          </button>
        </div>
      </Sheet>
    </>
  );
}

function isGifLike(file: File): boolean {
  return (
    file.type === 'image/gif' ||
    file.name.toLowerCase().endsWith('.gif')
  );
}

function normaliseLink(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
