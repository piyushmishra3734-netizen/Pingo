/**
 * What PINGO can award, as data.
 *
 * ## Why a registry and not a check
 *
 * The obvious way to draw a badge beside a name is `if (badge === 'mythic')`,
 * and the cost of it only appears with the second badge: by then that check
 * exists in a chat row, a message header, two kinds of user card, a profile and
 * a cabinet, and each one has to be found and widened. The registry is the
 * alternative - a badge is a row here, and every surface renders whatever it is
 * handed.
 *
 * Adding the next achievement is one entry in this file plus a server that
 * awards it. Nothing in the UI changes.
 *
 * ## Tier, and what it is for
 *
 * `tier` is the only thing the experience layer reads. `mythic` turns on the
 * profile aura, the accent and the customisation; an ordinary tier would not,
 * and would still get an indicator beside a name and a place in the cabinet.
 * So a future common badge cannot accidentally hand somebody the rare layer,
 * and a future mythic one gets it for free.
 *
 * ## The art belongs to the badge
 *
 * Two files per achievement, both cut from the artwork as supplied: the emblem
 * for anywhere it has room, and a crest for the sixteen-to-twenty-four pixels
 * beside a name, where the emblem's detail is lost to the scale. See
 * `scripts/make-badge-art.mjs`.
 */

export type AchievementTier = 'standard' | 'mythic';

export interface Achievement {
  /** Matches `user_badges.badge_id` - the server's own name for it. */
  id: string;
  title: string;
  /** One line, on the detail view. Never how it was earned. */
  blurb: string;
  tier: AchievementTier;
  art: {
    /** The full emblem, for a profile or a detail sheet. */
    emblem: string;
    /** The crop that survives being small, for beside a name. */
    crest: string;
  };
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'mythic_pioneer',
    title: 'MYTHIC PIONEER',
    blurb: 'A rare PINGO achievement.',
    tier: 'mythic',
    art: {
      emblem: '/badges/mythic-pioneer-512.png',
      crest: '/badges/mythic-crest-48.png',
    },
  },
];

/**
 * How many slots the cabinet draws in total.
 *
 * The empty ones are not fabricated achievements - they carry no name, no
 * requirement and no promise, only the fact that the collection is not
 * finished. Inventing "Send 100 messages · Locked" here would be telling
 * somebody a rule that does not exist, and they would go and try to satisfy it.
 */
export const CABINET_SLOTS = 6;

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * The one an account leads with, when it has more than one.
 *
 * Rare first, then registry order. A person with three badges has one identity
 * beside their name, and it should be the one that took the most to get.
 */
export function leadAchievement(earnedIds: string[]): Achievement | undefined {
  const earned = ACHIEVEMENTS.filter((a) => earnedIds.includes(a.id));
  return earned.find((a) => a.tier === 'mythic') ?? earned[0];
}

/** Whether any of these earned ids belongs to the rare tier. */
export function hasTier(earnedIds: string[], tier: AchievementTier): boolean {
  return ACHIEVEMENTS.some((a) => a.tier === tier && earnedIds.includes(a.id));
}
