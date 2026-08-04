/**
 * From moments to a level, and from a device to a history.
 *
 * Two things live here, and they are together because they are the same
 * concern: what Journey is allowed to show after the numbers are counted.
 *
 * ## Journey may never go backwards
 *
 * This is the rule that makes the rest of it safe. Counts are computed from
 * what *this device* has — a fresh install, a cache trimmed to save space, or a
 * restore that only brought back a year would each produce a smaller number
 * than yesterday. Watching a level drop because you changed phones is exactly
 * the "punished" feeling the philosophy rules out, and it is also just wrong:
 * the conversations happened.
 *
 * So progress is merged rather than replaced. Moments take the higher of the
 * two, badges are a union, and an unlock date is the earliest ever seen. The
 * stored copy is a floor, never a source of truth about what happened.
 *
 * ## The curve is gentle and gets gentler
 *
 * Early levels arrive quickly, because the first week is when somebody decides
 * whether any of this means anything. Later ones take longer, but the cost
 * grows linearly rather than exponentially — an exponential curve is how a
 * progression system tells you to play more, and PINGO is not asking anybody to
 * play more.
 */

export interface JourneyProgress {
  /** Lifetime moments, monotonic. */
  momentsEarned: number;
  /** Badges ever earned, whatever the counters currently say. */
  unlockedIds: string[];
  /** First time each badge was seen as earned. */
  unlockedAt: Record<string, number>;
  /**
   * The earliest thing this account is known to have done.
   *
   * There is no join date on the profile, so this is the oldest message the
   * device has ever seen, remembered so that a later cache trim cannot make the
   * story start again. Earliest wins on merge, for the same reason moments take
   * the larger value: history only ever gets longer.
   */
  joinedAt?: number;
}

export const EMPTY_PROGRESS: JourneyProgress = { momentsEarned: 0, unlockedIds: [], unlockedAt: {} };

/** The first level costs this; each one after costs this much more again. */
const FIRST_LEVEL = 100;
const STEP = 50;

/** Cost of reaching level `n + 1` from level `n`. */
const costOf = (level: number) => FIRST_LEVEL + STEP * (level - 1);

export interface Level {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  xpTotal: number;
}

/**
 * Which level a lifetime of moments amounts to.
 *
 * Iterative rather than a closed form on purpose: the curve is a product
 * decision that will be tuned, and a quadratic solved by hand is the kind of
 * code nobody dares change afterwards.
 */
export function levelFor(momentsEarned: number): Level {
  const total = Math.max(0, Math.floor(momentsEarned));
  let level = 1;
  let remaining = total;

  while (remaining >= costOf(level)) {
    remaining -= costOf(level);
    level += 1;
  }

  return { level, xpIntoLevel: remaining, xpForLevel: costOf(level), xpTotal: total };
}

/**
 * Yesterday's progress and today's count, combined so nothing is ever lost.
 *
 * `stored` wins wherever it is larger. That is deliberate and it is not a
 * rounding convenience: a device that has seen less history must not be able to
 * take anything away from a device that saw more.
 */
export function mergeProgress(stored: JourneyProgress, computed: JourneyProgress): JourneyProgress {
  const unlockedAt: Record<string, number> = { ...stored.unlockedAt };
  for (const [id, at] of Object.entries(computed.unlockedAt)) {
    const known = unlockedAt[id];
    // The earliest date wins: a badge was earned when it was earned, and a
    // recount today is not evidence that it happened today.
    if (known === undefined || at < known) unlockedAt[id] = at;
  }

  const joined = [stored.joinedAt, computed.joinedAt].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );

  return {
    momentsEarned: Math.max(stored.momentsEarned, computed.momentsEarned),
    unlockedIds: [...new Set([...stored.unlockedIds, ...computed.unlockedIds])],
    unlockedAt,
    ...(joined.length > 0 ? { joinedAt: Math.min(...joined) } : {}),
  };
}

const KEY = 'pingo.journey.progress';

/**
 * Per account, because two accounts on one device are two people.
 *
 * Without the id in the key, adding a second account would show it the first
 * one's level — which is both wrong and a small privacy leak between the two.
 */
const keyFor = (userId: string) => `${KEY}.${userId}`;

export function loadProgress(userId: string): JourneyProgress {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return EMPTY_PROGRESS;

    const parsed = JSON.parse(raw) as Partial<JourneyProgress>;
    return {
      momentsEarned: typeof parsed.momentsEarned === 'number' && parsed.momentsEarned >= 0 ? parsed.momentsEarned : 0,
      unlockedIds: Array.isArray(parsed.unlockedIds) ? parsed.unlockedIds.filter((id) => typeof id === 'string') : [],
      unlockedAt: isRecordOfNumbers(parsed.unlockedAt) ? parsed.unlockedAt : {},
      ...(typeof parsed.joinedAt === 'number' && Number.isFinite(parsed.joinedAt)
        ? { joinedAt: parsed.joinedAt }
        : {}),
    };
  } catch {
    // A corrupt or unreadable store must not take the screen down with it. An
    // empty floor is recovered from on the next count; a thrown error is not.
    return EMPTY_PROGRESS;
  }
}

export function saveProgress(userId: string, progress: JourneyProgress): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(progress));
  } catch {
    // Storage full or blocked. Journey is not important enough to interrupt
    // anybody over, and the next count recomputes everything anyway.
  }
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}
