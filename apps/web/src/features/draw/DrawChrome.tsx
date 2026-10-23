import { Eraser, Highlighter, MoveUpRight, Pencil, PenLine, Sparkles } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { cn } from '@pingo/ui';
import { SWATCHES, positionOf, sizeAt, type Brush } from './brushes';

/**
 * The controls for drawing on a picture, shared by every editor that offers it.
 * They only change the brush, width and colour; painting lives in `brushes.ts`.
 */

const BRUSHES: { id: Brush; label: string; icon: ReactNode }[] = [
  { id: 'pen', label: 'Pen', icon: <PenLine size={18} strokeWidth={1.9} /> },
  { id: 'marker', label: 'Marker', icon: <Highlighter size={18} strokeWidth={1.9} /> },
  { id: 'neon', label: 'Neon', icon: <Sparkles size={18} strokeWidth={1.9} /> },
  { id: 'chalk', label: 'Chalk', icon: <Pencil size={18} strokeWidth={1.9} /> },
  { id: 'arrow', label: 'Arrow', icon: <MoveUpRight size={18} strokeWidth={1.9} /> },
  { id: 'eraser', label: 'Eraser', icon: <Eraser size={18} strokeWidth={1.9} /> },
];

export function BrushRow({ brush, onChange }: { brush: Brush; onChange: (brush: Brush) => void }) {
  return (
    <div role="radiogroup" aria-label="Brush" className="flex items-center justify-center gap-1">
      {BRUSHES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={brush === item.id}
          aria-label={item.label}
          onClick={() => onChange(item.id)}
          className={cn(
            'focus-ring flex size-10 items-center justify-center rounded-full',
            'transition-[background-color,color,transform] duration-150 ease-standard',
            brush === item.id ? 'bg-white text-black' : 'text-white/75 hover:bg-white/10',
          )}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}

/** Rainbow dial for any colour, ending the limit of ten swatches. */
export function ColourRow({ colour, onChange }: { colour: string; onChange: (colour: string) => void }) {
  const custom = !SWATCHES.includes(colour);
  return (
    <div className="scrollbar-none flex items-center justify-center gap-2 overflow-x-auto px-1 py-1">
      <label
        aria-label="Custom colour"
        className={cn(
          'focus-within:ring-2 relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full ring-white',
          custom ? 'ring-[1.5px] ring-offset-1 ring-offset-ink' : 'ring-1 ring-white/20',
        )}
        style={{
          background: custom
            ? colour
            : 'conic-gradient(#ff3b5c, #ffd60a, #34c759, #0a84ff, #bf5af2, #ff3b5c)',
        }}
      >
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(colour) ? colour : '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      {SWATCHES.map((swatch) => (
        <button
          key={swatch}
          type="button"
          aria-label={`Colour ${swatch}`}
          aria-pressed={colour === swatch}
          onClick={() => onChange(swatch)}
          style={{ backgroundColor: swatch }}
          className={cn(
            'focus-ring size-6 shrink-0 rounded-full transition-[box-shadow] duration-150 ease-standard',
            colour === swatch ? 'ring-[1.5px] ring-white ring-offset-1 ring-offset-ink' : 'ring-1 ring-white/20',
          )}
        />
      ))}
    </div>
  );
}

/**
 * A tapered vertical slider on the left edge, thin at the bottom and thick at
 * the top, with a dot beside the thumb showing the real width while you drag.
 */
export function SizeSlider({
  size,
  colour,
  brush,
  frameHeight,
  onChange,
}: {
  size: number;
  colour: string;
  brush: Brush;
  /** Height in px of the picture, to turn a width fraction into a preview dot. */
  frameHeight: number;
  onChange: (size: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const position = positionOf(size);

  const set = (clientY: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(sizeAt(1 - (clientY - rect.top) / rect.height));
  };

  const dot = Math.max(4, Math.min(44, size * frameHeight * (brush === 'marker' ? 2.4 : brush === 'eraser' ? 2.2 : 1)));

  return (
    <div className="pointer-events-none absolute top-1/2 left-2 z-20 flex -translate-y-1/2 items-center gap-2">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Brush size"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position * 100)}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          set(event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) set(event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') onChange(sizeAt(Math.min(1, position + 0.06)));
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') onChange(sizeAt(Math.max(0, position - 0.06)));
        }}
        className="pointer-events-auto relative h-44 w-8 touch-none"
      >
        {/* The taper: a wedge, wide at the top. */}
        <div
          className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 bg-white/35"
          style={{ clipPath: 'polygon(0 100%, 100% 100%, 100% 0%, 0 55%)', borderRadius: 6 }}
        />
        <div
          className="absolute left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.5)]"
          style={{ top: `${(1 - position) * 100}%` }}
        />
      </div>
      <div
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-black/35 backdrop-blur"
      >
        <span
          className="rounded-full"
          style={{
            width: dot,
            height: dot,
            background: brush === 'eraser' ? 'transparent' : colour,
            border: brush === 'eraser' ? '1.5px dashed #fff' : undefined,
            boxShadow: brush === 'neon' ? `0 0 ${dot}px ${colour}` : undefined,
          }}
        />
      </div>
    </div>
  );
}
