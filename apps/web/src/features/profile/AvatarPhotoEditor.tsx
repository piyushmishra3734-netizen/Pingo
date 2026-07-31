import { Button, CheckIcon, PingoDot, cn } from '@pingo/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Overlay } from '../../components/Overlay.js';

/**
 * Instagram-style circular crop for a profile photo.
 *
 * Opens after a file is chosen; nothing is uploaded until Save. Cancel discards
 * every transform (with a confirm when the crop has been moved). Built from the
 * same Overlay / Button / Confirm vocabulary as the rest of PINGO.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const OUTPUT_SIZE = 1024;
const JPEG_QUALITY = 0.95;
/** Brief ✓ after upload so Save feels finished, not cut off. Instagram-paced. */
const SUCCESS_MS = 180;

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
  /**
   * When the account already has a profile photo, show "Remove photo". Omitting
   * it (setup with monogram only) keeps the footer to choose / cancel / save.
   */
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
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('edit');
  const [ready, setReady] = useState(false);
  const busy = phase !== 'edit';

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    { point: Point; offset: Point; distance: number; zoom: number } | undefined
  >(undefined);
  const lastTap = useRef(0);

  // Latest transform for Escape without re-binding every pan frame.
  const dirtyRef = useRef(false);
  dirtyRef.current =
    zoom !== MIN_ZOOM ||
    offset.x !== 0 ||
    offset.y !== 0 ||
    rotation !== 0;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      const side = Math.min(width, height) * 0.82;
      setCropPx(Math.max(200, Math.floor(side)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    setRotation(0);
    setReady(false);
    setPhase('edit');
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
        void requestClose();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.15) * 100) / 100));
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.15) * 100) / 100));
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        setZoom(MIN_ZOOM);
        setOffset({ x: 0, y: 0 });
        setRotation(0);
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        setRotation((r) => (r + 90) % 360);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, busy]);

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
    setOffset((o) => clampOffset(o, zoom, rotation));
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
        setZoom(MIN_ZOOM);
        setOffset({ x: 0, y: 0 });
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
        setZoom(nextZoom);
        setOffset(clampOffset(gesture.current.offset, nextZoom, rotation));
      }
      return;
    }

    const moved = {
      x: event.clientX - gesture.current.point.x,
      y: event.clientY - gesture.current.point.y,
    };
    setOffset(
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
    gesture.current = {
      point: centre(),
      offset,
      distance: spread(),
      zoom,
    };
  };

  const onWheel = (event: React.WheelEvent) => {
    if (busy) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta));
      setOffset((o) => clampOffset(o, next, rotation));
      return next;
    });
  };

  const exportCrop = async (): Promise<File> => {
    const img = imgRef.current;
    if (!img || natural.x === 0) throw new Error('Image not ready.');

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');

    ctx.fillStyle = '#F8F9FD';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const scale = OUTPUT_SIZE / cropPx;
    ctx.save();
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
        'image/jpeg',
        JPEG_QUALITY,
      );
    });

    return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' });
  };

  const save = async () => {
    if (busy || !ready) return;
    setPhase('uploading');
    try {
      const file = await exportCrop();
      await onSave(file);
      // Brief ✓ so the close does not feel like the process was cut mid-air.
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

  const statusLabel =
    phase === 'uploading'
      ? 'Uploading…'
      : phase === 'success'
        ? 'Done'
        : `${Math.round(zoom * 100)}%`;

  const hintLabel =
    phase === 'uploading'
      ? 'Uploading your photo…'
      : phase === 'success'
        ? 'Photo updated'
        : 'Pinch or scroll to zoom. Drag to position. Double-tap to reset.';

  return (
    <Overlay>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={phase === 'uploading' || undefined}
        className="fixed inset-0 z-1000 flex flex-col bg-page"
      >
        <header
          className={cn(
            'shrink-0 glass-surface border-x-0 border-t-0 border-b-line',
            'px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3',
          )}
        >
          <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3">
            <h1 id={titleId} className="text-h2 text-ink">
              Move and scale
            </h1>
            <p className="text-caption text-text-secondary" aria-live="polite">
              {statusLabel}
            </p>
          </div>
        </header>

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
              <div className="absolute inset-0 rounded-full ring-2 ring-brand/55" />
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

        <footer
          className={cn(
            'shrink-0 glass-surface border-x-0 border-b-0 border-t-line',
            'px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
            <p className="text-center text-caption text-text-secondary" aria-live="polite">
              {hintLabel}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRotation((r) => (r + 90) % 360);
                  setOffset({ x: 0, y: 0 });
                }}
                disabled={!ready || busy}
              >
                Rotate
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setZoom(MIN_ZOOM);
                  setOffset({ x: 0, y: 0 });
                  setRotation(0);
                }}
                disabled={!ready || busy}
              >
                Reset
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                block
                onClick={onChooseAnother}
                disabled={busy}
              >
                Choose another photo
              </Button>

              {onRemove && (
                <Button
                  type="button"
                  variant="text"
                  size="lg"
                  block
                  onClick={() => void remove()}
                  disabled={busy}
                  className="text-danger hover:bg-danger-soft"
                >
                  Remove photo
                </Button>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="text"
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
          </div>
        </footer>
      </div>
    </Overlay>
  );
}
