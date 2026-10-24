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

/** One frosted tray holding the brushes and colours, with the active brush named above it. */
export function DrawDock({ brush, soft = false, children }: { brush: Brush; soft?: boolean; children: ReactNode }) {
  const name = BRUSHES.find((item) => item.id === brush)?.label ?? '';
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-sm flex-col items-center gap-1 rounded-[26px] border px-2 pt-1.5 pb-2 backdrop-blur-xl',
        // `soft` follows the app's theme, for drawing over a conversation; the
        // photo editors sit on a picture and stay dark.
        soft
          ? 'border-line bg-surface/85 shadow-[0_10px_30px_-14px_rgb(16_17_20/0.35)]'
          : 'border-white/12 bg-black/45 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.7)]',
      )}
    >
      <span className="text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">{name}</span>
      {children}
    </div>
  );
}

export function BrushRow({ brush, soft = false, onChange }: { brush: Brush; soft?: boolean; onChange: (brush: Brush) => void }) {
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
            'focus-ring flex size-10 items-center justify-center rounded-full active:scale-90',
            'transition-[background-color,color,transform] duration-150 ease-standard',
            brush === item.id ? 'bg-brand text-on-brand shadow-[0_4px_14px_-4px_var(--color-brand)]' : soft ? 'text-text-secondary hover:bg-sunken' : 'text-white/70 hover:bg-white/10',
          )}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}

/** Rainbow dial for any colour, ending the limit of ten swatches. */
export function ColourRow({ colour, soft = false, onChange }: { colour: string; soft?: boolean; onChange: (colour: string) => void }) {
  const ring = soft ? 'ring-text-primary ring-offset-surface' : 'ring-white ring-offset-ink';
  const idle = soft ? 'ring-1 ring-line' : 'ring-1 ring-white/20';
  const custom = !SWATCHES.includes(colour);
  return (
    <div className="scrollbar-none flex items-center justify-center gap-2 overflow-x-auto px-1 py-1">
      <label
        aria-label="Custom colour"
        className={cn(
          'focus-within:ring-2 relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full',
          custom ? `ring-[1.5px] ring-offset-1 ${ring}` : idle,
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
            colour === swatch ? `ring-[1.5px] ring-offset-1 ${ring}` : idle,
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
  soft = false,
  onChange,
}: {
  size: number;
  colour: string;
  brush: Brush;
  /** Height in px of the picture, to turn a width fraction into a preview dot. */
  frameHeight: number;
  soft?: boolean;
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
          className={cn('absolute inset-y-0 left-1/2 w-3 -translate-x-1/2', soft ? 'bg-text-tertiary' : 'bg-white/40')}
          style={{ clipPath: 'polygon(0 100%, 100% 100%, 100% 0%, 0 55%)', borderRadius: 6 }}
        />
        <div
          className="absolute left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.5)] ring-[3px] ring-brand"
          style={{ top: `${(1 - position) * 100}%` }}
        />
      </div>
      <div
        aria-hidden
        className={cn('flex size-12 items-center justify-center rounded-full backdrop-blur', soft ? 'bg-surface/85 ring-1 ring-line' : 'bg-black/35')}
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
