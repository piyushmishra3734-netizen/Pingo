import { cn } from '@pingo/ui';

/**
 * The MYTHIC PIONEER badge, as supplied.
 *
 * ## One artwork, three sizes, no substitutes
 *
 * The emblem was designed and handed over finished. It is not redrawn here, not
 * approximated with an icon at small sizes, and not recoloured to suit a
 * surface it happens to sit on. The 24-pixel mark beside a name in a chat list
 * is the same crown, ghost and laurels as the 512-pixel one on a profile - the
 * only difference is how far away you are standing.
 *
 * The variants are produced by `scripts/make-badge-art.mjs`, which averages the
 * original down and does nothing else. See its header for why a box filter and
 * premultiplied alpha are the difference between a badge and a grey smudge.
 */

/** The file that suits each drawn size, so a 24px mark does not fetch 364 kB. */
const SOURCE = {
  small: '/badges/mythic-pioneer-48.png',
  medium: '/badges/mythic-pioneer-128.png',
  large: '/badges/mythic-pioneer-512.png',
} as const;

export interface MythicBadgeProps {
  /** `small` sits beside a name; `large` is the subject of the screen. */
  size?: 'small' | 'medium' | 'large';
  className?: string;
  /**
   * Decorative beside a name that already says whose badge it is, and worth
   * announcing when it stands alone.
   */
  title?: string;
}

const BOX = {
  small: 'size-4',
  medium: 'size-16',
  large: 'size-40 sm:size-56',
} as const;

export function MythicBadge({ size = 'small', className, title }: MythicBadgeProps) {
  return (
    <img
      src={SOURCE[size]}
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
      className={cn(BOX[size], 'shrink-0 object-contain select-none', className)}
    />
  );
}

/**
 * The indicator that sits beside a name.
 *
 * Its own component because "does this person have it" is asked in four places
 * - the chat list, a group, a profile card, a message header - and each of them
 * should render the same nothing when the answer is no.
 */
export function MythicMark({ show, className }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <MythicBadge
      size="small"
      title="MYTHIC PIONEER"
      className={cn('translate-y-[0.5px]', className)}
    />
  );
}
