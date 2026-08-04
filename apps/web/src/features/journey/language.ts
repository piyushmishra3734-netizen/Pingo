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

const MONTHS_SPELLED = [
  '',
  'One month',
  'Two months',
  'Three months',
  'Four months',
  'Five months',
  'Six months',
  'Seven months',
  'Eight months',
  'Nine months',
  'Ten months',
  'Eleven months',
] as const;

/**
 * The one line on Journey that says something rather than counts something.
 *
 * It has to be *true*, which is why it is derived from when the story actually
 * starts rather than written once and shipped. The stand-in copy said "Three
 * months of conversations" to everybody, including somebody on their first day
 * — flattering, and false, and the kind of detail that quietly tells a user
 * none of the screen is real.
 */
export function encouragementFor(startedAt: number, now = Date.now()): string {
  const days = Math.floor((now - startedAt) / (24 * 60 * 60 * 1000));

  /*
   * The bands never round upwards.
   *
   * "A few weeks of conversations" started at seven days, so a ten-day-old
   * account — which is every account, on an app this young — was told it had
   * weeks of history behind it. Nobody is flattered by a number they can check;
   * they just stop believing the rest of the screen. Each band now describes the
   * *shortest* thing that could be true of it.
   */
  if (days < 3) return 'Your journey starts here.';
  if (days < 14) return 'The first days of it.';
  if (days < 30) return 'A couple of weeks in, and still going.';

  const months = Math.floor(days / 30);
  const spelled = MONTHS_SPELLED[months];
  if (spelled) return `${spelled} of conversations, and still going.`;

  const years = Math.floor(days / 365);
  return years <= 1
    ? 'Over a year of conversations, and still going.'
    : `Years of conversations, and still going.`;
}

/**
 * What the app says when somebody has been away.
 *
 * Never "you lost your streak", never a number of days missed. Coming back is
 * the behaviour being encouraged, so it is the behaviour being greeted.
 */
export const WELCOME_BACK = 'Welcome back. Your journey continues.';
