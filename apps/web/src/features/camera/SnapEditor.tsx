import {
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  GridIcon,
  ImageIcon,
  PlusIcon,
  SmileIcon,
  SwapIcon,
  cn,
} from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useStickers } from '../stickers/StickerContext.js';

/**
 * The edit stage: draw on the snap, put text on it, then hand back a flat image.
 *
 * ## Everything is stored in normalised coordinates
 *
 * Strokes and text positions are kept as fractions of the frame (0-1), never as
 * pixels. The preview is whatever size the screen allows; the export is the
 * photo's native resolution - often three times larger. Storing pixels would
 * mean text that sits perfectly on screen and lands somewhere else in the file,
 * and a stroke drawn 4px wide on a phone coming out hairline on a 1280px image.
 *
 * With fractions, export is one multiplication and the result matches the
 * preview exactly at any size.
 *
 * ## Text is DOM while editing, canvas only at export
 *
 * Dragging a `<canvas>`-rendered label means re-rendering the whole scene on
 * every pointer move and writing hit-testing by hand. A positioned `<div>` gets
 * dragging, wrapping and font rendering from the browser. It is only flattened
 * into pixels once, at the end.
 */

const COLOURS = ['#ffffff', '#101114', '#ff3b5c', '#ffc93c', '#3ddc84', '#5c6cff'];

/** Stroke width as a fraction of the frame's smaller side, so it scales. */
const PEN_WIDTH = 0.008;

interface Stroke {
  colour: string;
  /** Normalised points, 0-1. */
  points: { x: number; y: number }[];
}

/**
 * Anything placed on top of the picture.
 *
 * Text, emoji and stickers are one type rather than three, because they are one
 * thing to the user: something you put somewhere and then move. They differ
 * only in what gets painted at export, and three parallel arrays would mean
 * three copies of dragging, removal and the export loop.
 */
interface Item {
  id: string;
  kind: 'text' | 'emoji' | 'sticker';
  /** The words, the emoji, or the sticker's name for its alt text. */
  value: string;
  /** Stickers only. Fetched with CORS at export so the canvas stays clean. */
  url?: string;
  colour: string;
  /** Normalised centre. */
  x: number;
  y: number;
}

/** Normalised crop rectangle, 0-1 over the displayed frame. */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Tool = 'none' | 'draw' | 'text' | 'emoji' | 'sticker' | 'crop';

/**
 * The emoji offered on the toolbar.
 *
 * A short row rather than the full picker. The picker is a panel with search
 * and categories and belongs in a composer; here it would cover the picture you
 * are decorating. Anything not on this row can still be typed into a text
 * label, which is how most emoji reach an image anyway.
 */
const QUICK_EMOJI = ['😂', '❤️', '🔥', '😮', '😢', '✨', '👀', '🎉', '💯', '🙏'];

export function SnapEditor({
  src,
  onCancel,
  onDone,
  busy,
  extras,
  doneLabel = 'Next',
  /**
   * When set, a second button saves this frame and lets the host open another
   * photo (multi-slide stories). Absent for camera send / single-shot flows.
   */
  onAddAnother,
  addAnotherLabel = 'Add another photo',
  untouchable,
}: {
  src: string;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
  busy?: boolean;
  /** Rendered above the confirm button - caption, view limit, whatever fits. */
  extras?: React.ReactNode;
  /** 'Next' from the camera, 'Send' when the picture is going straight out. */
  doneLabel?: string;
  onAddAnother?: (blob: Blob) => void;
  addAnotherLabel?: string;
  /**
   * Bytes to hand back as they are, instead of exporting the canvas.
   *
   * For a picture that moves. Export paints onto a canvas, and a canvas holds
   * one frame - so a GIF came out the far end as a poster of its first moment,
   * which is exactly what it looked like it was not going to do, because the
   * editor was showing the real file animating the whole time.
   *
   * The tools go with it. There is no honest way to draw on an animation here:
   * keeping the frames means not painting on them, and the alternative is
   * offering a pen that silently flattens what it touches.
   */
  untouchable?: Blob;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [tool, setTool] = useState<Tool>('none');
  const [colour, setColour] = useState(COLOURS[0]!);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const drawing = useRef<Stroke | undefined>(undefined);
  /** Quarter turns, clockwise. Applied at export, previewed with a transform. */
  const [rotation, setRotation] = useState(0);
  /** Absent means the whole frame. Applied at export, previewed as a mask. */
  const [crop, setCrop] = useState<Crop | undefined>();
  const [exportError, setExportError] = useState<string>();
  const [exporting, setExporting] = useState(false);

  const addItem = useCallback(
    (item: Omit<Item, 'id' | 'x' | 'y'>) =>
      setItems((all) => [
        ...all,
        // Slightly above centre, where the thumb is not, so a new item is
        // never dropped underneath the finger that asked for it.
        { ...item, id: crypto.randomUUID(), x: 0.5, y: 0.4 },
      ]),
    [],
  );

  // ---- drawing ------------------------------------------------------------

  const toNormalised = useCallback((event: React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const rect = frameRef.current?.getBoundingClientRect();
    const context = canvas?.getContext('2d');
    if (!canvas || !rect || !context) return;

    // Backing store at device resolution; strokes stay crisp on a phone.
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const stroke of all) {
      if (stroke.points.length === 0) continue;
      context.strokeStyle = stroke.colour;
      context.lineWidth = PEN_WIDTH * Math.min(rect.width, rect.height);
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * rect.width;
        const y = point.y * rect.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  }, [strokes]);

  useEffect(paint, [paint]);
  useEffect(() => {
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, [paint]);

  // ---- export -------------------------------------------------------------

  const flatten = useCallback(async (deliver: (blob: Blob) => void = onDone) => {
    if (exporting) return;

    /*
     * A moving picture leaves exactly as it arrived.
     *
     * Before anything else, because everything below this line turns the
     * picture into a single frame.
     */
    if (untouchable) {
      deliver(untouchable);
      return;
    }

    setExportError(undefined);
    setExporting(true);

    try {
      const image = imageRef.current;
      if (!image) throw new Error('Image is not ready.');

      // Next can fire before decode finishes - natural size is then 0 and the
      // export produces nothing, with no feedback.
      if (!image.complete || image.naturalWidth === 0) {
        try {
          await image.decode();
        } catch {
          throw new Error('Image is still loading. Wait a moment and try again.');
        }
      }

      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width < 1 || height < 1) {
        throw new Error('Image is still loading. Wait a moment and try again.');
      }

      /*
       * Rotation is applied to the canvas rather than to the annotations.
       *
       * Strokes and text are stored in the *image's* coordinate space, so drawing
       * them after the canvas has been turned puts them exactly where the user
       * left them relative to the picture - which is what they were aiming at.
       * Rotating each point by hand would be the same maths done worse.
       */
      const quarterTurned = rotation % 180 !== 0;
      const out = document.createElement('canvas');
      out.width = quarterTurned ? height : width;
      out.height = quarterTurned ? width : height;

      const context = out.getContext('2d');
      if (!context) throw new Error('Could not prepare the image.');

      context.translate(out.width / 2, out.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.translate(-width / 2, -height / 2);

      context.drawImage(image, 0, 0, width, height);

      // Strokes, re-drawn at native size rather than upscaled from the preview  - 
      // scaling a bitmap would soften every line.
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const stroke of strokes) {
        if (stroke.points.length === 0) continue;
        context.strokeStyle = stroke.colour;
        context.lineWidth = PEN_WIDTH * Math.min(width, height);
        context.beginPath();
        stroke.points.forEach((point, index) => {
          const x = point.x * width;
          const y = point.y * height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      }

      const fontSize = Math.round(height * 0.052);
      context.font = `600 ${fontSize}px "Space Grotesk", system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      /*
       * Stickers first, fetched with CORS.
       *
       * Drawing a cross-origin image onto a canvas taints it, and a tainted
       * canvas throws on `toBlob` - the export would fail at the very last step,
       * after the user had done all the work. `crossOrigin = 'anonymous'` asks
       * for the CORS headers that keep it clean; the packs are served from a CDN
       * that sends them. A sticker that will not load is skipped rather than
       * taking the whole picture down with it.
       */
      await Promise.all(
        items
          .filter((item) => item.kind === 'sticker' && item.url)
          .map(
            (item) =>
              new Promise<void>((resolve) => {
                const sticker = new Image();
                sticker.crossOrigin = 'anonymous';
                sticker.onload = () => {
                  const size = height * 0.18;
                  const ratio = sticker.naturalWidth / sticker.naturalHeight || 1;
                  const w = ratio >= 1 ? size : size * ratio;
                  const h = ratio >= 1 ? size / ratio : size;
                  context.drawImage(sticker, item.x * width - w / 2, item.y * height - h / 2, w, h);
                  resolve();
                };
                sticker.onerror = () => resolve();
                sticker.src = item.url!;
              }),
          ),
      );

      // Emoji: painted as text, but larger and without the plate a label gets.
      const emojiSize = Math.round(height * 0.12);
      for (const item of items) {
        if (item.kind !== 'emoji') continue;
        context.font = `${emojiSize}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        context.fillText(item.value, item.x * width, item.y * height);
      }

      context.font = `600 ${fontSize}px "Space Grotesk", system-ui, sans-serif`;

      for (const text of items) {
        if (text.kind !== 'text') continue;
        const value = text.value.trim();
        if (!value) continue;

        const x = text.x * width;
        const y = text.y * height;

        /*
         * A dark plate behind the words, matching the on-screen chip.
         *
         * White text on a bright sky is unreadable, and this is the one place the
         * export must not diverge from what the user arranged.
         *
         * `roundRect` is not on every engine - falling back to a plain rect keeps
         * export from throwing after the user finished editing.
         */
        const metrics = context.measureText(value);
        const padX = fontSize * 0.42;
        const padY = fontSize * 0.3;
        const plateX = x - metrics.width / 2 - padX;
        const plateY = y - fontSize / 2 - padY;
        const plateW = metrics.width + padX * 2;
        const plateH = fontSize + padY * 2;
        const radius = fontSize * 0.36;
        context.fillStyle = 'rgba(16, 17, 20, 0.42)';
        context.beginPath();
        if (typeof context.roundRect === 'function') {
          context.roundRect(plateX, plateY, plateW, plateH, radius);
        } else {
          context.rect(plateX, plateY, plateW, plateH);
        }
        context.fill();

        context.fillStyle = text.colour;
        context.fillText(value, x, y);
      }

      /*
       * Crop last, and after rotation on purpose.
       *
       * The rectangle was dragged over the picture as it looked on screen - which
       * is the rotated picture. Cropping the source before turning it would apply
       * the user's rectangle to a different orientation and cut out the wrong
       * part; doing it here means "what was inside the box" is exactly what comes
       * out, whatever else was done first.
       */
      const finished = crop ? cropCanvas(out, crop) : out;

      /*
       * PNG when there is anything to keep transparent, JPEG otherwise.
       *
       * Everything left here as JPEG, which has no alpha channel at all - so a
       * sticker with a cut-out background, a logo, or any PNG somebody sent
       * arrived with its transparency filled in black. The picture was never
       * broken on the way in; it was destroyed on the way out, in the one line
       * that every photo in the product passes through.
       *
       * JPEG stays the default deliberately. A photograph re-encoded as PNG is
       * several times the size for no visible gain, and this is the path a
       * camera shot takes too.
       */
      const type = hasTransparency(finished) ? 'image/png' : 'image/jpeg';

      const blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          finished.toBlob((result) => resolve(result), type, 0.92);
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error('Could not export the image.'));
        }
      });

      if (!blob || blob.size === 0) {
        throw new Error('Could not export the image. Try again.');
      }

      deliver(blob);
    } catch (cause) {
      setExportError(
        cause instanceof Error ? cause.message : 'Could not prepare the story. Try again.',
      );
    } finally {
      setExporting(false);
    }
  }, [strokes, items, rotation, crop, onDone, exporting, untouchable]);

  // ---- render -------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-backdrop">
      {/*
        ~6–8px breathing room so the image is not hard against the viewport
        edge. Function of the frame is unchanged.
      */}
      <div
        ref={frameRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden m-2 rounded-xl"
        onPointerDown={(event) => {
          if (tool !== 'draw') return;
          const point = toNormalised(event);
          if (!point) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = { colour, points: [point] };
          paint();
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const point = toNormalised(event);
          if (!point) return;
          drawing.current.points.push(point);
          paint();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          const stroke = drawing.current;
          drawing.current = undefined;
          setStrokes((all) => [...all, stroke]);
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt="Your snap"
          style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          className="absolute inset-0 size-full object-contain transition-transform duration-quick ease-standard"
        />

        <canvas ref={canvasRef} className="absolute inset-0 size-full" />

        {items.map((item) => (
          <DraggableItem
            key={item.id}
            item={item}
            frameRef={frameRef}
            onChange={(next) => setItems((all) => all.map((t) => (t.id === next.id ? next : t)))}
            onRemove={() => setItems((all) => all.filter((t) => t.id !== item.id))}
          />
        ))}

        {tool === 'crop' && (
          <CropOverlay
            crop={crop ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }}
            frameRef={frameRef}
            onChange={setCrop}
          />
        )}

        <button
          type="button"
          aria-label="Discard snap"
          onClick={onCancel}
          className={cn(
            // ~10% smaller circle, ~15% softer fill - same placement.
            'focus-ring absolute top-3 left-3 grid size-9 place-items-center',
            'rounded-full bg-black/34 text-white backdrop-blur-sm',
            'transition-colors duration-150 ease-standard',
          )}
        >
          <CloseIcon size={18} />
        </button>
      </div>

      {/* ---- toolbar --------------------------------------------------- */}
      <div
        className={cn(
          'shrink-0 space-y-2.5 px-3 pt-2.5',
          // +8px above browser chrome / home indicator so tools are not crowded.
          'pb-[max(calc(1rem+8px),calc(env(safe-area-inset-bottom)+8px))]',
        )}
      >
        {/*
          No tools on a picture that moves - see `untouchable`. Every one of
          them writes onto a single frame, so offering them would be offering to
          quietly turn an animation into a still. The caption and the view limit
          below still apply, because those are properties of the send rather
          than of the pixels.
        */}
        {!untouchable && (
        <>
        {/*
          One floating bar, in the app's own material.

          The tools were six bare word-chips in a row across the bottom of the
          screen - no icons, no grouping, nothing holding them together - which
          read as a debug strip rather than as part of the product. A glass bar
          with a glyph over each label is the same six controls, given the shape
          everything else that floats here already has.
        */}
        <div
          className={cn(
            'mx-auto w-fit max-w-full rounded-2xl px-1.5 py-1',
            'border border-white/12 bg-white/10 backdrop-blur-xl',
            'shadow-[0_8px_28px_-12px_rgb(0_0_0/0.65)]',
          )}
        >
        <div className="scrollbar-none flex items-center justify-center gap-0.5 overflow-x-auto">
          <ToolButton
            label="Draw"
            icon={<EditIcon size={17} />}
            active={tool === 'draw'}
            onClick={() => setTool(tool === 'draw' ? 'none' : 'draw')}
          />
          <ToolButton
            label="Text"
            /* The letter is the icon. No glyph in the set says "type here" as
               plainly as a T, and inventing one would be worse than using it. */
            icon={<span className="text-[15px] leading-none font-semibold">T</span>}
            active={false}
            onClick={() => addItem({ kind: 'text', value: 'Tap to edit', colour })}
          />
          <ToolButton
            label="Emoji"
            icon={<SmileIcon size={17} />}
            active={tool === 'emoji'}
            onClick={() => setTool(tool === 'emoji' ? 'none' : 'emoji')}
          />
          <ToolButton
            label="Stickers"
            icon={<ImageIcon size={17} />}
            active={tool === 'sticker'}
            onClick={() => setTool(tool === 'sticker' ? 'none' : 'sticker')}
          />
          <ToolButton
            label="Crop"
            icon={<GridIcon size={17} />}
            active={tool === 'crop'}
            onClick={() => {
              if (tool === 'crop') {
                setTool('none');
                return;
              }
              setTool('crop');
              // Opening the tool proposes a crop rather than making the user
              // draw one from nothing on top of their own picture.
              setCrop((current) => current ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
            }}
          />
          {/*
            A quarter turn per press, which is the whole of rotation as anyone
            uses it - the photo is sideways or it is not. A free-angle dial
            would be a second gesture to learn for a case that barely occurs.
          */}
          <ToolButton
            label="Rotate"
            icon={<SwapIcon size={17} />}
            active={false}
            onClick={() => setRotation((r) => (r + 90) % 360)}
          />
          <ToolButton
            label="Undo"
            icon={<ArrowLeftIcon size={17} />}
            active={false}
            disabled={strokes.length === 0}
            onClick={() => setStrokes((all) => all.slice(0, -1))}
          />
        </div>
        </div>

        {tool === 'emoji' && (
          <div
            className={cn(
              'flex items-center justify-center gap-1 overflow-x-auto pb-0.5',
              // Calm fade only - no bounce when the strip opens.
              'animate-fade-in [animation-duration:150ms]',
            )}
          >
            {QUICK_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Add ${emoji}`}
                onClick={() => addItem({ kind: 'emoji', value: emoji, colour })}
                className={cn(
                  'focus-ring grid size-9 shrink-0 place-items-center rounded-full text-[1.25rem]',
                  'transition-colors duration-150 ease-standard hover:bg-white/10 active:opacity-80',
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {tool === 'sticker' && (
          <div className="animate-fade-in [animation-duration:150ms]">
            <StickerStrip
              onPick={(sticker) =>
                addItem({ kind: 'sticker', value: sticker.name, url: sticker.url, colour })
              }
              onPickCustomUrl={(url, name) =>
                addItem({ kind: 'sticker', value: name, url, colour })
              }
            />
          </div>
        )}

        {tool === 'crop' && (
          <div
            className={cn(
              'flex items-center justify-center gap-1',
              'animate-fade-in [animation-duration:150ms]',
            )}
          >
            <ToolButton
              label="Reset"
              icon={<ArrowLeftIcon size={17} />}
              active={false}
              onClick={() => setCrop(undefined)}
            />
            <ToolButton
              label="Done"
              icon={<CheckIcon size={17} />}
              active
              onClick={() => setTool('none')}
            />
          </div>
        )}
        </>
        )}

        {/* Caption, view limit - supplied by whoever is using the editor. */}
        {extras}

        {/* Belongs to the pen, so it goes when the pen does. */}
        {!untouchable && (
        <div className="flex items-center justify-center gap-2">
          {COLOURS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Colour ${swatch}`}
              aria-pressed={colour === swatch}
              onClick={() => setColour(swatch)}
              style={{ backgroundColor: swatch }}
              className={cn(
                // ~2–3px smaller than size-7; equal gap-2; no scale bounce.
                'focus-ring size-6 shrink-0 rounded-full',
                'transition-[box-shadow,ring-color] duration-150 ease-standard',
                colour === swatch
                  ? 'ring-[1.5px] ring-white ring-offset-1 ring-offset-ink'
                  : 'ring-1 ring-white/20',
              )}
            />
          ))}
        </div>
        )}

        {exportError && (
          <p role="alert" className="text-center text-caption text-danger">
            {exportError}
          </p>
        )}

        {/*
          Side by side, and the primary is the brand's.

          They were two full-width bars stacked against the bottom edge, both
          the same width and weight, one white and one grey - which asks the
          user to read before knowing which one finishes the job. On one line
          the shapes do the telling: "add another" stays a quiet glass control
          and only ever takes the room its words need, and the gradient is the
          same one every primary action in the product wears.
        */}
        <div className="flex items-center gap-2">
          {onAddAnother && (
            <button
              type="button"
              onClick={() => void flatten(onAddAnother)}
              disabled={busy || exporting}
              className={cn(
                'focus-ring flex shrink-0 items-center justify-center gap-2 rounded-full',
                'border border-white/20 bg-white/10 px-4 py-3 text-caption font-medium text-white',
                'backdrop-blur-xl transition-transform duration-150 ease-standard active:scale-[0.97]',
                'disabled:opacity-50',
              )}
            >
              <PlusIcon size={16} />
              {addAnotherLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => void flatten()}
            disabled={busy || exporting}
            className={cn(
              'focus-ring flex flex-1 items-center justify-center gap-2 rounded-full',
              'bg-brand-gradient py-3 text-body font-semibold text-white',
              'shadow-[0_6px_20px_-8px_rgb(224_85_155/0.75)]',
              'transition-transform duration-150 ease-standard active:scale-[0.98]',
              'disabled:opacity-50',
            )}
          >
            <CheckIcon size={17} />
            {busy || exporting ? 'Working…' : doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One tool: a glyph with its name under it.
 *
 * It was a word in a pill. Seven words in a row is a sentence the eye has to
 * read before it can act, and at this size they were also the smallest touch
 * targets on the screen. A shape is recognised without reading, and the label
 * stays underneath so nothing has to be guessed - which is the arrangement
 * every camera app converges on for the same reason.
 */
function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        'focus-ring flex shrink-0 flex-col items-center gap-1 rounded-xl px-2.5 py-1.5',
        'transition-[background-color,color,transform] duration-150 ease-standard',
        'active:scale-[0.96]',
        active ? 'bg-white text-backdrop' : 'text-white/85 hover:bg-white/10',
        'disabled:opacity-35',
      )}
    >
      <span aria-hidden className="grid h-[18px] place-items-center">
        {icon}
      </span>
      <span aria-hidden className="text-[0.6875rem] leading-none font-medium">
        {label}
      </span>
    </button>
  );
}

/**
 * Crops a finished canvas to a normalised rectangle.
 *
 * Rounded to whole pixels, and never to nothing: a rectangle dragged to a
 * hairline would otherwise produce a zero-width canvas, which `toBlob` answers
 * with `null` and the caller reads as "the export failed".
 */
/**
 * Whether anything in the finished picture is see-through.
 *
 * Asked of a 64px copy rather than the real canvas. Reading the pixels of a
 * twelve-megapixel export means allocating forty-odd megabytes to answer a
 * yes/no question, on the phone, at the moment the user is waiting for their
 * photo to send. Scaling down first costs one `drawImage` and reads sixteen
 * kilobytes.
 *
 * Downscaling averages, so a transparent region arrives as a partially
 * transparent pixel rather than disappearing - which is the direction that
 * matters. A single stray see-through pixel in a huge image can average away,
 * and that is the right trade: it was invisible anyway, and the alternative is
 * turning every photograph into a PNG on the strength of one pixel.
 */
function hasTransparency(source: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  const size = 64;
  probe.width = size;
  probe.height = size;

  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  try {
    context.drawImage(source, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 250) return true;
    }
    return false;
  } catch {
    // A tainted canvas cannot be read. JPEG is the safe answer: it is what
    // this always produced, so the failure mode is the old behaviour rather
    // than a broken export.
    return false;
  }
}

function cropCanvas(source: HTMLCanvasElement, crop: Crop): HTMLCanvasElement {
  const sx = Math.round(crop.x * source.width);
  const sy = Math.round(crop.y * source.height);
  const sw = Math.max(1, Math.round(crop.w * source.width));
  const sh = Math.max(1, Math.round(crop.h * source.height));

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  out.getContext('2d')?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/**
 * The crop rectangle: drag inside to move it, drag a corner to resize.
 *
 * Four corners rather than eight handles. Edge handles are the difference
 * between adjusting one side and adjusting two, which matters on a desktop with
 * a mouse and is a coin toss on a phone where the handle is smaller than the
 * fingertip. Corners cover both cases with half the targets.
 *
 * Everything outside the rectangle is dimmed rather than hidden, so the picture
 * you are cutting from stays visible while you decide.
 */
function CropOverlay({
  crop,
  frameRef,
  onChange,
}: {
  crop: Crop;
  frameRef: React.RefObject<HTMLDivElement | null>;
  onChange: (crop: Crop) => void;
}) {
  const drag = useRef<
    { corner: string | undefined; x: number; y: number; from: Crop } | undefined
  >(undefined);

  const at = (event: React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const start = (corner: string | undefined) => (event: React.PointerEvent) => {
    event.stopPropagation();
    const point = at(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { corner, x: point.x, y: point.y, from: crop };
  };

  const move = (event: React.PointerEvent) => {
    const state = drag.current;
    const point = at(event);
    if (!state || !point) return;

    const dx = point.x - state.x;
    const dy = point.y - state.y;
    const { from } = state;
    // Never smaller than a tenth of the frame, so the rectangle cannot be lost.
    const MIN = 0.1;

    if (!state.corner) {
      onChange({
        ...from,
        x: Math.min(1 - from.w, Math.max(0, from.x + dx)),
        y: Math.min(1 - from.h, Math.max(0, from.y + dy)),
      });
      return;
    }

    const left = state.corner.includes('w');
    const top = state.corner.includes('n');

    const x = left ? Math.min(from.x + from.w - MIN, Math.max(0, from.x + dx)) : from.x;
    const y = top ? Math.min(from.y + from.h - MIN, Math.max(0, from.y + dy)) : from.y;
    const w = left ? from.x + from.w - x : Math.min(1 - from.x, Math.max(MIN, from.w + dx));
    const h = top ? from.y + from.h - y : Math.min(1 - from.y, Math.max(MIN, from.h + dy));

    onChange({ x, y, w, h });
  };

  const end = () => {
    drag.current = undefined;
  };

  const corners = [
    ['nw', 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'],
    ['ne', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'],
    ['sw', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'],
    ['se', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'],
  ] as const;

  return (
    <div className="absolute inset-0 touch-none" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {/* The dimmed surround, drawn as four bands rather than a hole. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-backdrop/55" style={{ height: `${crop.y * 100}%` }} />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-backdrop/55"
        style={{ height: `${(1 - crop.y - crop.h) * 100}%` }}
      />
      <div
        className="pointer-events-none absolute left-0 bg-backdrop/55"
        style={{ top: `${crop.y * 100}%`, height: `${crop.h * 100}%`, width: `${crop.x * 100}%` }}
      />
      <div
        className="pointer-events-none absolute right-0 bg-backdrop/55"
        style={{
          top: `${crop.y * 100}%`,
          height: `${crop.h * 100}%`,
          width: `${(1 - crop.x - crop.w) * 100}%`,
        }}
      />

      <div
        role="group"
        aria-label="Crop area"
        onPointerDown={start(undefined)}
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.w * 100}%`,
          height: `${crop.h * 100}%`,
        }}
        className="absolute cursor-move border-2 border-white/90"
      >
        {corners.map(([corner, position]) => (
          <span
            key={corner}
            role="slider"
            tabIndex={0}
            aria-label={`Crop ${corner} corner`}
            aria-valuenow={Math.round(crop.w * 100)}
            onPointerDown={start(corner)}
            className={cn('absolute size-6 rounded-full border-2 border-white bg-backdrop/70', position)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A horizontal strip of stickers from the installed packs, plus custom
 * sticker / GIF uploads for the story editor.
 *
 * Deliberately not the full `StickerPicker`: that is a tall panel with search
 * and categories, and over a picture you are decorating it would cover the
 * thing you are working on. A strip keeps the image visible, which is the only
 * way to judge where a sticker should go.
 *
 * Custom GIF/sticker files become object URLs placed like pack stickers.
 * Export still flattens to one frame (canvas) — animated GIFs used as stickers
 * freeze on export; pick a still PNG/WebP for stickers you want sharp forever.
 */
function StickerStrip({
  onPick,
  onPickCustomUrl,
}: {
  onPick: (sticker: { name: string; url: string }) => void;
  onPickCustomUrl?: (url: string, name: string) => void;
}) {
  const { packs, loading } = useStickers();
  const stickers = packs.flatMap((pack) => pack.stickers).slice(0, 40);
  const customStickerRef = useRef<HTMLInputElement>(null);
  const customGifRef = useRef<HTMLInputElement>(null);

  const openInput = (el: HTMLInputElement | null) => {
    if (!el) return;
    el.value = '';
    window.requestAnimationFrame(() => el.click());
  };

  const onCustomFile = (file: File | undefined, label: string) => {
    if (!file || !onPickCustomUrl) return;
    const url = URL.createObjectURL(file);
    onPickCustomUrl(url, label);
  };

  return (
    <div className="space-y-2">
      <div className="scrollbar-none flex items-center gap-2 overflow-x-auto pb-1">
        {/* Custom first — the options that were wrongly on “Add to story”. */}
        <button
          type="button"
          onClick={() => openInput(customStickerRef.current)}
          aria-label="Custom sticker"
          className={cn(
            'focus-ring flex size-12 shrink-0 flex-col items-center justify-center gap-0.5',
            'rounded-xl border border-dashed border-white/35 bg-white/8',
            'text-[0.55rem] font-semibold tracking-wide text-white/85',
            'transition-transform duration-instant active:scale-95',
          )}
        >
          <span className="text-[0.95rem] leading-none">✦</span>
          Custom
        </button>
        <button
          type="button"
          onClick={() => openInput(customGifRef.current)}
          aria-label="Custom GIF sticker"
          className={cn(
            'focus-ring flex size-12 shrink-0 flex-col items-center justify-center gap-0.5',
            'rounded-xl border border-dashed border-white/35 bg-white/8',
            'text-[0.55rem] font-semibold tracking-wide text-white/85',
            'transition-transform duration-instant active:scale-95',
          )}
        >
          <span className="text-[0.7rem] font-bold leading-none">GIF</span>
          Custom
        </button>

        {loading && (
          <p className="px-2 text-caption text-white/60">Loading packs…</p>
        )}
        {!loading &&
          stickers.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              onClick={() => onPick(sticker)}
              aria-label={`Add sticker ${sticker.name}`}
              className={cn(
                'focus-ring size-12 shrink-0 rounded-lg p-1',
                'transition-transform duration-instant hover:bg-white/10 active:scale-110',
              )}
            >
              <img src={sticker.url} alt="" loading="lazy" className="size-full object-contain" />
            </button>
          ))}
        {!loading && stickers.length === 0 && (
          <p className="px-1 text-caption text-white/55">No pack stickers yet</p>
        )}
      </div>

      <input
        ref={customStickerRef}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/*"
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onCustomFile(file, file?.name || 'Custom sticker');
        }}
      />
      <input
        ref={customGifRef}
        type="file"
        accept="image/gif,.gif,image/webp"
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onCustomFile(file, file?.name || 'Custom GIF');
        }}
      />
    </div>
  );
}

/**
 * One placed item: draggable, removable, and editable when it is text.
 *
 * `contentEditable` rather than an `<input>` so the chip grows with the words
 * and wraps like the exported version does. Emoji and stickers are not
 * editable - there is nothing in them to edit - so they get the drag and the
 * remove button and nothing else.
 */
function DraggableItem({
  item,
  frameRef,
  onChange,
  onRemove,
}: {
  item: Item;
  frameRef: React.RefObject<HTMLDivElement | null>;
  onChange: (item: Item) => void;
  onRemove: () => void;
}) {
  const dragging = useRef(false);

  return (
    <div
      style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}
      className="absolute -translate-x-1/2 -translate-y-1/2 touch-none"
      onPointerDown={(event) => {
        // Stops the draw tool from painting a stroke under the label.
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) return;
        onChange({
          ...item,
          x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
          y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        });
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      <div className="flex items-center gap-1.5">
        {item.kind === 'text' && (
          <span
            role="textbox"
            tabIndex={0}
            contentEditable
            suppressContentEditableWarning
            style={{ color: item.colour }}
            onBlur={(event) => onChange({ ...item, value: event.currentTarget.textContent ?? '' })}
            className="focus-ring max-w-[70vw] rounded-lg bg-black/40 px-3 py-1.5 text-h2 outline-none"
          >
            {item.value}
          </span>
        )}

        {item.kind === 'emoji' && (
          <span className="text-[3rem] leading-none select-none" aria-label={item.value}>
            {item.value}
          </span>
        )}

        {item.kind === 'sticker' && item.url && (
          <img
            src={item.url}
            alt={item.value}
            draggable={false}
            className="size-24 object-contain select-none"
          />
        )}

        <button
          type="button"
          aria-label={`Remove ${item.kind === 'text' ? 'text' : item.value}`}
          onClick={onRemove}
          className="focus-ring grid size-6 shrink-0 place-items-center rounded-full bg-black/50 text-white"
        >
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  );
}
