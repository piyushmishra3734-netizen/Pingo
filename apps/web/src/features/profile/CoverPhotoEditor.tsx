import { Button, CloseIcon, IconButton, cn } from '@pingo/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Overlay } from '../../components/Overlay.js';
import { encodeCover } from './cover-image.js';

/**
 * Crop a cover the way Instagram and X do: the frame is fixed, the photo moves.
 *
 * ## What changed from "drag to reposition"
 *
 * The old cover took the whole photo and let you slide it up and down inside the
 * band. That is one axis, no zoom, and a file that is still the size of the whole
 * photograph. Here the frame has the cover's own shape, the photo is panned and
 * pinched under it, and what is saved is exactly the strip inside the frame - a
 * 1280 x 512 WebP, about as many kilobytes as the old file had megabytes.
 *
 * ## Why it is smooth
 *
 * Every gesture writes the photo's transform straight to the element, once per
 * frame. React is told only what the screen has to say in words (the zoom
 * percentage, the buttons), never "the finger moved a pixel".
 *
 * The photo on the stage is a copy no larger than 2048 pixels. A twelve
 * megapixel bitmap is a very large texture to move around; the *export* still
 * samples the full-size one, so zooming in does not cost sharpness.
 */

/** Width : height of a cover. The profile band is about this on a phone. */
export const COVER_ASPECT = 2.5;
const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = Math.round(OUTPUT_WIDTH / COVER_ASPECT);
/** The stage copy's longest edge. */
const STAGE_PIXELS = 2048;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_HINT_MS = 1000;
const DOUBLE_TAP_MS = 280;

type Phase = 'loading' | 'edit' | 'saving' | 'failed';

interface Point {
  x: number;
  y: number;
}

export interface CoverPhotoEditorProps {
  file: File;
  onCancel: () => void;
  /** The cropped cover, ready to stage. Nothing is uploaded here. */
  onSave: (file: File) => void;
  onChooseAnother: () => void;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function CoverPhotoEditor({ file, onCancel, onSave, onChooseAnother }: CoverPhotoEditorProps) {
  const titleId = useId();
  const confirm = useConfirm();
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [stageSrc, setStageSrc] = useState<string>();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [zoom, setZoomState] = useState(MIN_ZOOM);
  const [dragging, setDragging] = useState(false);
  const [zoomHint, setZoomHint] = useState(false);

  /*
   * The live picture of the crop. Gestures read and write these, not state, so a
   * pointer event never waits for a render to know where the photo is.
   */
  const live = useRef({ zoom: MIN_ZOOM, rotation: 0, x: 0, y: 0 });
  const size = useRef({ width: 0, height: 0 });
  const frameRef = useRef({ width: 0, height: 0 });
  const original = useRef<ImageBitmap | undefined>(undefined);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ point: Point; x: number; y: number; distance: number; zoom: number } | undefined>(undefined);
  const lastTap = useRef(0);
  /** Whether the finger travelled: only a still touch counts as a tap. */
  const travelled = useRef(false);
  const hintTimer = useRef<number | undefined>(undefined);
  const frameRequest = useRef(0);
  const dirty = useRef(false);

  /** The scale at which the photo exactly covers the frame, before any zoom. */
  const coverScale = () => {
    const { width, height } = size.current;
    const f = frameRef.current;
    if (!width || !height || !f.width) return 1;
    const swapped = live.current.rotation % 180 !== 0;
    return Math.max(f.width / (swapped ? height : width), f.height / (swapped ? width : height));
  };

  /** Keeps the photo covering the frame: no gaps at an edge, ever. */
  const clampPosition = () => {
    const l = live.current;
    const { width, height } = size.current;
    const f = frameRef.current;
    if (!width || !f.width) return;
    const scale = coverScale() * l.zoom;
    const swapped = l.rotation % 180 !== 0;
    const maxX = Math.max(0, ((swapped ? height : width) * scale - f.width) / 2);
    const maxY = Math.max(0, ((swapped ? width : height) * scale - f.height) / 2);
    l.x = clamp(l.x, -maxX, maxX);
    l.y = clamp(l.y, -maxY, maxY);
  };

  /** One write per frame, however many events arrived. */
  const paint = useCallback(() => {
    if (frameRequest.current) return;
    frameRequest.current = requestAnimationFrame(() => {
      frameRequest.current = 0;
      const img = imageRef.current;
      if (!img) return;
      const l = live.current;
      img.style.transform = `translate3d(${l.x}px, ${l.y}px, 0) rotate(${l.rotation}deg) scale(${coverScale() * l.zoom})`;
    });
  }, []);

  const flashZoom = useCallback(() => {
    setZoomHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setZoomHint(false), ZOOM_HINT_MS);
  }, []);

  const setZoom = useCallback(
    (next: number) => {
      live.current.zoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
      clampPosition();
      dirty.current = true;
      setZoomState(live.current.zoom);
      paint();
    },
    [paint],
  );

  const reset = useCallback(() => {
    live.current = { zoom: MIN_ZOOM, rotation: 0, x: 0, y: 0 };
    dirty.current = false;
    setZoomState(MIN_ZOOM);
    paint();
  }, [paint]);

  const rotate = () => {
    live.current.rotation = (live.current.rotation + 90) % 360;
    live.current.x = 0;
    live.current.y = 0;
    dirty.current = true;
    clampPosition();
    paint();
  };

  // ---- the photo: a stage-sized copy to move, the full one kept to export -----------
  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    setPhase('loading');
    setStageSrc(undefined);
    reset();

    void (async () => {
      try {
        const bitmap = await createImageBitmap(file);
        if (!alive) {
          bitmap.close();
          return;
        }
        original.current?.close();
        original.current = bitmap;

        const longest = Math.max(bitmap.width, bitmap.height);
        if (longest <= STAGE_PIXELS) {
          url = URL.createObjectURL(file);
        } else {
          const scale = STAGE_PIXELS / longest;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(bitmap.width * scale);
          canvas.height = Math.round(bitmap.height * scale);
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
          if (!alive) return;
          url = blob ? URL.createObjectURL(blob) : URL.createObjectURL(file);
        }
        if (alive) setStageSrc(url);
      } catch {
        if (alive) setPhase('failed');
      }
    })();

    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, reset]);

  useEffect(
    () => () => {
      original.current?.close();
      cancelAnimationFrame(frameRequest.current);
      window.clearTimeout(hintTimer.current);
    },
    [],
  );

  // ---- the frame: as wide as the stage allows, in the cover's own shape ---------------
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const box = stage.getBoundingClientRect();
      const width = Math.max(240, Math.min(box.width - 24, 560, (box.height - 24) * COVER_ASPECT));
      const next = { width: Math.floor(width), height: Math.floor(width / COVER_ASPECT) };
      frameRef.current = next;
      setFrame(next);
      clampPosition();
      paint();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [paint]);

  // ---- gestures -------------------------------------------------------------------------
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const centre = (): Point => {
    const all = [...pointers.current.values()];
    const sum = all.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / all.length, y: sum.y / all.length };
  };
  const seed = () => {
    gesture.current = { point: centre(), x: live.current.x, y: live.current.y, distance: spread(), zoom: live.current.zoom };
  };

  const busy = phase === 'saving';
  const ready = phase === 'edit';

  const onPointerDown = (event: React.PointerEvent) => {
    if (!ready) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      travelled.current = false;
      if (performance.now() - lastTap.current < DOUBLE_TAP_MS) {
        reset();
        flashZoom();
        lastTap.current = 0;
      }
    } else {
      travelled.current = true;
    }
    seed();
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = gesture.current;
    if (!ready || !start || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const l = live.current;
    if (Math.hypot(event.clientX - start.point.x, event.clientY - start.point.y) > 4 || pointers.current.size >= 2) travelled.current = true;

    if (pointers.current.size >= 2) {
      if (start.distance > 0) {
        l.zoom = clamp((start.zoom * spread()) / start.distance, MIN_ZOOM, MAX_ZOOM);
        dirty.current = true;
        setZoomState(l.zoom);
        flashZoom();
      }
      l.x = start.x;
      l.y = start.y;
    } else {
      const now = centre();
      l.x = start.x + (now.x - start.point.x);
      l.y = start.y + (now.y - start.point.y);
      dirty.current = true;
    }
    clampPosition();
    paint();
  };

  const onPointerEnd = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      // A still touch is the first half of a double tap; a drag or a pinch is not.
      lastTap.current = travelled.current ? 0 : performance.now();
      gesture.current = undefined;
      setDragging(false);
    } else {
      seed();
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    if (!ready) return;
    setZoom(live.current.zoom + (event.deltaY > 0 ? -0.12 : 0.12));
    flashZoom();
  };

  // ---- closing and saving --------------------------------------------------------------
  const requestClose = useCallback(async () => {
    if (busy) return;
    if (dirty.current) {
      const discard = await confirm({
        title: 'Discard your changes?',
        description: "Your cover edits haven't been saved.",
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!discard) return;
    }
    onCancel();
  }, [busy, confirm, onCancel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        void requestClose();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom(live.current.zoom + 0.15);
        flashZoom();
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setZoom(live.current.zoom - 0.15);
        flashZoom();
      } else if (event.key === '0') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, flashZoom, requestClose, reset, setZoom]);

  /** Exactly what is inside the frame, sampled from the full-size photo. */
  const exportCrop = async (): Promise<File> => {
    const bitmap = original.current;
    const f = frameRef.current;
    const stage = size.current;
    if (!bitmap || !f.width || !stage.width) throw new Error('Photo not ready.');

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable.');

    const l = live.current;
    context.fillStyle = '#000';
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.translate(OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2);
    context.scale(OUTPUT_WIDTH / f.width, OUTPUT_WIDTH / f.width);
    context.translate(l.x, l.y);
    context.rotate((l.rotation * Math.PI) / 180);
    const scale = coverScale() * l.zoom;
    context.scale(scale, scale);
    // The stage copy and the original have the same shape; draw the original at the stage copy's size.
    context.drawImage(bitmap, -stage.width / 2, -stage.height / 2, stage.width, stage.height);

    const blob = await encodeCover(canvas);
    if (!blob) throw new Error('Could not encode the cover.');
    return new File([blob], `cover-${Date.now()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
  };

  const save = async () => {
    if (!ready) return;
    setPhase('saving');
    try {
      const cover = await exportCrop();
      onSave(cover);
      onCancel();
    } catch {
      setPhase('edit');
    }
  };

  return (
    <Overlay onDismiss={() => void requestClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className="fixed inset-0 z-1000 flex flex-col bg-page"
      >
        <header className="shrink-0 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="mx-auto flex w-full max-w-lg items-center gap-1">
            <h1 id={titleId} className="min-w-0 flex-1 truncate px-1 text-h2 text-ink">
              Adjust cover
            </h1>
            <p
              aria-live="polite"
              className={cn(
                'pointer-events-none mr-1 rounded-full bg-surface/90 px-2.5 py-1 text-caption tabular-nums text-text-secondary shadow-sm',
                'transition-opacity duration-quick ease-standard',
                ready && zoomHint ? 'opacity-100' : 'opacity-0',
              )}
            >
              {Math.round(zoom * 100)}%
            </p>
            <IconButton label="Close" variant="ghost" size="md" disabled={busy} onClick={() => void requestClose()}>
              <CloseIcon size={22} />
            </IconButton>
          </div>
        </header>

        {/* ---- stage: the photo moves, the frame does not ------------------------------- */}
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 touch-none overflow-hidden bg-sunken"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
          style={{ touchAction: 'none' }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            {stageSrc ? (
              <img
                ref={imageRef}
                src={stageSrc}
                alt=""
                draggable={false}
                decoding="async"
                className={cn('max-w-none select-none will-change-transform', busy && 'opacity-70')}
                style={{ width: size.current.width || undefined, height: size.current.height || undefined, transformOrigin: 'center center' }}
                onLoad={(event) => {
                  const el = event.currentTarget;
                  size.current = { width: el.naturalWidth, height: el.naturalHeight };
                  el.style.width = `${el.naturalWidth}px`;
                  el.style.height = `${el.naturalHeight}px`;
                  clampPosition();
                  paint();
                  setPhase('edit');
                }}
              />
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
            <div className="relative" style={{ width: frame.width, height: frame.height }}>
              <div
                className="absolute inset-0 rounded-[14px]"
                style={{ boxShadow: '0 0 0 9999px color-mix(in srgb, var(--color-page) 72%, transparent)' }}
              />
              <div
                className="absolute inset-0 rounded-[14px]"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.88), 0 0 0 1px rgba(17,17,19,0.14)' }}
              />
              {/* Rule-of-thirds, while the photo is being moved. */}
              <div className={cn('absolute inset-0 transition-opacity duration-quick', dragging ? 'opacity-100' : 'opacity-0')}>
                <span className="absolute inset-y-0 left-1/3 w-px bg-white/55" />
                <span className="absolute inset-y-0 left-2/3 w-px bg-white/55" />
                <span className="absolute inset-x-0 top-1/3 h-px bg-white/55" />
                <span className="absolute inset-x-0 top-2/3 h-px bg-white/55" />
              </div>
            </div>
          </div>

          {phase === 'loading' && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="text-caption text-text-secondary">Opening photo…</p>
            </div>
          )}
          {phase === 'failed' && (
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              <p className="text-caption text-text-secondary">This photo could not be opened. Choose another.</p>
            </div>
          )}
        </div>

        {/* ---- footer: zoom · choose · Cancel | Save --------------------------------------- */}
        <footer className="shrink-0 border-t border-line bg-page px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <div className="mx-auto flex w-full max-w-md flex-col items-stretch gap-4">
            <div className="flex items-center gap-3">
              <input
                type="range"
                aria-label="Zoom"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                disabled={!ready}
                onChange={(event) => {
                  setZoom(Number(event.target.value));
                  flashZoom();
                }}
                className="pingo-scrub h-1 min-w-0 flex-1 touch-none appearance-none rounded-full bg-line accent-brand disabled:opacity-45"
              />
              <button
                type="button"
                onClick={rotate}
                disabled={!ready}
                className="focus-ring shrink-0 rounded-full px-3 py-1.5 text-caption font-medium text-brand transition-colors duration-instant hover:bg-hover disabled:pointer-events-none disabled:opacity-45"
              >
                Rotate
              </button>
            </div>

            <p className="text-center text-caption text-text-secondary" aria-live="polite">
              {busy ? 'Preparing your cover…' : 'Pinch to zoom · Drag to move'}
            </p>

            <button
              type="button"
              onClick={onChooseAnother}
              disabled={busy}
              className="focus-ring self-center rounded-full px-3 py-1.5 text-caption font-medium text-brand transition-colors duration-instant hover:bg-hover disabled:pointer-events-none disabled:opacity-45"
            >
              Choose another photo
            </button>

            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" size="lg" block onClick={() => void requestClose()} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="lg" block loading={busy} disabled={!ready} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Use cover'}
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </Overlay>
  );
}
