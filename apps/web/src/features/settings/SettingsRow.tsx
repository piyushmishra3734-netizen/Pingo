import { ChevronRightIcon, cn } from '@pingo/ui';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * One row on the settings index.
 *
 * ## The ripple
 *
 * Touch → ripple → navigate. The circle grows from the exact point that was
 * pressed, which is what makes it feel like the row responded to *you* rather
 * than playing a canned animation.
 *
 * Navigation is **not** delayed to wait for it. A row that holds you for 200ms
 * to finish being pretty is a row that feels slow the tenth time you use it  - 
 * the ripple simply plays out under the outgoing screen.
 *
 * A row with no destination yet says so. It still shows, because the index is
 * the map of the product and hiding what is coming makes the map wrong, but it
 * does not accept a tap it cannot honour.
 */

/**
 * The colour of a row's icon tile.
 *
 * Settings is a list people scan for a shape, not read, and a column of
 * identical purple glyphs gave the eye nothing to land on. A colour per kind
 * of thing - the way iOS and Telegram do it - is what makes "the green one"
 * findable without reading a word. White glyph on a saturated tile, the same
 * in both themes.
 */
export type RowTone =
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'green'
  | 'teal'
  | 'sky'
  | 'gray';

const TONE: Record<RowTone, string> = {
  blue: 'bg-[#2f7cf6]',
  indigo: 'bg-[#5b5bd6]',
  purple: 'bg-[#8b5dff]',
  pink: 'bg-[#e0559b]',
  red: 'bg-[#ef4444]',
  orange: 'bg-[#f5871f]',
  green: 'bg-[#22b35e]',
  teal: 'bg-[#14a3a3]',
  sky: 'bg-[#1ea0e6]',
  gray: 'bg-[#8a8d9a]',
};

export interface SettingsRowProps {
  icon: ReactNode;
  label: string;
  /** A coloured tile behind the icon. Without it, the plain tinted one. */
  tone?: RowTone;
  /** Absent means the page does not exist yet. */
  to?: string;
  /** Right-hand summary, e.g. the current accent name. */
  value?: string;
  destructive?: boolean;
  onClick?: () => void;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export function SettingsRow({
  icon,
  label,
  to,
  value,
  destructive = false,
  onClick,
  tone,
}: SettingsRowProps) {
  const navigate = useNavigate();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const available = Boolean(to || onClick);

  const press = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!available) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ripple: Ripple = {
      id: nextId.current++,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    setRipples((previous) => [...previous, ripple]);
    // Removed after the animation, so a long session does not accumulate spans.
    window.setTimeout(
      () => setRipples((previous) => previous.filter((item) => item.id !== ripple.id)),
      600,
    );

    if (onClick) onClick();
    else if (to) navigate(to);
  };

  return (
    <button
      type="button"
      onClick={press}
      disabled={!available}
      className={cn(
        'relative flex w-full items-center gap-3.5 overflow-hidden rounded-md px-3 py-3.5',
        'focus-ring text-left',
        'transition-colors duration-instant ease-standard',
        available ? 'hover:bg-hover active:bg-pressed' : 'cursor-default',
      )}
    >
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          aria-hidden
          className={cn(
            'pointer-events-none absolute size-24 rounded-full',
            'bg-brand/25 animate-settings-ripple',
          )}
          style={{ left: ripple.x - 48, top: ripple.y - 48 }}
        />
      ))}

      <span
        className={cn(
          'relative grid shrink-0 place-items-center',
          tone ? 'size-8 rounded-[9px] text-white' : 'size-9 rounded-md',
          tone ? TONE[tone] : destructive ? 'bg-danger-soft text-danger' : 'bg-sunken text-brand',
          !available && 'opacity-45',
        )}
        aria-hidden
      >
        {icon}
      </span>

      <span
        className={cn(
          'relative min-w-0 flex-1 truncate text-body',
          destructive ? 'text-danger' : 'text-ink',
          !available && 'opacity-45',
        )}
      >
        {label}
      </span>

      {value && (
        <span className="relative shrink-0 text-caption text-text-secondary">{value}</span>
      )}

      {!available ? (
        <span className="relative shrink-0 text-caption text-text-tertiary">Soon</span>
      ) : (
        !destructive && (
          <ChevronRightIcon size={18} className="relative shrink-0 text-text-tertiary" />
        )
      )}
    </button>
  );
}
