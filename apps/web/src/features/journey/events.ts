/**
 * What happened, before anything has decided whether it matters.
 *
 * This is the front of the pipeline:
 *
 *     Events → Meaning Evaluator → Journey Metrics → Badge Evaluator → Journey UI
 *
 * and the reason it exists is everything that is not built yet. Stories,
 * communities, meetups, the calendar and whatever comes after all have the same
 * shape — something happened, between people, at a time — and if each of them
 * grows its own counter then each of them also grows its own version of "does
 * this count", which is how a philosophy erodes without anybody deciding to
 * change it. A surface emits events. It does not decide what they are worth.
 *
 * ## The one-year test lives here
 *
 * > Every Journey event must represent a memory worth remembering. If an
 * > interaction would not matter to the user one year from now, it should
 * > probably not become Journey progress.
 *
 * Every event kind below answers that question in `EVENT_MEANING`, in writing,
 * and the answer is what the evaluator reads. A kind whose answer is "no" can
 * still be emitted — surfaces should not have to know the rules — it simply
 * earns nothing and is reported as rejected, which is far easier to notice than
 * an event that was never sent.
 *
 * ## Weight is where "quality before quantity" becomes arithmetic
 *
 * A forty-five minute call and three hundred messages are not the same day.
 * Messages are worth one each and run into a ceiling; a long conversation is
 * worth a great deal and has no equivalent. That is the whole of it, and it is
 * checked: `verify:journey-pipeline` fails if a day of messaging at the ceiling
 * ever outweighs one long call.
 */
import type { Metric } from '../badges/metric-policy.js';

export interface JourneyEventBase {
  /** Stable across re-reads of the same source. Deduplication depends on it. */
  id: string;
  at: number;
  /** The other person, when there is exactly one. Absent for groups and solo acts. */
  with?: string;
}

export type JourneyEvent =
  // — Messaging ————————————————————————————————————————————————
  | (JourneyEventBase & {
      kind: 'message.sent';
      conversationId: string;
      /** Length of the text, so the evaluator never needs the text itself. */
      characters: number;
      /** Trimmed body, hashed or plain — used only to catch the same thing said twice. */
      fingerprint?: string;
    })
  | (JourneyEventBase & { kind: 'message.received'; conversationId: string })
  /**
   * An opener that became a conversation.
   *
   * Emitted by the source rather than derived here, because whether a thread
   * was answered is a fact about the thread and the source is the only thing
   * holding it. The evaluator judges; it does not go looking.
   */
  | (JourneyEventBase & { kind: 'conversation.started'; conversationId: string })
  /** The recipient played it. Sending is not the event; being heard is. */
  | (JourneyEventBase & { kind: 'voice.played'; conversationId: string; seconds: number })

  // — Calls ————————————————————————————————————————————————————
  | (JourneyEventBase & { kind: 'call.ended'; seconds: number; answered: boolean; participants: number })

  // — Camera and stories ———————————————————————————————————————
  | (JourneyEventBase & { kind: 'photo.opened'; edited: boolean })
  | (JourneyEventBase & { kind: 'photo.saved' })
  | (JourneyEventBase & { kind: 'story.posted' })
  /** One friend, one place, watching your story. `place` is a city, never finer. */
  | (JourneyEventBase & { kind: 'story.watched'; place: string })

  // — People ———————————————————————————————————————————————————
  | (JourneyEventBase & { kind: 'friend.established' })
  | (JourneyEventBase & { kind: 'friend.close.mutual' })
  | (JourneyEventBase & { kind: 'group.created'; speakers: number })

  // — Real life, all of which need the other person ————————————
  | (JourneyEventBase & { kind: 'meetup.confirmed'; bothConfirmed: boolean })
  | (JourneyEventBase & { kind: 'birthday.wished'; read: boolean })
  | (JourneyEventBase & { kind: 'celebration.joined'; participants: number; theirDay: boolean })

  // — Solo, and honest about it ————————————————————————————————
  | (JourneyEventBase & { kind: 'ai.message'; turnsInThread: number })
  | (JourneyEventBase & { kind: 'study.session'; minutes: number; idle: boolean })
  | (JourneyEventBase & { kind: 'goal.completed'; setDaysAgo: number })

  // — Deliberately here, deliberately worth nothing ————————————
  | (JourneyEventBase & { kind: 'app.opened' })
  | (JourneyEventBase & { kind: 'reaction.given' });

export type JourneyEventKind = JourneyEvent['kind'];

export interface EventMeaning {
  /** The answer to the one-year test, in writing. */
  rememberedInAYear: string;
  /** False when the answer is no. The evaluator earns nothing for these. */
  counts: boolean;
  /** The badge counter this feeds, when it feeds one. */
  metric?: Metric;
  /**
   * What one of these is worth towards a level, before ceilings.
   *
   * Deliberately not proportional to effort or to time spent in the app. It is
   * proportional to how much somebody would care that it happened.
   */
  weight: number;
}

/**
 * The whole judgement, in one table.
 *
 * Written as data rather than as branches in the evaluator so that the question
 * "what does PINGO think a photo is worth" has one answer in one place, and so
 * that adding a surface means adding a row and being asked the question.
 */
export const EVENT_MEANING: Record<JourneyEventKind, EventMeaning> = {
  'message.sent': {
    rememberedInAYear:
      'One message, no. The conversation it was part of, yes — which is why it is worth little each and capped per day.',
    counts: true,
    metric: 'messagesSent',
    weight: 1,
  },
  'message.received': {
    rememberedInAYear: 'Not something the user did. It exists so the evaluator can tell a conversation from a monologue.',
    counts: false,
    weight: 0,
  },
  'conversation.started': {
    rememberedInAYear:
      'The first conversation with somebody who is still in your life a year later. Yes — and one nobody answered is not a conversation at all.',
    counts: true,
    metric: 'conversationsStarted',
    weight: 10,
  },
  'voice.played': {
    rememberedInAYear: 'Somebody chose to use their voice and somebody else chose to listen to it. Yes.',
    counts: true,
    metric: 'voiceNotesSent',
    weight: 5,
  },
  'call.ended': {
    rememberedInAYear: 'A long call is one of the few things people genuinely remember a year later.',
    counts: true,
    metric: 'callsPlaced',
    weight: 8,
  },
  'photo.opened': {
    rememberedInAYear: 'Showing somebody what you were looking at. Often yes, and it costs nothing to be generous here.',
    counts: true,
    metric: 'photosSent',
    weight: 2,
  },
  'photo.saved': {
    rememberedInAYear: 'Keeping something somebody sent you is the clearest evidence it mattered.',
    counts: true,
    metric: 'photosSaved',
    weight: 3,
  },
  'story.posted': {
    rememberedInAYear: 'The day, yes. The post, only because it was seen.',
    counts: true,
    metric: 'storiesPosted',
    weight: 2,
  },
  'story.watched': {
    rememberedInAYear: 'That a friend somewhere else was following your day. Yes — once per friend per place, forever.',
    counts: true,
    metric: 'storyPlaces',
    weight: 4,
  },
  'friend.established': {
    rememberedInAYear: 'Meeting somebody is the thing most likely to still matter. Yes.',
    counts: true,
    metric: 'friends',
    weight: 25,
  },
  'friend.close.mutual': {
    rememberedInAYear: 'Somebody else deciding you are close to them. Yes.',
    counts: true,
    metric: 'mutualFriends',
    weight: 30,
  },
  'group.created': {
    rememberedInAYear: 'A group that people actually talked in, yes.',
    counts: true,
    metric: 'groupsCreated',
    weight: 15,
  },
  'meetup.confirmed': {
    rememberedInAYear: 'Seeing somebody in person is the strongest thing this app can know about. Yes.',
    counts: true,
    metric: 'meetupsConfirmed',
    weight: 100,
  },
  'birthday.wished': {
    rememberedInAYear: 'By them, probably. That is the point of it.',
    counts: true,
    metric: 'birthdayWishes',
    weight: 25,
  },
  'celebration.joined': {
    rememberedInAYear: 'Showing up for somebody else’s good day. Yes.',
    counts: true,
    metric: 'celebrationsShared',
    weight: 40,
  },
  'ai.message': {
    rememberedInAYear:
      'Rarely. It counts because a real back-and-forth is still something the person did, and it is worth the least of anything that counts at all.',
    counts: true,
    metric: 'aiMessages',
    weight: 1,
  },
  'study.session': {
    rememberedInAYear: 'The habit, yes; the session, no. Counted for the habit and worth little each.',
    counts: true,
    metric: 'studyMinutes',
    weight: 1,
  },
  'goal.completed': {
    rememberedInAYear: 'Something the user set for themselves and finished. Yes.',
    counts: true,
    metric: 'goalsCompleted',
    weight: 20,
  },
  'app.opened': {
    rememberedInAYear:
      'No. Nobody has ever remembered opening an app, and counting it would be counting attendance — the one thing Journey must never do.',
    counts: false,
    weight: 0,
  },
  'reaction.given': {
    rememberedInAYear: 'No. A tap is free and infinitely repeatable, which makes it a spam metric by construction.',
    counts: false,
    weight: 0,
  },
};

/**
 * A conversation long enough to be the thing you remember about that day.
 *
 * Thirty minutes, and the bonus is large on purpose: the rule being encoded is
 * that one long conversation beats three hundred messages, and if the bonus
 * were modest then volume would still win on a busy enough day.
 */
export const LONG_CONVERSATION_MINUTES = 30;
export const LONG_CONVERSATION_BONUS = 60;
