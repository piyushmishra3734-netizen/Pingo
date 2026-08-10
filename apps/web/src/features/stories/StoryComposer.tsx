import {
  STORY_AUDIENCES,
  type Sticker,
  type StoryAudience,
  type StoryKind,
} from '@pingo/core';
import {
  CameraIcon,
  ImageIcon,
  LinkIcon,
  SmileIcon,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';
import { SnapEditor } from '../camera/SnapEditor.js';
import { useT } from '../i18n/useT.js';
import { StickerPicker } from '../stickers/StickerPicker.js';
import { PeoplePicker } from './PeoplePicker.js';
import { useStories } from './StoryContext.js';

/**
 * Making a story: pick something, work on it, decide who sees it, post.
 *
 * ## Sources
 *
 * Camera · Gallery (multi) · Custom GIF · Stickers · Custom sticker. Gallery
 * accepts many photos at once (Instagram-style sequence). GIFs and stickers
 * skip the photo editor so animation / transparency are not flattened.
 *
 * ## Multi-photo
 *
 * Each file becomes its own story slide under the same audience. Caption,
 * place and link land on the first slide only — the rest share privacy, not
 * the same text blob five times.
 */

type Step = 'source' | 'edit' | 'stickers' | 'details';

/** One slide ready (or almost ready) to post. */
interface QueueItem {
  id: string;
  kind: StoryKind;
  media: Blob;
  previewUrl: string;
  /** True for GIF / sticker / multi-batch — never run through SnapEditor. */
  skipEdit: boolean;
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

  const [step, setStep] = useState<Step>('source');
  /** Multi-slide queue for the details / post step. */
  const [queue, setQueue] = useState<QueueItem[]>([]);
  /** Single photo waiting on SnapEditor (not yet in the queue). */
  const [editSrc, setEditSrc] = useState<string>();

  const [caption, setCaption] = useState('');
  const [place, setPlace] = useState('');
  const [link, setLink] = useState('');
  const [audience, setAudience] = useState<StoryAudience>('friends');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<string>();

  const galleryRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const customStickerRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs when the queue changes or the sheet closes.
  useEffect(() => {
    return () => {
      for (const item of queue) URL.revokeObjectURL(item.previewUrl);
      if (editSrc) URL.revokeObjectURL(editSrc);
    };
    // Only on unmount — mid-session revoke is handled when replacing queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replaceQueue = (next: QueueItem[]) => {
    setQueue((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return next;
    });
  };

  const makeItem = (
    media: Blob,
    kind: StoryKind,
    opts?: { skipEdit?: boolean; previewFrom?: Blob },
  ): QueueItem => {
    const previewBlob = opts?.previewFrom ?? media;
    return {
      id: crypto.randomUUID(),
      kind,
      media,
      previewUrl: URL.createObjectURL(previewBlob),
      skipEdit: Boolean(opts?.skipEdit),
    };
  };

  const takeFiles = (list: FileList | File[]) => {
    const files = [...list].slice(0, MAX_BATCH);
    if (files.length === 0) return;

    // Single still photo → editor. Everything else (multi, video, gif) skips it.
    if (files.length === 1) {
      const file = files[0]!;
      if (file.type.startsWith('video/')) {
        replaceQueue([makeItem(file, 'video', { skipEdit: true })]);
        setStep('details');
        return;
      }
      if (isGifLike(file)) {
        replaceQueue([makeItem(file, 'photo', { skipEdit: true })]);
        setStep('details');
        return;
      }
      if (editSrc) URL.revokeObjectURL(editSrc);
      setEditSrc(URL.createObjectURL(file));
      setStep('edit');
      return;
    }

    const items = files.map((file) => {
      const kind: StoryKind = file.type.startsWith('video/') ? 'video' : 'photo';
      return makeItem(file, kind, { skipEdit: true });
    });
    replaceQueue(items);
    setStep('details');
  };

  const takeCustomGif = (file: File) => {
    if (!isGifLike(file) && !file.type.startsWith('image/')) {
      setError('Pick a GIF or animated image.');
      return;
    }
    // Always original bytes — canvas would freeze a GIF.
    replaceQueue([makeItem(file, 'photo', { skipEdit: true })]);
    setStep('details');
  };

  const takeCustomSticker = async (file: File) => {
    setError(undefined);
    try {
      // Animated custom stickers stay original — canvas would freeze them.
      if (isGifLike(file)) {
        replaceQueue([makeItem(file, 'photo', { skipEdit: true })]);
        setStep('details');
        return;
      }
      const framed = await frameStickerOnCanvas(file);
      replaceQueue([makeItem(framed, 'photo', { skipEdit: true, previewFrom: framed })]);
      setStep('details');
    } catch {
      // Fall back to posting the raw file if framing fails.
      replaceQueue([makeItem(file, 'photo', { skipEdit: true })]);
      setStep('details');
    }
  };

  const takePackSticker = async (sticker: Sticker) => {
    setError(undefined);
    setBusy(true);
    try {
      if (sticker.format === 'lottie') {
        setError('That sticker is animated vector — pick a static one, or upload your own GIF.');
        setBusy(false);
        return;
      }
      const res = await fetch(sticker.url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('Could not load that sticker.');
      const blob = await res.blob();
      const framed = await frameStickerOnCanvas(blob);
      replaceQueue([makeItem(framed, 'photo', { skipEdit: true })]);
      setStep('details');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not use that sticker.');
    } finally {
      setBusy(false);
    }
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
          // Caption / place / link only on the first slide of a multi batch.
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

  // ---- step 1: source -----------------------------------------------------

  if (step === 'source') {
    return (
      <>
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
              onClick={() => galleryRef.current?.click()}
            />
            <SheetItem
              icon={<span className="text-[1.1rem] leading-none">GIF</span>}
              label={t('story.customGif')}
              hint="Your own GIF, full animation"
              onClick={() => gifRef.current?.click()}
            />
            <SheetItem
              icon={<SmileIcon size={20} />}
              label={t('story.stickers')}
              hint="From your sticker packs"
              onClick={() => setStep('stickers')}
            />
            <SheetItem
              icon={<span className="text-[1.05rem] leading-none">✦</span>}
              label={t('story.customSticker')}
              hint="Upload a PNG, WebP or GIF sticker"
              onClick={() => customStickerRef.current?.click()}
            />
            <SheetCancel onClick={onClose} />
          </div>
        </Sheet>

        <input
          ref={galleryRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files;
            event.target.value = '';
            if (files?.length) takeFiles(files);
          }}
        />
        <input
          ref={gifRef}
          type="file"
          accept="image/gif,image/webp,.gif,.webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) takeCustomGif(file);
          }}
        />
        <input
          ref={customStickerRef}
          type="file"
          accept="image/png,image/webp,image/gif,image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void takeCustomSticker(file);
          }}
        />
      </>
    );
  }

  // ---- stickers from packs ------------------------------------------------

  if (step === 'stickers') {
    return (
      <Sheet
        title={t('story.stickers')}
        description="Tap a sticker to post it to your story."
        onClose={() => setStep('source')}
      >
        <div className="mt-2">
          <StickerPicker onSelect={(s) => void takePackSticker(s)} />
        </div>
        {error && (
          <p role="alert" className="mt-2 text-caption text-danger">
            {error}
          </p>
        )}
        {busy && (
          <p className="mt-2 text-caption text-text-tertiary">Preparing sticker…</p>
        )}
        <div className="mt-2">
          <SheetCancel onClick={() => setStep('source')} label="Back" />
        </div>
      </Sheet>
    );
  }

  // ---- single-photo editor ------------------------------------------------

  if (step === 'edit' && editSrc) {
    return (
      <Overlay>
        <div className="fixed inset-0 z-500 bg-backdrop">
          <SnapEditor
            src={editSrc}
            onCancel={onClose}
            doneLabel="Next"
            onDone={(blob) => {
              replaceQueue([makeItem(blob, 'photo', { skipEdit: true })]);
              if (editSrc) URL.revokeObjectURL(editSrc);
              setEditSrc(undefined);
              setStep('details');
            }}
          />
        </div>
      </Overlay>
    );
  }

  // ---- audience picker ----------------------------------------------------

  if (choosing) {
    return (
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
    );
  }

  // ---- details / post -----------------------------------------------------

  const multi = queue.length > 1;
  const primary = queue[0];

  return (
    <Sheet
      title={multi ? t('story.postMany').replace('{n}', String(queue.length)) : t('story.post')}
      onClose={onClose}
      className={cn(
        'border-line/50 bg-page',
        'shadow-[0_8px_32px_rgba(16,17,20,0.08),0_2px_8px_rgba(16,17,20,0.04)]',
      )}
    >
      {/* Filmstrip for multi; single hero preview otherwise. */}
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
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="h-28 w-20 object-cover"
                    />
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
              <img
                src={primary.previewUrl}
                alt=""
                className="max-h-56 w-full object-cover"
              />
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
  );
}

function isGifLike(file: File): boolean {
  return (
    file.type === 'image/gif' ||
    file.name.toLowerCase().endsWith('.gif') ||
    (file.type === 'image/webp' && file.name.toLowerCase().includes('anim'))
  );
}

/**
 * Centres a sticker / small GIF on a 9:16 story frame so pack stickers read
 * as full slides rather than a tiny icon in the corner.
 */
async function frameStickerOnCanvas(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not prepare sticker.');
  }

  // Soft ink field — matches product dark without fighting glass chrome.
  ctx.fillStyle = '#111113';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.55);
  glow.addColorStop(0, 'rgba(80, 90, 140, 0.35)');
  glow.addColorStop(1, 'rgba(17, 17, 19, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const maxW = W * 0.72;
  const maxH = H * 0.5;
  const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height, 3);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (W - dw) / 2, (H - dh) / 2, dw, dh);
  bitmap.close();

  // GIF sources lose animation once drawn — for static stickers PNG is fine.
  // If the source was a GIF we already avoided this path for “custom GIF”
  // stories; pack stickers and custom stickers are framed as PNG.
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('Could not prepare sticker.');
  return blob;
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
