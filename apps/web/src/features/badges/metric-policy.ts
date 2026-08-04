/**
 * What each metric is allowed to count, decided before any of it is wired.
 *
 * Phase 2 turns the dummy numbers into real ones, and the moment that happens
 * every definition below stops being a note and starts being behaviour people
 * optimise for. So the definitions come first, in one file, with the rule the
 * user set applied to each of them one at a time:
 *
 *   **Does this represent a meaningful human interaction?**
 *   If the answer is no, it does not contribute to Journey.
 *
 * and the three things that answer are recorded as data rather than as good
 * intentions:
 *
 *   - **Never reward spam.** Every countable metric names a ceiling, so volume
 *     cannot substitute for meaning.
 *   - **Never reward repetition.** Every metric names what does *not* count —
 *     the same thing done again, the same person messaged again, the identical
 *     message sent twice.
 *   - **Never reward inactivity.** Nothing here counts a day, a streak or a
 *     login. There is no metric that goes up for being present.
 *
 * ## Why this is a file and not a paragraph in the doc
 *
 * A paragraph is read once. `verify:badges` checks that every metric in the
 * registry has an entry here, that every entry names at least one exclusion and
 * a ceiling, and that a metric marked as not contributing is used by no badge —
 * so the next person who adds a counter has to answer the question before the
 * suite goes green. That is the whole point of writing it down.
 *
 * ## The ceilings are per day and usually per person
 *
 * "Fifty messages" earned by messaging one person fifty times in an evening is
 * not the same act as fifty messages across a month of conversations, and a
 * badge that cannot tell them apart is measuring stamina. Where a per-person
 * cap makes sense it is there; where it does not, the per-day cap is.
 */
import type { UnlockCondition } from './registry.js';

export type Metric = UnlockCondition['metric'];

export interface MetricPolicy {
  /** One unit, precisely enough that two people would implement it the same way. */
  counts: string;
  /** The answer to the gate question, in the terms of the gate question. */
  meaningful: string;
  /** What must not count. Never empty — if nothing is excluded, it is a raw tally. */
  excludes: string[];
  /** The cap that stops volume from standing in for meaning. */
  ceiling: string;
  /** True when only somebody else can advance it. */
  mutual?: boolean;
  /**
   * False when the gate question was answered "no".
   *
   * Kept in the file rather than deleted, so the judgement survives: a metric
   * that was rejected once tends to be proposed again, and the reason is worth
   * more than the absence.
   */
  contributes: boolean;
}

export const METRIC_POLICY: Record<Metric, MetricPolicy> = {
  // — Messaging ————————————————————————————————————————————————
  messagesSent: {
    counts: 'A message sent in a conversation where the other person also wrote that day.',
    meaningful:
      'The reply is what makes it an exchange. Without that condition this counts talking at somebody.',
    excludes: [
      'messages in a thread nobody answered',
      'a message identical to the one before it',
      'anything sent to yourself',
    ],
    ceiling: '30 a day per conversation.',
    contributes: true,
  },
  conversationsStarted: {
    counts: 'A first message to somebody, where they answered within a week.',
    meaningful: 'Starting something that became a conversation is the interaction; sending an opener is not.',
    excludes: ['openers that were never answered', 'reopening a conversation that already exists'],
    ceiling: '3 a day.',
    contributes: true,
  },
  longMessages: {
    counts: 'A sent message over 300 characters, written in one go, in an answered thread.',
    meaningful: 'Length here is a proxy for care — it takes time, and people do it for people.',
    excludes: ['pasted text', 'forwarded messages', 'repeated characters padding the length'],
    ceiling: '5 a day.',
    contributes: true,
  },
  voiceNotesSent: {
    counts: 'A voice note over five seconds that the recipient played.',
    meaningful: 'Somebody chose to use their voice and somebody else chose to listen.',
    excludes: ['notes nobody opened', 'notes under five seconds', 'notes to yourself'],
    ceiling: '10 a day.',
    contributes: true,
  },
  messagesAtNight: {
    counts: 'A message that qualifies under `messagesSent`, sent between midnight and 4am local.',
    meaningful: 'The late conversation is a real kind of closeness, and it is somebody else being awake with you.',
    excludes: ['everything `messagesSent` excludes'],
    ceiling: '15 a night.',
    contributes: true,
  },
  messagesAtDawn: {
    counts: 'A message that qualifies under `messagesSent`, sent between 4am and 7am local.',
    meaningful: 'Same as the night one, at the other end.',
    excludes: ['everything `messagesSent` excludes'],
    ceiling: '15 a morning.',
    contributes: true,
  },

  // — Calls ————————————————————————————————————————————————————
  callsPlaced: {
    counts: 'A call that was answered and lasted over 30 seconds.',
    meaningful: 'Two people gave each other undivided time. It is the strongest signal in the app.',
    excludes: ['unanswered calls', 'calls under 30 seconds', 'redialling the same person within an hour'],
    ceiling: '5 a day.',
    contributes: true,
  },
  callMinutes: {
    counts: 'Minutes on answered calls, both sides connected.',
    meaningful: 'Time spent talking, which is the thing the badge claims to be about.',
    excludes: ['ringing time', 'time after the other side dropped', 'calls left open with nobody speaking for 10 minutes'],
    ceiling: '120 minutes a day.',
    contributes: true,
  },
  weekendCalls: {
    counts: 'A qualifying call placed on a Saturday or Sunday, local time.',
    meaningful: 'Weekend time is chosen time rather than convenient time.',
    excludes: ['everything `callsPlaced` excludes', 'more than one call to the same person that weekend'],
    ceiling: '4 a weekend.',
    contributes: true,
  },

  // — Camera ———————————————————————————————————————————————————
  photosSent: {
    counts: 'A photo sent to somebody who opened it.',
    meaningful: 'Showing somebody what you are looking at is a small act of including them.',
    excludes: ['photos nobody opened', 'the same photo sent to several people (counts once)'],
    ceiling: '15 a day.',
    contributes: true,
  },
  photosSaved: {
    counts: 'A photo received from a friend and saved.',
    meaningful: 'Keeping something somebody sent you is the clearest sign it mattered.',
    excludes: ['your own photos', 'bulk-saving a conversation'],
    ceiling: '15 a day.',
    contributes: true,
  },
  editedPhotosSent: {
    counts: 'A photo edited in PINGO and then sent to somebody who opened it.',
    meaningful: 'The edit is effort spent for a specific person to see.',
    excludes: ['edits never sent', 'a filter applied and removed', 'resending the same edit'],
    ceiling: '10 a day.',
    contributes: true,
  },

  // — Stories ——————————————————————————————————————————————————
  storiesPosted: {
    counts: 'A story posted and seen by at least one friend.',
    meaningful: 'A story with no audience is a diary entry; with one it is sharing your day.',
    excludes: ['stories nobody watched', 'more than three posts in a day', 'reposting the same media'],
    ceiling: '3 a day.',
    contributes: true,
  },
  storyPlaces: {
    counts: 'Distinct places friends were in when they watched your story, at city level.',
    meaningful:
      'It measures friendships spread across distance, not audience size. Five friends in five cities, not five thousand views.',
    excludes: [
      'view counts of any kind',
      'the same friend watching from the same city again',
      'non-friends',
      'anything finer than a city',
    ],
    ceiling: 'One per friend per city, ever.',
    contributes: true,
  },
  storyWeeks: {
    counts: 'A calendar week containing at least one story that a friend watched.',
    meaningful: 'It rewards keeping people in the loop over months, and cannot be rushed.',
    excludes: ['weeks with only unwatched stories', 'posting several times in a week (still one week)'],
    ceiling: 'One per calendar week, by definition.',
    contributes: true,
  },

  // — Friendship ———————————————————————————————————————————————
  friends: {
    counts: 'An accepted friend you have exchanged messages with on two separate days.',
    meaningful: 'An accepted request is an address book entry. Two days of talking is a friendship.',
    excludes: ['pending requests', 'accepted friends never spoken to', 'blocked or removed friends'],
    ceiling: 'No cap; the two-day condition is the cap.',
    mutual: true,
    contributes: true,
  },
  mutualFriends: {
    counts: 'A friend who has you in their close friends, and you have them.',
    meaningful: 'It is the other person’s judgement of the friendship, not yours.',
    excludes: ['one-sided close-friend lists', 'people added and removed within a week'],
    ceiling: 'No cap; the list itself is small.',
    mutual: true,
    contributes: true,
  },
  groupsCreated: {
    counts: 'A group you created where three or more people sent a message.',
    meaningful: 'Bringing people together only counts if they actually talked.',
    excludes: ['groups nobody spoke in', 'groups of two', 'recreating a group that already existed'],
    ceiling: '1 a day.',
    contributes: true,
  },

  // — AI, learning, goals ——————————————————————————————————————
  aiMessages: {
    counts: 'A message to PINGO AI inside a conversation of three or more turns.',
    meaningful:
      'Not a human interaction, and it is not counted as one: this badge sits in its own category and feeds no friendship metric. It stays because a real back-and-forth with the assistant is still something the person did, not something they were farmed for.',
    excludes: ['one-shot prompts', 'retries of the same prompt', 'anything auto-generated by the app'],
    ceiling: '20 a day.',
    contributes: true,
  },
  studyMinutes: {
    counts: 'Minutes in a study session with the screen in use.',
    meaningful: 'Solo, and honestly so — it is the user keeping a commitment to themselves.',
    excludes: ['sessions left running in the background', 'idle time over two minutes'],
    ceiling: '120 minutes a day.',
    contributes: true,
  },
  goalsCompleted: {
    counts: 'A goal the user set and later marked done, at least a day apart.',
    meaningful: 'Also solo. The day’s gap is what stops it becoming a button.',
    excludes: ['goals completed the same day they were set', 'reopening and recompleting a goal'],
    ceiling: '1 a day.',
    contributes: true,
  },

  // — Real life ————————————————————————————————————————————————
  meetupsConfirmed: {
    counts: 'A meet-up both people confirmed in the app, on the same day, in the same place.',
    meaningful: 'The strongest thing this app can measure, and the only one that happens off it.',
    excludes: [
      'one-sided confirmations',
      'the same friend more than once a day',
      'proximity inferred from location without both people saying so',
    ],
    ceiling: '1 a day per friend.',
    mutual: true,
    contributes: true,
  },
  birthdayWishes: {
    counts: 'A message to a friend on their birthday, on the day, that they read.',
    meaningful: 'Remembering somebody else’s day is entirely about them.',
    excludes: ['a birthday you set yourself for somebody', 'unread messages', 'more than one per friend per year'],
    ceiling: '1 per friend per year.',
    mutual: true,
    contributes: true,
  },
  celebrationsShared: {
    counts: 'A call or meet-up with three or more people on a day one of them marked as theirs.',
    meaningful: 'Showing up for somebody else’s good day is the definition of the thing.',
    excludes: ['your own celebrations', 'calls under two minutes', 'the same event counted twice'],
    ceiling: '1 per event.',
    mutual: true,
    contributes: true,
  },
};

/**
 * Metrics the rule has already rejected, so they are not proposed again.
 *
 * Nothing enforces this list — it is here to be read. The enforcement is that
 * none of these have an entry above, so a badge cannot reference one.
 */
export const REJECTED_METRICS: { name: string; why: string }[] = [
  {
    name: 'storyViews',
    why: 'Counts an audience, not a relationship. Replaced by storyPlaces, which counts friendships across distance.',
  },
  {
    name: 'daysActive / loginStreak',
    why: 'Rewards being present rather than doing anything, and punishes the day somebody is busy.',
  },
  {
    name: 'timeInApp',
    why: 'It is the number PINGO has decided not to maximise. A badge for it would contradict the product.',
  },
  {
    name: 'messagesReceived',
    why: 'Not something the user did. It measures how popular they are, which is a scoreboard.',
  },
  {
    name: 'reactionsGiven',
    why: 'A tap is free and infinitely repeatable — the definition of a metric that rewards spam.',
  },
];
