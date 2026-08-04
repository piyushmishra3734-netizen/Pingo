/**
 * The words Journey is allowed to use.
 *
 * Journey is a personal growth system, not an achievement system, and the
 * fastest way to turn one into the other is vocabulary. "XP", "claim",
 * "collect", "reward", "grind" all carry a game with them: they describe a
 * currency being farmed, and once a user reads the screen that way they will
 * play it that way — and then feel punished on the day they do not.
 *
 * So the unit is **moments**. It counts the same thing the code calls
 * `xpReward`; the field name stays because the registry is not being changed,
 * and an internal identifier is not what anybody reads.
 *
 * Kept in one file so a future screen cannot quietly reintroduce the old
 * vocabulary in a corner nobody re-reads. If a new Journey surface needs a word
 * that is not here, that is a decision to make deliberately rather than in
 * passing.
 */

/** Never appear in the interface. Kept written down so they stay decided. */
export const FORBIDDEN_WORDS = [
  'xp',
  'grind',
  'farm',
  'claim',
  'collect',
  'reward',
  'streak broken',
  'lost',
  'failed',
] as const;

/** The unit, singular and plural. */
export function moments(value: number): string {
  return `${value.toLocaleString()} ${value === 1 ? 'moment' : 'moments'}`;
}

/**
 * What a badge gives, phrased as something gained rather than something paid.
 *
 * "+50 moments" rather than "50 XP reward": the same number, and no suggestion
 * that the badge was a transaction.
 */
export function momentsFrom(value: number): string {
  return `+${value.toLocaleString()} moments`;
}

/**
 * The greeting on the daily card.
 *
 * Time of day rather than a streak count, because a streak is the mechanic that
 * makes missing a day feel like damage — and nothing in Journey is allowed to.
 */
export function greeting(now: Date, name?: string): string {
  const hour = now.getHours();
  const part = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

/**
 * What the app says when somebody has been away.
 *
 * Never "you lost your streak", never a number of days missed. Coming back is
 * the behaviour being encouraged, so it is the behaviour being greeted.
 */
export const WELCOME_BACK = 'Welcome back. Your journey continues.';
