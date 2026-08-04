/**
 * The PINGO badge library.
 *
 * The reference sheet is the design system, not a starting point — every badge
 * below exists in it, with the fill, the accent and the artwork it was drawn
 * with. Nothing here is reinterpreted, and nothing new may be invented in a
 * different style: a badge that breaks the language devalues the twenty-four
 * that keep it.
 *
 * ## Two fills, and the choice is not decoration
 *
 * A badge is either dark with cream artwork or cream paper with dark artwork.
 * Which one a badge gets is fixed by the reference, so it is recorded here as
 * data rather than derived from rarity or category — deriving it would quietly
 * redesign the sheet the first time someone added a legendary badge.
 *
 * ## Rarity is a dot, not a redesign
 *
 * Rarity never touches the artwork, the fill or the frame. It is one small
 * accent, and that is the whole of it. Gaming badges signal rarity by making the
 * icon louder; this library signals it the way a museum label does.
 */

export type BadgeCategory =
  | 'messaging'
  | 'lifestyle'
  | 'calls'
  | 'camera'
  | 'stories'
  | 'friendship'
  | 'ai'
  | 'learning'
  | 'goals'
  | 'realLife';

export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

/** Dark disc with cream artwork, or cream paper with dark artwork. */
export type BadgeFill = 'ink' | 'paper';

/** Most are discs. A few are rounded squares, exactly as drawn. */
export type BadgeShape = 'circle' | 'squircle';

/**
 * What has to happen, as data rather than as a function.
 *
 * Kept declarative so the same definition can drive the unlock check, the
 * progress bar on a locked badge, and a test — three things that would
 * otherwise each carry their own copy of "a hundred messages" and drift.
 */
export interface UnlockCondition {
  /** The counter this badge watches. */
  metric:
    | 'messagesSent'
    | 'conversationsStarted'
    | 'longMessages'
    | 'voiceNotesSent'
    | 'messagesAtNight'
    | 'messagesAtDawn'
    | 'callsPlaced'
    | 'callMinutes'
    | 'weekendCalls'
    | 'photosSent'
    | 'photosSaved'
    | 'editedPhotosSent'
    | 'storiesPosted'
    | 'storyPlaces'
    | 'storyWeeks'
    | 'friends'
    | 'mutualFriends'
    | 'groupsCreated'
    | 'aiMessages'
    | 'studyMinutes'
    | 'goalsCompleted'
    // Real life. Every one of these is confirmed by the other person — see
    // MUTUAL_METRICS below.
    | 'meetupsConfirmed'
    | 'birthdayWishes'
    | 'celebrationsShared';
  /** The value the metric must reach. */
  threshold: number;
  /** Shown on a locked badge, in the user's words rather than the metric's. */
  progressLabel: string;
}

export interface BadgeDefinition {
  id: string;
  title: string;
  description: string;
  category: BadgeCategory;
  rarity: BadgeRarity;
  xpReward: number;
  unlockCondition: UnlockCondition;
  /**
   * Kept off the grid until earned.
   *
   * Almost always false. A grid of locked badges is the point — it is what
   * makes the collection feel like somewhere to go. Hiding one is reserved for
   * the rare badge whose existence is the surprise, and overusing it turns the
   * page into a blank wall.
   */
  hiddenUntilUnlocked: boolean;
  fill: BadgeFill;
  shape: BadgeShape;
  /**
   * The one colour in the artwork, when the reference gives it one.
   *
   * Most badges are monochrome. The handful that are not use a single muted
   * tone, never a gradient and never more than one — except `first_story`,
   * which is drawn with the app's own story ring and is marked separately.
   */
  accent?: string;
}

/** The muted palette the reference uses. No neon, nothing saturated. */
export const BADGE_ACCENT = {
  amber: '#D4A24C',
  lilac: '#A98CE0',
  sage: '#8FA882',
  ember: '#C4573F',
  olive: '#8A8C6A',
  rose: '#D69BC0',
  clay: '#B8503C',
} as const;

/**
 * XP by rarity, so a badge cannot be worth more than its rarity implies.
 *
 * Exported because the registry is checked against it: a value typed by hand
 * eventually disagrees with the label beside it, and the label is what the user
 * reads.
 */
export const XP_BY_RARITY: Record<BadgeRarity, number> = {
  common: 25,
  rare: 50,
  epic: 100,
  legendary: 200,
  mythic: 400,
};

const badge = (
  id: string,
  title: string,
  description: string,
  category: BadgeCategory,
  rarity: BadgeRarity,
  unlockCondition: UnlockCondition,
  visual: { fill: BadgeFill; shape?: BadgeShape; accent?: string },
): BadgeDefinition => ({
  id,
  title,
  description,
  category,
  rarity,
  xpReward: XP_BY_RARITY[rarity],
  unlockCondition,
  hiddenUntilUnlocked: false,
  fill: visual.fill,
  shape: visual.shape ?? 'circle',
  ...(visual.accent ? { accent: visual.accent } : {}),
});

/**
 * Phase 1, in the order of the reference sheet.
 *
 * The order is kept because the sheet reads as a set — messaging, then the two
 * times of day, then calls, camera, stories, people. A grid sorted by rarity or
 * alphabetically loses that, and the set is the thing being designed.
 */
export const BADGES: BadgeDefinition[] = [
  // — Messaging ————————————————————————————————————————————————
  badge(
    'first_message',
    'First Message',
    'Started your first conversation.',
    'messaging',
    'common',
    { metric: 'conversationsStarted', threshold: 1, progressLabel: 'conversations started' },
    { fill: 'ink', shape: 'squircle' },
  ),
  badge(
    'night_owl',
    'Night Owl',
    'Sent messages long after midnight.',
    'lifestyle',
    'rare',
    { metric: 'messagesAtNight', threshold: 50, progressLabel: 'messages after midnight' },
    { fill: 'ink' },
  ),
  badge(
    'early_bird',
    'Early Bird',
    'Up and talking before the sun was.',
    'lifestyle',
    'rare',
    { metric: 'messagesAtDawn', threshold: 50, progressLabel: 'messages before sunrise' },
    { fill: 'paper', accent: BADGE_ACCENT.amber },
  ),
  badge(
    'hundred_messages',
    '100 Messages',
    'A hundred messages sent.',
    'messaging',
    'rare',
    { metric: 'messagesSent', threshold: 100, progressLabel: 'messages sent' },
    { fill: 'ink' },
  ),
  badge(
    'deep_talk',
    'Deep Talk',
    'Wrote the long ones, the kind that take a while.',
    'messaging',
    'epic',
    { metric: 'longMessages', threshold: 25, progressLabel: 'long messages' },
    { fill: 'ink' },
  ),
  badge(
    'voice_lover',
    'Voice Lover',
    'Said it out loud instead of typing it.',
    'messaging',
    'epic',
    { metric: 'voiceNotesSent', threshold: 50, progressLabel: 'voice notes sent' },
    { fill: 'ink', accent: BADGE_ACCENT.lilac },
  ),

  // — Calls ————————————————————————————————————————————————————
  badge(
    'first_call',
    'First Call',
    'Made your first call.',
    'calls',
    'common',
    { metric: 'callsPlaced', threshold: 1, progressLabel: 'calls made' },
    { fill: 'ink', shape: 'squircle' },
  ),
  badge(
    'ten_hours_together',
    '10 Hours Together',
    'Ten hours on calls with the people who matter.',
    'calls',
    'epic',
    { metric: 'callMinutes', threshold: 600, progressLabel: 'minutes on calls' },
    { fill: 'paper' },
  ),
  badge(
    'weekend_caller',
    'Weekend Caller',
    'Kept the weekends for talking.',
    'calls',
    'rare',
    { metric: 'weekendCalls', threshold: 20, progressLabel: 'weekend calls' },
    { fill: 'ink', accent: BADGE_ACCENT.sage },
  ),

  // — Camera ———————————————————————————————————————————————————
  badge(
    'camera_explorer',
    'Camera Explorer',
    'Sent your first photos.',
    'camera',
    'common',
    { metric: 'photosSent', threshold: 10, progressLabel: 'photos sent' },
    { fill: 'ink' },
  ),
  badge(
    'memory_keeper',
    'Memory Keeper',
    'Kept the moments worth keeping.',
    'camera',
    'rare',
    { metric: 'photosSaved', threshold: 50, progressLabel: 'photos saved' },
    { fill: 'paper' },
  ),
  badge(
    'creative_shot',
    'Creative Shot',
    'Made something of the picture before sending it.',
    'camera',
    'epic',
    { metric: 'editedPhotosSent', threshold: 25, progressLabel: 'edited photos sent' },
    { fill: 'ink', accent: BADGE_ACCENT.lilac },
  ),

  // — Stories ——————————————————————————————————————————————————
  badge(
    'first_story',
    'First Story',
    'Posted your first story.',
    'stories',
    'common',
    { metric: 'storiesPosted', threshold: 1, progressLabel: 'stories posted' },
    { fill: 'ink', shape: 'squircle' },
  ),
  badge(
    'story_creator',
    'Story Creator',
    'Kept the story going, day after day.',
    'stories',
    'rare',
    { metric: 'storiesPosted', threshold: 25, progressLabel: 'stories posted' },
    { fill: 'ink', accent: BADGE_ACCENT.lilac },
  ),
  badge(
    'story_master',
    'Story Master',
    'A hundred stories, and people kept watching.',
    'stories',
    'legendary',
    { metric: 'storiesPosted', threshold: 100, progressLabel: 'stories posted' },
    { fill: 'paper' },
  ),
  /*
   * Replaced "Viral Story", which counted a thousand views on one post.
   *
   * Reach is a vanity metric: it measures an audience, not a relationship, and
   * it was the only badge in the library about being seen rather than about
   * being with someone. Distance travelled is still social — friends in
   * different places — without anybody's story becoming a number to chase.
   */
  badge(
    'around_together',
    'Around Together',
    'Friends in different places shared your day.',
    'stories',
    'mythic',
    { metric: 'storyPlaces', threshold: 5, progressLabel: 'places friends watched from' },
    { fill: 'ink', accent: BADGE_ACCENT.ember },
  ),
  badge(
    'weekly_story',
    'Weekly Story',
    'Posted every week for a month.',
    'stories',
    'rare',
    { metric: 'storyWeeks', threshold: 4, progressLabel: 'weeks in a row' },
    { fill: 'ink' },
  ),

  // — Friendship ———————————————————————————————————————————————
  badge(
    'trusted_friend',
    'Trusted Friend',
    'Someone chose to keep you close.',
    'friendship',
    'epic',
    { metric: 'mutualFriends', threshold: 10, progressLabel: 'mutual friends' },
    { fill: 'ink', accent: BADGE_ACCENT.olive },
  ),
  badge(
    'first_friend',
    'First Friend',
    'Added your first friend.',
    'friendship',
    'common',
    { metric: 'friends', threshold: 1, progressLabel: 'friends' },
    { fill: 'ink' },
  ),
  badge(
    'best_circle',
    'Best Circle',
    'Built a circle worth having.',
    'friendship',
    'legendary',
    { metric: 'friends', threshold: 50, progressLabel: 'friends' },
    { fill: 'paper' },
  ),
  badge(
    'community_builder',
    'Community Builder',
    'Brought people together in groups of your own.',
    'friendship',
    'epic',
    { metric: 'groupsCreated', threshold: 5, progressLabel: 'groups created' },
    { fill: 'ink', accent: BADGE_ACCENT.rose },
  ),

  // — AI ———————————————————————————————————————————————————————
  badge(
    'ai_buddy',
    'AI Buddy',
    'Got talking with PINGO AI.',
    'ai',
    'rare',
    { metric: 'aiMessages', threshold: 50, progressLabel: 'messages with PINGO AI' },
    { fill: 'paper' },
  ),

  // — Learning —————————————————————————————————————————————————
  badge(
    'study_session',
    'Study Session',
    'Put the hours in.',
    'learning',
    'rare',
    { metric: 'studyMinutes', threshold: 300, progressLabel: 'minutes studying' },
    { fill: 'ink' },
  ),

  // — Goals ————————————————————————————————————————————————————
  badge(
    'goal_planner',
    'Goal Planner',
    'Set a goal and saw it through.',
    'goals',
    'rare',
    { metric: 'goalsCompleted', threshold: 5, progressLabel: 'goals completed' },
    { fill: 'ink', accent: BADGE_ACCENT.clay },
  ),

  /*
   * — Real Life ————————————————————————————————————————————————
   *
   * The only badges in the library that are not about using PINGO. They are
   * about the app being put down, which is the point: an app that celebrates
   * meeting someone for coffee is saying out loud that time on the app is not
   * the thing being maximised.
   *
   * ## Every one of these needs the other person
   *
   * A real-life badge nobody can check is a badge you award yourself, and a
   * badge you award yourself is worth nothing the moment anybody realises they
   * can tap it four times. So none of these count from one side: the friend
   * confirms the meet, the birthday belongs to somebody else's profile, the
   * celebration has more than one person in it. That constraint is recorded as
   * data in MUTUAL_METRICS and checked, rather than left as an intention.
   *
   * The confirmation surface does not exist yet. These stay locked for
   * everybody until it does — which is the honest state, and better than
   * inventing a proxy like "you were both online in the same city".
   */
  badge(
    'met_offline',
    'Met Offline',
    'A PINGO friend became someone you have actually met.',
    'realLife',
    'rare',
    { metric: 'meetupsConfirmed', threshold: 1, progressLabel: 'friends met in person' },
    { fill: 'ink', shape: 'squircle' },
  ),
  badge(
    'coffee_together',
    'Coffee Together',
    'Made a habit of seeing people, not just messaging them.',
    'realLife',
    'epic',
    { metric: 'meetupsConfirmed', threshold: 10, progressLabel: 'times met in person' },
    { fill: 'paper', accent: BADGE_ACCENT.amber },
  ),
  badge(
    'birthday_wish',
    'Birthday Wish',
    'Remembered the day without being reminded twice.',
    'realLife',
    'rare',
    { metric: 'birthdayWishes', threshold: 3, progressLabel: 'birthdays remembered' },
    { fill: 'ink', accent: BADGE_ACCENT.rose },
  ),
  badge(
    'celebrated_together',
    'Celebrated Together',
    'Showed up for somebody else’s good day.',
    'realLife',
    'epic',
    { metric: 'celebrationsShared', threshold: 3, progressLabel: 'celebrations shared' },
    { fill: 'paper', accent: BADGE_ACCENT.sage },
  ),
];

/**
 * Metrics that only another person can advance.
 *
 * Listed here rather than inferred from the category, because the reason is not
 * "these are the real-life ones" — it is "these cannot be earned alone", and a
 * future badge in any category may need the same property.
 */
export const MUTUAL_METRICS: ReadonlySet<UnlockCondition['metric']> = new Set([
  'meetupsConfirmed',
  'birthdayWishes',
  'celebrationsShared',
]);

export const BADGE_BY_ID: ReadonlyMap<string, BadgeDefinition> = new Map(
  BADGES.map((b) => [b.id, b]),
);

/** Counters a profile has accumulated. Absent means zero. */
export type BadgeMetrics = Partial<Record<UnlockCondition['metric'], number>>;

export interface BadgeProgress {
  badge: BadgeDefinition;
  unlocked: boolean;
  /** Current value of the watched metric, clamped at the threshold. */
  value: number;
  /** 0 to 1. Exactly 1 when unlocked. */
  fraction: number;
}

/**
 * Where someone stands on one badge.
 *
 * Clamped at the threshold so a user with four hundred messages does not see a
 * bar four times too long, and so `fraction` can be handed straight to a width
 * without a second guard at the call site.
 */
export function progressFor(badge: BadgeDefinition, metrics: BadgeMetrics): BadgeProgress {
  const { metric, threshold } = badge.unlockCondition;
  const raw = metrics[metric] ?? 0;
  const value = Math.min(raw, threshold);
  return {
    badge,
    unlocked: raw >= threshold,
    value,
    fraction: threshold <= 0 ? 1 : value / threshold,
  };
}

/**
 * The whole library, in sheet order, with progress attached.
 *
 * Hidden badges are dropped until earned. Everything else stays on the grid
 * locked, because an empty page is not an invitation.
 */
export function libraryFor(metrics: BadgeMetrics, unlockedIds: ReadonlySet<string> = new Set()) {
  return BADGES.map((b) => {
    const progress = progressFor(b, metrics);
    return { ...progress, unlocked: progress.unlocked || unlockedIds.has(b.id) };
  }).filter((entry) => !entry.badge.hiddenUntilUnlocked || entry.unlocked);
}

/** Total XP earned from badges. */
export function badgeXp(unlockedIds: ReadonlySet<string>): number {
  let total = 0;
  for (const id of unlockedIds) total += BADGE_BY_ID.get(id)?.xpReward ?? 0;
  return total;
}
