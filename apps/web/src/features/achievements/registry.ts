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
    id: 'founder',
    title: 'FOUNDER',
    /*
     * `tier` stays standard on purpose. The rare tier is not a ranking, it is
     * the switch for the aura, the accent and the customisation - and FOUNDER
     * is a badge, not a second experience layer. Both accounts that hold it
     * also hold MYTHIC PIONEER, so they keep that layer through `hasTier`,
     * which reads everything earned rather than whatever is on show.
     */
    tier: 'standard',
    blurb: 'One of the two who started PINGO.',
    art: {
      emblem: '/badges/founder-512.png',
      crest: '/badges/founder-crest-48.png',
    },
  },
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
 * ## The owner decides, and only then do we
 *
 * `displayedId` is the badge that account chose to wear - `user_badges.displayed`
 * on the server, so everybody looking at them sees the same one. It wins over
 * anything this function would work out, which is the point: with one badge
 * "which do you own" and "which do you show" were the same question, and with
 * two they are not.
 *
 * A choice is only honoured if it is also earned. That is belt and braces - the
 * column lives on the earned row, so an unearned badge has nowhere to store the
 * flag - but this function is handed loose ids and should not trust them.
 *
 * Falling back: rare first, then registry order. Unchanged, and what every
 * account that has never chosen still gets.
 */
export function leadAchievement(
  earnedIds: string[],
  displayedId?: string,
): Achievement | undefined {
  const earned = ACHIEVEMENTS.filter((a) => earnedIds.includes(a.id));
  const chosen = displayedId ? earned.find((a) => a.id === displayedId) : undefined;
  return chosen ?? earned.find((a) => a.tier === 'mythic') ?? earned[0];
}

/** Whether any of these earned ids belongs to the rare tier. */
export function hasTier(earnedIds: string[], tier: AchievementTier): boolean {
  return ACHIEVEMENTS.some((a) => a.tier === tier && earnedIds.includes(a.id));
}
