import { CheckIcon, CloseIcon, cn } from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The edit stage: draw on the snap, put text on it, then hand back a flat image.
 *
 * ## Everything is stored in normalised coordinates
 *
 * Strokes and text positions are kept as fractions of the frame (0–1), never as
 * pixels. The preview is whatever size the screen allows; the export is the
 * photo's native resolution — often three times larger. Storing pixels would
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
  /** Normalised points, 0–1. */
  points: { x: number; y: number }[];
}

interface TextItem {
  id: string;
  value: string;
  colour: string;
  /** Normalised centre. */
  x: number;
  y: number;
}

type Tool = 'none' | 'draw' | 'text';

export function SnapEditor({
  src,
  onCancel,
  onDone,
  busy,
}: {
  src: string;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
  busy?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [tool, setTool] = useState<Tool>('none');
  const [colour, setColour] = useState(COLOURS[0]!);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [texts, setTexts] = useState<TextItem[]>([]);
  const drawing = useRef<Stroke | undefined>(undefined);

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

  const flatten = useCallback(async () => {
    const image = imageRef.current;
    if (!image) return;

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;

    const context = out.getContext('2d');
    if (!context) return;

    context.drawImage(image, 0, 0, width, height);

    // Strokes, re-drawn at native size rather than upscaled from the preview —
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

    for (const text of texts) {
      const value = text.value.trim();
      if (!value) continue;

      const x = text.x * width;
      const y = text.y * height;

      /*
       * A dark plate behind the words, matching the on-screen chip.
       *
       * White text on a bright sky is unreadable, and this is the one place the
       * export must not diverge from what the user arranged.
       */
      const metrics = context.measureText(value);
      const padX = fontSize * 0.42;
      const padY = fontSize * 0.3;
      context.fillStyle = 'rgba(16, 17, 20, 0.42)';
      context.beginPath();
      context.roundRect(
        x - metrics.width / 2 - padX,
        y - fontSize / 2 - padY,
        metrics.width + padX * 2,
        fontSize + padY * 2,
        fontSize * 0.36,
      );
      context.fill();

      context.fillStyle = text.colour;
      context.fillText(value, x, y);
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (blob) onDone(blob);
  }, [strokes, texts, onDone]);

  // ---- render -------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-ink">
      <div
        ref={frameRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
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
          className="absolute inset-0 size-full object-contain"
        />

        <canvas ref={canvasRef} className="absolute inset-0 size-full" />

        {texts.map((text) => (
          <DraggableText
            key={text.id}
            item={text}
            frameRef={frameRef}
            onChange={(next) =>
              setTexts((all) => all.map((t) => (t.id === next.id ? next : t)))
            }
            onRemove={() => setTexts((all) => all.filter((t) => t.id !== text.id))}
          />
        ))}

        <button
          type="button"
          aria-label="Discard snap"
          onClick={onCancel}
          className="focus-ring absolute top-4 left-4 grid size-10 place-items-center rounded-full bg-black/40 text-white"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      {/* ---- toolbar --------------------------------------------------- */}
      <div className="shrink-0 space-y-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center gap-2">
          <ToolButton active={tool === 'draw'} onClick={() => setTool(tool === 'draw' ? 'none' : 'draw')}>
            Draw
          </ToolButton>
          <ToolButton
            active={false}
            onClick={() =>
              setTexts((all) => [
                ...all,
                { id: crypto.randomUUID(), value: 'Tap to edit', colour, x: 0.5, y: 0.4 },
              ])
            }
          >
            Text
          </ToolButton>
          <ToolButton
            active={false}
            disabled={strokes.length === 0}
            onClick={() => setStrokes((all) => all.slice(0, -1))}
          >
            Undo
          </ToolButton>
        </div>

        <div className="flex items-center justify-center gap-2.5">
          {COLOURS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Colour ${swatch}`}
              aria-pressed={colour === swatch}
              onClick={() => setColour(swatch)}
              style={{ backgroundColor: swatch }}
              className={cn(
                'focus-ring size-7 rounded-full ring-2 transition-transform duration-instant',
                colour === swatch ? 'scale-115 ring-white' : 'ring-white/30',
              )}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => void flatten()}
          disabled={busy}
          className={cn(
            'focus-ring flex w-full items-center justify-center gap-2 rounded-full',
            'bg-white py-3.5 text-body font-medium text-ink',
            'transition-transform duration-instant active:scale-[0.98]',
            'disabled:opacity-50',
          )}
        >
          <CheckIcon size={18} />
          {busy ? 'Working…' : 'Next'}
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'focus-ring rounded-full px-4 py-2 text-caption font-medium transition-colors duration-instant',
        active ? 'bg-white text-ink' : 'bg-white/12 text-white',
        'disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}

/**
 * One text label: draggable, editable in place, removable.
 *
 * `contentEditable` rather than an `<input>` so the chip grows with the words
 * and wraps like the exported version does.
 */
function DraggableText({
  item,
  frameRef,
  onChange,
  onRemove,
}: {
  item: TextItem;
  frameRef: React.RefObject<HTMLDivElement | null>;
  onChange: (item: TextItem) => void;
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
        <button
          type="button"
          aria-label="Remove text"
          onClick={onRemove}
          className="focus-ring grid size-6 shrink-0 place-items-center rounded-full bg-black/50 text-white"
        >
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  );
}
