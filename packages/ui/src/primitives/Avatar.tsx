import { PingoDot, type DotState } from '../brand/PingoDot.js';
import { cn } from '../utils/cn.js';
import { initials, variantFromSeed } from '../utils/text.js';

/**
 * Avatar, with the brand dot as its presence indicator.
 *
 * Without a photo it renders a monogram on a soft gradient chosen deterministically
 * from the user's id — so the same person is always the same colour, on every
 * device, with no network request and no stored asset. The gradients are all
 * tints of the brand palette, which keeps a list of them looking like one product
 * rather than a bag of confetti.
 *
 * Presence uses `PingoDot`, so an online avatar breathes with exactly the same
 * motion as every other live indicator in PINGO.
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface AvatarProps {
  name: string;
  /** Stable identity for colour selection. Falls back to the name. */
  id?: string;
  src?: string;
  size?: AvatarSize;
  /** Omit for no indicator. `typing` shows the three-dot animation. */
  presence?: DotState | 'offline';
  className?: string;
}

/**
 * Circle diameters, in px.
 *
 * Raised about 10% across the board. The originals were sized for density, and
 * on a phone that read as cramped next to the products people compare this to —
 * a chat row's face is the thing the eye lands on first and it was losing to
 * the text beside it.
 *
 * Deliberately proportional rather than a redesign: every step keeps its
 * relationship to the others, so nothing below has to be re-tuned. `2xl` is
 * unchanged — a profile header is already as large as it should be, and growing
 * it would push the name off a short screen.
 */
const PX: Record<AvatarSize, number> = {
  xs: 30,
  sm: 40,
  md: 48,
  lg: 62,
  xl: 96,
  '2xl': 128,
};

/** Monogram type scales with the circle so it never crowds the edge. */
const TEXT: Record<AvatarSize, string> = {
  xs: 'text-[0.625rem]',
  sm: 'text-caption',
  md: 'text-body',
  lg: 'text-h2',
  xl: 'text-h1',
  '2xl': 'text-display',
};

/** Presence dot size, and the inset that keeps it tangent to the circle. */
const DOT: Record<AvatarSize, { size: number; inset: string }> = {
  xs: { size: 7, inset: '-bottom-0 -right-0' },
  sm: { size: 9, inset: '-bottom-0 -right-0' },
  md: { size: 11, inset: '-bottom-0.5 -right-0.5' },
  lg: { size: 13, inset: '-bottom-0.5 -right-0.5' },
  xl: { size: 18, inset: 'bottom-1 right-1' },
  '2xl': { size: 24, inset: 'bottom-2 right-2' },
};

/**
 * Six tints drawn from the brand gradient's range. Deliberately low-saturation:
 * an avatar is a supporting element, and a wall of vivid circles is exactly the
 * visual noise the product is built to avoid.
 */
const GRADIENTS = [
  'linear-gradient(135deg, #DCE1FF 0%, #EFE2FF 100%)',
  'linear-gradient(135deg, #D6E2FF 0%, #E8DEFF 100%)',
  'linear-gradient(135deg, #E2DEFF 0%, #FBE4FF 100%)',
  'linear-gradient(135deg, #D2DCFF 0%, #E4DCFF 100%)',
  'linear-gradient(135deg, #DEE7FF 0%, #F1E4FF 100%)',
  'linear-gradient(135deg, #D8D9FF 0%, #ECDDFF 100%)',
] as const;

export function Avatar({
  name,
  id,
  src,
  size = 'md',
  presence,
  className,
}: AvatarProps) {
  const px = PX[size];
  const dot = DOT[size];
  const gradient = GRADIENTS[variantFromSeed(id ?? name, GRADIENTS.length)];

  // 'offline' is a valid presence value but shows nothing — an absent dot is the
  // clearest way to say "not here", and it keeps quiet lists quiet.
  const showDot = presence !== undefined && presence !== 'offline';

  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: px, height: px }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          width={px}
          height={px}
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span
          className={cn(
            'flex size-full items-center justify-center rounded-full',
            'font-sans font-medium text-brand/85 select-none',
            TEXT[size],
          )}
          style={{ backgroundImage: gradient }}
          // The adjacent name is the accessible label; a monogram adds nothing.
          aria-hidden
        >
          {initials(name)}
        </span>
      )}

      {showDot && (
        <span
          className={cn(
            'absolute grid place-items-center rounded-full',
            // A ring in the page colour separates the dot from the photo behind it.
            'bg-page p-[2px]',
            dot.inset,
          )}
        >
          <PingoDot
            state={presence}
            /*
             * The three-dot states render a row roughly 5× a single dot wide, which
             * would spill out past the avatar's edge. Scaling them down keeps the
             * whole group inside the same footprint as the one-dot states, so the
             * indicator never changes the avatar's silhouette.
             */
            size={presence === 'typing' || presence === 'loading' ? dot.size * 0.4 : dot.size}
            label={presence === 'typing' ? `${name} is typing` : `${name} is ${presence}`}
          />
        </span>
      )}
    </span>
  );
}

/**
 * Overlapping avatars for group and community rows.
 *
 * Caps at three faces plus a count. Beyond three the stack stops communicating
 * "who" and starts being a texture, so the number does the job better.
 */

/**
 * How far each avatar slides over the one before it, as a fraction of its width.
 *
 * Held at 0.2 because monograms are two characters wide: at the 0.32 that looks
 * right for photos, the next circle lands on top of the previous initials and
 * clips the second letter. The overlap has to clear the widest monogram, not just
 * look tight.
 */
const STACK_OVERLAP = 0.2;
export function AvatarStack({
  people,
  size = 'md',
  max = 3,
  className,
}: {
  people: { id: string; name: string; src?: string }[];
  size?: AvatarSize;
  max?: number;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <span className={cn('inline-flex items-center', className)}>
      {shown.map((person, index) => (
        <span
          key={person.id}
          className="rounded-full ring-2 ring-page"
          // Negative margin creates the overlap; the ring keeps each face readable.
          style={{ marginLeft: index === 0 ? 0 : -PX[size] * STACK_OVERLAP, zIndex: shown.length - index }}
        >
          <Avatar name={person.name} id={person.id} src={person.src} size={size} />
        </span>
      ))}

      {overflow > 0 && (
        <span
          className={cn(
            'grid place-items-center rounded-full bg-sunken ring-2 ring-page',
            'font-sans text-caption font-medium text-text-secondary tabular-nums',
          )}
          style={{
            width: PX[size],
            height: PX[size],
            marginLeft: -PX[size] * STACK_OVERLAP,
          }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
