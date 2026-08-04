/**
 * Stand-in data for the Journey screen.
 *
 * Named for what it is, like `dummy-progress` beside it, so it cannot be
 * mistaken for the real thing six weeks from now. Phase 2 replaces these
 * exports; the components take the same shapes either way.
 *
 * ## The numbers are chosen to make the screen honest
 *
 * A level part-way through, one mission done, one part-done and one untouched,
 * a Pulse that is neither empty nor perfect. A screen where everything is
 * complete hides how progress reads, and a screen where nothing is hides how
 * completion reads — and both are the states this phase exists to judge.
 */

export interface JourneyLevel {
  level: number;
  /** XP earned inside the current level, not lifetime. */
  xpIntoLevel: number;
  /** XP the current level needs in total. */
  xpForLevel: number;
  /** Lifetime, for the small print. */
  xpTotal: number;
}

export const DUMMY_LEVEL: JourneyLevel = {
  level: 6,
  xpIntoLevel: 275,
  xpForLevel: 450,
  xpTotal: 2_525,
};

/**
 * One line under the level, and it is about the person rather than the number.
 *
 * "You are 175 XP from level 7" is a progress bar written out in words, and the
 * bar is already there. This is the only place on the screen that gets to say
 * something rather than count something.
 */
export const DUMMY_ENCOURAGEMENT = 'Three months of conversations, and still going.';

export interface Mission {
  id: string;
  title: string;
  /** What one unit is, for the counter. */
  unit: string;
  done: number;
  target: number;
  xpReward: number;
}

export const DUMMY_MISSIONS: Mission[] = [
  { id: 'daily_messages', title: 'Send 5 messages', unit: 'messages', done: 2, target: 5, xpReward: 10 },
  { id: 'daily_call', title: 'Call one friend', unit: 'calls', done: 0, target: 1, xpReward: 15 },
  { id: 'daily_story', title: 'Share a story', unit: 'stories', done: 1, target: 1, xpReward: 10 },
];

/**
 * Pulse: how the friendships are doing, not how many there are.
 *
 * A count of friends belongs in Statistics. Pulse is about warmth — who you
 * have been talking to lately — which is why it is people and a state rather
 * than people and a number.
 */
export interface PulseEntry {
  id: string;
  name: string;
  /** Days since the last exchange. */
  quietDays: number;
  /** Messages both ways over the last fortnight, for the little bar. */
  exchanges: number;
}

export const DUMMY_PULSE: PulseEntry[] = [
  { id: 'p1', name: 'Baani', quietDays: 0, exchanges: 128 },
  { id: 'p2', name: 'Kashish', quietDays: 1, exchanges: 74 },
  { id: 'p3', name: 'Sneha', quietDays: 4, exchanges: 31 },
  { id: 'p4', name: 'Hadiya', quietDays: 12, exchanges: 8 },
];

/** The eight surfaces Phase 2 will count. Cards only, no numbers. */
export const STATISTIC_PLACEHOLDERS = [
  { id: 'messages', label: 'Messages' },
  { id: 'calls', label: 'Calls' },
  { id: 'stories', label: 'Stories' },
  { id: 'friends', label: 'Friends' },
  { id: 'communities', label: 'Communities' },
  { id: 'ai', label: 'AI' },
  { id: 'profile', label: 'Profile' },
  { id: 'camera', label: 'Camera' },
] as const;
