/**
 * Stand-in progress, so the Journey screen can be judged before it is wired.
 *
 * This exists to validate artwork, spacing, hierarchy and interaction — which
 * needs a screen that is *partly* filled, because a screen with nothing earned
 * and a screen with everything earned each hide half the design. The numbers
 * below are chosen to produce a realistic mixture: a few earned, a few nearly
 * there, several barely started, and one legendary still a long way off.
 *
 * ## It is named for what it is
 *
 * Not `defaultMetrics`, not `initialProgress`. A file called `dummy-progress`
 * cannot be mistaken for the real thing at a glance six weeks from now, and the
 * one thing that must not happen is this quietly shipping as if it were live
 * data. Phase 2 replaces the import; nothing else here needs to change, because
 * `BadgeMetrics` is the same shape either way.
 */
import type { BadgeMetrics } from './registry.js';

/** A believable account a few months in. */
export const DUMMY_METRICS: BadgeMetrics = {
  // Comfortably past — these show the unlocked state.
  conversationsStarted: 12,
  messagesSent: 1_480,
  friends: 14,
  photosSent: 63,
  storiesPosted: 31,
  callsPlaced: 22,
  aiMessages: 96,

  // Close, so the progress bars have something worth looking at.
  longMessages: 21, // of 25
  voiceNotesSent: 44, // of 50
  callMinutes: 512, // of 600
  photosSaved: 38, // of 50
  storyWeeks: 3, // of 4

  // Started, but a way to go.
  messagesAtNight: 18, // of 50
  messagesAtDawn: 6, // of 50
  weekendCalls: 7, // of 20
  editedPhotosSent: 9, // of 25
  mutualFriends: 4, // of 10
  groupsCreated: 1, // of 5
  studyMinutes: 85, // of 300
  goalsCompleted: 1, // of 5

  /*
   * Real life, mixed on purpose.
   *
   * One met, one birthday remembered, no celebrations — so the new category
   * shows an unlocked badge, a part-done bar and an untouched one at once. The
   * real counters stay at zero for everybody until the confirmation surface
   * exists; this file is only here so the category can be looked at.
   */
  meetupsConfirmed: 2, // met_offline earned, coffee_together 2 of 10
  birthdayWishes: 1, // of 3
  celebrationsShared: 0,

  // Untouched, so the empty state is on screen too.
  storyPlaces: 0,
};

/**
 * When the earned ones were earned, so the detail sheet has a real date.
 *
 * Spread over weeks rather than all set to today, because a column of identical
 * dates is the fastest way to make a screen look like a mock.
 */
export const DUMMY_UNLOCKED_AT: Record<string, number> = (() => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return {
    first_message: now - 96 * day,
    first_friend: now - 94 * day,
    first_call: now - 88 * day,
    first_story: now - 71 * day,
    camera_explorer: now - 63 * day,
    hundred_messages: now - 55 * day,
    ai_buddy: now - 22 * day,
    met_offline: now - 17 * day,
    story_creator: now - 9 * day,
  };
})();
