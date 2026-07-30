/**
 * When to ask again about backup, and when to stop asking.
 *
 * Pure decisions, no storage and no React, so the escalation can be tested
 * without a browser. The behaviour worth getting right is not the first
 * reminder — it is the third.
 *
 * ## Escalating, because a repeated no is an answer
 *
 * Someone who has dismissed this twice has told us something. A reminder that
 * ignores that stops being a reminder and becomes an advert, and an app that
 * nags about its own safety feature teaches people to dismiss safety features.
 * So the gap widens each time, and "Never" is honoured permanently rather than
 * being quietly reset by the next release.
 */
export type ReminderInterval = '24h' | '7d' | '1m' | 'never';

export const REMINDER_MS: Record<Exclude<ReminderInterval, 'never'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
};

export interface ReminderState {
  /** How long to wait before asking again. */
  interval: ReminderInterval;
  /** When the card or prompt was last put in front of the user. */
  lastShownAt?: number;
  /** How many times they have actively dismissed it. */
  dismissals: number;
  /** Set once the first prompt has been shown, so it is never shown twice. */
  promptSeen: boolean;
}

export const INITIAL_REMINDERS: ReminderState = {
  interval: '24h',
  dismissals: 0,
  promptSeen: false,
};

/**
 * The interval a given number of dismissals earns.
 *
 * Deliberately not configurable by the caller: the escalation is the policy,
 * and a caller that could pick "24h" forever would defeat it.
 */
export function intervalAfter(dismissals: number): ReminderInterval {
  if (dismissals <= 0) return '24h';
  if (dismissals === 1) return '7d';
  if (dismissals === 2) return '1m';
  return 'never';
}

/**
 * Should the reminder card be on screen?
 *
 * `backupEnabled` short-circuits everything. A user who has turned backup on
 * must never see a reminder about turning it on, whatever the timers say —
 * that is the bug this argument exists to make impossible.
 */
export function shouldShowReminder(
  state: ReminderState,
  backupEnabled: boolean,
  now = Date.now(),
): boolean {
  if (backupEnabled) return false;
  if (state.interval === 'never') return false;
  if (state.lastShownAt === undefined) return true;
  return now - state.lastShownAt >= REMINDER_MS[state.interval];
}

/** Records that it was shown, without changing the schedule. */
export function afterShown(state: ReminderState, now = Date.now()): ReminderState {
  return { ...state, lastShownAt: now, promptSeen: true };
}

/**
 * Records a dismissal and widens the gap.
 *
 * The third dismissal lands on `never`, so someone who keeps saying no stops
 * being asked without ever having to find the setting.
 */
export function afterDismissed(state: ReminderState, now = Date.now()): ReminderState {
  const dismissals = state.dismissals + 1;
  return { ...state, dismissals, interval: intervalAfter(dismissals), lastShownAt: now };
}

/** An explicit choice from Settings. Overrides the escalation in both directions. */
export function withInterval(state: ReminderState, interval: ReminderInterval): ReminderState {
  return { ...state, interval };
}

/** Backup was turned on: nothing more to ask about. */
export function afterEnabled(state: ReminderState): ReminderState {
  return { ...state, interval: 'never', promptSeen: true };
}

/** Human wording for the Settings row. */
export function describeInterval(interval: ReminderInterval): string {
  switch (interval) {
    case '24h':
      return 'Every day';
    case '7d':
      return 'Every week';
    case '1m':
      return 'Every month';
    case 'never':
      return 'Never';
  }
}
