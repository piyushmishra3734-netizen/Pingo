import {
  Button,
  CameraFlipIcon,
  CheckIcon,
  CloseIcon,
  IconButton,
  MoreIcon,
  PingoDot,
  TrashIcon,
  cn,
} from '@pingo/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Overlay } from '../../components/Overlay.js';
import { Sheet, SheetCancel, SheetItem } from '../../components/Sheet.js';

/**
 * Instagram-style circular crop for a profile photo.
 *
 * Hierarchy (learned from Instagram, styled as PINGO):
 *   crop stage is the hero
 *   → one quiet "Choose another photo" link
 *   → Cancel | Save as the only primary pair
 *
 * Rotate, reset and remove live in a ••• sheet so they never compete with Save.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const OUTPUT_SIZE = 1024;
/**
 * PNG, not JPEG: the circle is the canonical photo. JPEG cannot store
 * transparent corners, so a square encode would keep pixels that the circular
 * editor never showed - and ImageViewer would reveal them full-screen.
 */
const OUTPUT_TYPE = 'image/png' as const;
const SUCCESS_MS = 180;
/** Zoom badge stays visible while zooming, then fades. */
const ZOOM_HINT_MS = 1000;

type Phase = 'edit' | 'uploading' | 'success';

interface Point {
  x: number;
  y: number;
}

export interface AvatarPhotoEditorProps {
  src: string;
  onCancel: () => void;
  onSave: (file: File) => void | Promise<void>;
  onChooseAnother: () => void;
  onRemove?: () => void | Promise<void>;
}

export function AvatarPhotoEditor({
  src,
  onCancel,
  onSave,
  onChooseAnother,
  onRemove,
}: AvatarPhotoEditorProps) {
  const titleId = useId();
  const confirm = useConfirm();
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [natural, setNatural] = useState<Point>({ x: 0, y: 0 });
  const [cropPx, setCropPx] = useState(280);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  /*
   * The live values, for the pointer handlers only.
   *
   * A pinch calls `setZoom` and `setOffset` on every move, and `pointerup` can
   * arrive in the same frame - before React has re-rendered and handed the
   * handlers a fresh closure. `endPointer` re-seeds the gesture from `offset`
   * and `zoom`, so on a two-finger pinch it was re-seeding from values a frame
   * or more out of date, and the finger still down then dragged from a
   * position the image was no longer in. The picture jumped, which on a phone
   * reads as the framing being thrown away at the end of every zoom.
   *
   * Written where the value is computed rather than in render or an effect -
   * both of those run after the event, which is too late for the very lift
   * this exists to survive.
   */
  const zoomRef = useRef(MIN_ZOOM);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });

  /** Sets the zoom and the value a gesture in flight will read. */
  const putZoom = useCallback((next: number) => {
    zoomRef.current = next;
    setZoom(next);
  }, []);

  /** Sets the offset and the value a gesture in flight will read. */
  const putOffset = useCallback((next: Point) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('edit');
  const [ready, setReady] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [zoomHint, setZoomHint] = useState(false);
  const busy = phase !== 'edit';

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    { point: Point; offset: Point; distance: number; zoom: number } | undefined
  >(undefined);
  const lastTap = useRef(0);
  const zoomHideTimer = useRef<number | undefined>(undefined);

  const dirtyRef = useRef(false);
  dirtyRef.current =
    zoom !== MIN_ZOOM ||
    offset.x !== 0 ||
    offset.y !== 0 ||
    rotation !== 0;

  const flashZoom = useCallback(() => {
    setZoomHint(true);
    if (zoomHideTimer.current !== undefined) {
      window.clearTimeout(zoomHideTimer.current);
    }
    zoomHideTimer.current = window.setTimeout(() => {
      setZoomHint(false);
      zoomHideTimer.current = undefined;
    }, ZOOM_HINT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomHideTimer.current !== undefined) {
        window.clearTimeout(zoomHideTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      // Larger crop share - footer is slimmer now, so the circle can own the stage.
      const side = Math.min(width, height) * 0.86;
      setCropPx(Math.max(220, Math.floor(side)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    putZoom(MIN_ZOOM);
    putOffset({ x: 0, y: 0 });
    setRotation(0);
    setReady(false);
    setPhase('edit');
    setZoomHint(false);
    setToolsOpen(false);
  }, [src]);

  const requestClose = useCallback(async () => {
    if (busy) return;
    if (dirtyRef.current) {
      const discard = await confirm({
        title: 'Discard your changes?',
        description: "Your profile photo edits haven't been saved.",
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
        if (toolsOpen) {
          setToolsOpen(false);
          return;
        }
        void requestClose();
        return;
      }
      /*
       * Read from the ref and clamped inline.
       *
       * This used to be `setZoom((z) => applyZoom(z + 0.15))`, which put a
       * state write inside a state updater - React may run an updater more
       * than once, and each run fired a second `setZoom`. The helper is gone
       * now; every zoom write goes through `putZoom` so a gesture in flight
       * sees it.
       */
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        putZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current + 0.15)));
        flashZoom();
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        putZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current - 0.15)));
        flashZoom();
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        putZoom(MIN_ZOOM);
        putOffset({ x: 0, y: 0 });
        setRotation(0);
        flashZoom();
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        setRotation((r) => (r + 90) % 360);
        putOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, flashZoom, putOffset, putZoom, requestClose, toolsOpen]);

  const axesSwapped = rotation % 180 !== 0;
  const coverScale =
    natural.x > 0 && natural.y > 0
      ? Math.max(
          cropPx / (axesSwapped ? natural.y : natural.x),
          cropPx / (axesSwapped ? natural.x : natural.y),
        )
      : 1;
  const displayScale = coverScale * zoom;

  const clampOffset = useCallback(
    (next: Point, nextZoom: number, nextRotation: number): Point => {
      if (natural.x === 0 || natural.y === 0) return { x: 0, y: 0 };
      const scale = coverScale * nextZoom;
      const swapped = nextRotation % 180 !== 0;
      const drawW = (swapped ? natural.y : natural.x) * scale;
      const drawH = (swapped ? natural.x : natural.y) * scale;
      const maxX = Math.max(0, (drawW - cropPx) / 2);
      const maxY = Math.max(0, (drawH - cropPx) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [coverScale, cropPx, natural.x, natural.y],
  );

  useEffect(() => {
    // Through `putOffset`, so a re-clamp after a resize or rotate is also
    // visible to a gesture that starts before the next render.
    putOffset(clampOffset(offsetRef.current, zoom, rotation));
  }, [zoom, cropPx, rotation, clampOffset]);

  const spread = (): number => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const centre = (): Point => {
    const all = [...pointers.current.values()];
    const sum = all.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
      x: 0,
      y: 0,
    });
    return { x: sum.x / all.length, y: sum.y / all.length };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (busy) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      const now = performance.now();
      if (now - lastTap.current < 280) {
        putZoom(MIN_ZOOM);
        putOffset({ x: 0, y: 0 });
        flashZoom();
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }

    gesture.current = {
      point: centre(),
      offset,
      distance: spread(),
      zoom,
    };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current || busy) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const distance = spread();
      if (gesture.current.distance > 0) {
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(
            MIN_ZOOM,
            (gesture.current.zoom * distance) / gesture.current.distance,
          ),
        );
        putZoom(nextZoom);
        flashZoom();
        putOffset(clampOffset(gesture.current.offset, nextZoom, rotation));
      }
      return;
    }

    const moved = {
      x: event.clientX - gesture.current.point.x,
      y: event.clientY - gesture.current.point.y,
    };
    putOffset(
      clampOffset(
        {
          x: gesture.current.offset.x + moved.x,
          y: gesture.current.offset.y + moved.y,
        },
        zoom,
        rotation,
      ),
    );
  };

  const endPointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      setDragging(false);
      gesture.current = undefined;
      return;
    }
    // From the refs, not the closure: see `putZoom`.
    gesture.current = {
      point: centre(),
      offset: offsetRef.current,
      distance: spread(),
      zoom: zoomRef.current,
    };
  };

  const onWheel = (event: React.WheelEvent) => {
    if (busy) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    // Straight from the ref, so a fast wheel does not compound stale values.
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current + delta));
    putZoom(next);
    flashZoom();
    putOffset(clampOffset(offsetRef.current, next, rotation));
  };

  /**
   * Encode exactly what the circular stage shows - nothing outside the disc.
   *
   * The editor viewport is a circle over a cover-zoomed image. Exporting the
   * bounding square (the old path) kept the four corner regions that the mask
   * had hidden; opening the photo full-screen then revealed them. Clip to the
   * circle before draw, leave exterior transparent, and store PNG so those
   * corners never exist in the asset everyone else loads.
   */
  const exportCrop = async (): Promise<File> => {
    const img = imgRef.current;
    if (!img || natural.x === 0) throw new Error('Image not ready.');

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');

    // Transparent exterior - not a fill. A filled square would reintroduce
    // "hidden" corner pixels as solid colour when the image is viewed large.
    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const scale = OUTPUT_SIZE / cropPx;
    ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
    ctx.scale(scale, scale);
    ctx.translate(offset.x, offset.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(displayScale, displayScale);
    ctx.drawImage(img, -natural.x / 2, -natural.y / 2, natural.x, natural.y);
    ctx.restore();

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))),
        OUTPUT_TYPE,
      );
    });

    return new File([blob], `avatar-${Date.now()}.png`, { type: OUTPUT_TYPE });
  };

  const save = async () => {
    if (busy || !ready) return;
    setPhase('uploading');
    try {
      const file = await exportCrop();
      await onSave(file);
      setPhase('success');
      await new Promise((resolve) => {
        window.setTimeout(resolve, SUCCESS_MS);
      });
      onCancel();
    } catch {
      setPhase('edit');
    }
  };

  const remove = async () => {
    if (!onRemove || busy) return;
    setToolsOpen(false);
    const go = await confirm({
      title: 'Remove your photo?',
      description: 'Your monogram takes its place. You can add a new one any time.',
      confirmLabel: 'Remove photo',
      tone: 'danger',
    });
    if (!go) return;
    setPhase('uploading');
    try {
      await onRemove();
      setPhase('success');
      await new Promise((resolve) => {
        window.setTimeout(resolve, SUCCESS_MS);
      });
      onCancel();
    } catch {
      setPhase('edit');
    }
  };

  const hintLabel =
    phase === 'uploading'
      ? 'Uploading your photo…'
      : phase === 'success'
        ? 'Photo updated'
        : 'Pinch to zoom · Drag to move';

  return (
    <Overlay onDismiss={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={phase === 'uploading' || undefined}
        className="fixed inset-0 z-1000 flex flex-col bg-page"
      >
        {/* ---- header: title · tools · close --------------------------- */}
        <header
          className={cn(
            'shrink-0 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2',
          )}
        >
          <div className="mx-auto flex w-full max-w-lg items-center gap-1">
            <h1 id={titleId} className="min-w-0 flex-1 truncate px-1 text-h2 text-ink">
              Move and scale
            </h1>

            <div className="relative flex shrink-0 items-center gap-0.5">
              {/* Zoom only while actively zooming - fades after ZOOM_HINT_MS. */}
              <p
                aria-live="polite"
                className={cn(
                  'pointer-events-none absolute right-full mr-2 whitespace-nowrap',
                  'rounded-full bg-surface/90 px-2.5 py-1 text-caption tabular-nums text-text-secondary shadow-sm',
                  'transition-opacity duration-quick ease-standard',
                  phase === 'edit' && zoomHint ? 'opacity-100' : 'opacity-0',
                )}
              >
                {Math.round(zoom * 100)}%
              </p>

              {(phase === 'uploading' || phase === 'success') && (
                <p className="mr-1 text-caption text-text-secondary" aria-live="polite">
                  {phase === 'uploading' ? 'Uploading…' : 'Done'}
                </p>
              )}

              <IconButton
                label="More tools"
                variant="ghost"
                size="md"
                disabled={busy}
                onClick={() => setToolsOpen(true)}
              >
                <MoreIcon size={22} />
              </IconButton>
              <IconButton
                label="Close"
                variant="ghost"
                size="md"
                disabled={busy}
                onClick={() => void requestClose()}
              >
                <CloseIcon size={22} />
              </IconButton>
            </div>
          </div>
        </header>

        {/* ---- stage --------------------------------------------------- */}
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 touch-none overflow-hidden bg-sunken"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={onWheel}
          style={{ touchAction: 'none' }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              className={cn(
                'max-w-none select-none will-change-transform',
                !dragging && !busy && 'transition-transform duration-quick ease-standard',
                busy && 'opacity-70',
              )}
              style={{
                width: natural.x || undefined,
                height: natural.y || undefined,
                transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${rotation}deg) scale(${displayScale})`,
                transformOrigin: 'center center',
              }}
              onLoad={(event) => {
                const el = event.currentTarget;
                setNatural({ x: el.naturalWidth, y: el.naturalHeight });
                setReady(true);
              }}
            />
          </div>

          <div
            className="pointer-events-none absolute inset-0 grid place-items-center"
            aria-hidden
          >
            <div className="relative" style={{ width: cropPx, height: cropPx }}>
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow:
                    '0 0 0 9999px color-mix(in srgb, var(--color-page) 72%, transparent)',
                }}
              />
              {/*
                Quiet guide ring: 1px light edge + soft brand glow.
                Heavy blue rings pull focus off the face inside the circle.
              */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow:
                    'inset 0 0 0 1px rgba(255,255,255,0.88), 0 0 0 1px rgba(17,17,19,0.14), 0 0 24px rgba(17,17,19,0.08)',
                }}
              />
              {phase === 'uploading' && (
                <div className="absolute inset-0 grid place-items-center rounded-full bg-surface/55">
                  <PingoDot state="loading" size={9} label="Uploading" />
                </div>
              )}
              {phase === 'success' && (
                <div
                  className={cn(
                    'absolute inset-0 grid place-items-center rounded-full',
                    'bg-brand-gradient text-white shadow-brand',
                    'animate-react-in',
                  )}
                >
                  <CheckIcon size={Math.max(28, Math.floor(cropPx * 0.28))} strokeWidth={2.5} />
                </div>
              )}
            </div>
          </div>

          {!ready && phase === 'edit' && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="text-caption text-text-secondary">Loading photo…</p>
            </div>
          )}
        </div>

        {/* ---- footer: choose · Cancel | Save -------------------------- */}
        <footer
          className={cn(
            'shrink-0 border-t border-line bg-page',
            'px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto flex w-full max-w-md flex-col items-stretch gap-5">
            <p
              className="text-center text-caption text-text-secondary"
              aria-live="polite"
            >
              {hintLabel}
            </p>

            <button
              type="button"
              onClick={onChooseAnother}
              disabled={busy}
              className={cn(
                'focus-ring self-center rounded-full px-3 py-1.5',
                'text-caption font-medium text-brand',
                'transition-colors duration-instant hover:bg-hover',
                'disabled:pointer-events-none disabled:opacity-45',
              )}
            >
              Choose another photo
            </button>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                block
                onClick={() => void requestClose()}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                block
                loading={phase === 'uploading'}
                disabled={!ready || busy}
                onClick={() => void save()}
              >
                {phase === 'uploading'
                  ? 'Uploading…'
                  : phase === 'success'
                    ? 'Done'
                    : 'Save'}
              </Button>
            </div>
          </div>
        </footer>
      </div>

      {toolsOpen && (
        <Sheet title="Photo tools" hideTitle onClose={() => setToolsOpen(false)} elevated>
          <div className="flex flex-col gap-1">
            <SheetItem
              icon={<CameraFlipIcon size={20} />}
              label="Rotate"
              onClick={() => {
                setRotation((r) => (r + 90) % 360);
                putOffset({ x: 0, y: 0 });
                setToolsOpen(false);
              }}
            />
            <SheetItem
              label="Reset"
              onClick={() => {
                putZoom(MIN_ZOOM);
                putOffset({ x: 0, y: 0 });
                setRotation(0);
                flashZoom();
                setToolsOpen(false);
              }}
            />
            {onRemove && (
              <SheetItem
                icon={<TrashIcon size={20} />}
                label="Remove photo"
                tone="danger"
                onClick={() => void remove()}
              />
            )}
            <SheetCancel onClick={() => setToolsOpen(false)} />
          </div>
        </Sheet>
      )}
    </Overlay>
  );
}
