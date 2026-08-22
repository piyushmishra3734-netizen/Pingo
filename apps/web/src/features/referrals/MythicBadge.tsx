import { cn } from '@pingo/ui';

/**
 * The MYTHIC PIONEER badge, as supplied.
 *
 * ## Two artworks, both cut from the one file
 *
 * The emblem is a finished piece of design and is not reinterpreted here. What
 * `make-badge-art.mjs` produces is the emblem at three sizes and one crop of it
 * - the crowned ghost - and this component decides which of the two a surface
 * gets.
 *
 * The crop exists because scale destroys the emblem before it destroys the
 * crown. At sixteen pixels beside a name, the wreath, the banner and the word
 * MYTHIC are four grey smudges; the crown and the ghost are two large forms
 * with one silhouette, and they still read. Using the whole emblem there would
 * be faithful to the file and useless to the eye.
 *
 * ## The aura is drawn, and it does not move
 *
 * A gold emblem on a white page has nothing behind it, so it sits on the
 * surface rather than in it. One soft radial wash fixes that and costs nothing:
 * no animation, no pulse, no shimmer. The unlock moment is where motion belongs,
 * and a badge that glimmers on a profile all day spends the surprise the unlock
 * is saving.
 */

/** The full emblem, at the size that suits each surface. */
const EMBLEM = {
  small: '/badges/mythic-pioneer-48.png',
  medium: '/badges/mythic-pioneer-128.png',
  large: '/badges/mythic-pioneer-512.png',
} as const;

/** The crowned ghost, for anywhere the emblem would be too small to read. */
const CREST = {
  mark: '/badges/mythic-crest-48.png',
  crest: '/badges/mythic-crest-96.png',
} as const;

export interface MythicBadgeProps {
  /** `small` sits beside a name; `large` is the subject of the screen. */
  size?: 'small' | 'medium' | 'large';
  /** A soft static wash behind the artwork, so it sits in the page. */
  glow?: boolean;
  className?: string;
  /**
   * Decorative beside a name that already says whose badge it is, and worth
   * announcing when it stands alone.
   */
  title?: string;
}

const BOX = {
  small: 'size-4',
  /* Twenty-five per cent up from 64: the face was winning the profile and this
     is meant to be the thing you look at after the name. */
  medium: 'size-20',
  large: 'size-40 sm:size-56',
} as const;

export function MythicBadge({ size = 'small', glow = false, className, title }: MythicBadgeProps) {
  const image = (
    <img
      src={EMBLEM[size]}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      /*
       * Loaded eagerly at small sizes and lazily at large ones. The indicator is
       * 5 kB and appears beside a name that is already on screen; the full badge
       * is worth deferring until the profile it belongs to is actually open.
       */
      loading={size === 'large' ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
      className={cn(BOX[size], 'relative shrink-0 object-contain select-none', className)}
    />
  );

  if (!glow) return image;

  return (
    <span className="relative inline-grid place-items-center">
      {/*
        Behind the artwork and wider than it, so the light appears to come off
        the badge rather than to be a shape sitting under it. Blurred rather
        than drawn: an edge here would read as a second object.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute size-[150%] rounded-full opacity-45 blur-2xl"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--gradient-from, #7c5cff) 60%, transparent), transparent 70%)',
        }}
      />
      {image}
    </span>
  );
}

/**
 * The mark that sits beside a name.
 *
 * The crest, not the emblem - see the header. Its own component because "does
 * this person have it" is asked in four places, and each of them should render
 * the same nothing when the answer is no.
 */
export function MythicMark({ show, className }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <img
      src={CREST.mark}
      alt=""
      aria-hidden
      loading="eager"
      decoding="async"
      draggable={false}
      className={cn('size-4 shrink-0 translate-y-[0.5px] object-contain select-none', className)}
    />
  );
}

/** The crest at card size, for the achievement block's own use. */
export function MythicCrest({ className }: { className?: string }) {
  return (
    <img
      src={CREST.crest}
      alt=""
      aria-hidden
      decoding="async"
      draggable={false}
      className={cn('size-10 shrink-0 object-contain select-none', className)}
    />
  );
}
