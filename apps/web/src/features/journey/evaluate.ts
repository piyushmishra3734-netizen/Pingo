/**
 * The Meaning Evaluator.
 *
 * Events in, meaning out. Everything Journey believes about what counts lives
 * either here or in the two tables this reads — `EVENT_MEANING` for the
 * one-year test and the weights, `METRIC_POLICY` for the ceilings and the
 * exclusions. No surface, screen or badge is allowed its own opinion.
 *
 * ## Why rejections are returned rather than dropped
 *
 * Every event that earns nothing comes back with a reason. Silently discarding
 * them would make the two most likely bugs invisible: a source emitting events
 * that never count, and a rule that is quietly rejecting far more than anybody
 * intended. A number nobody can explain is a number nobody trusts, and Journey
 * is a screen people will ask questions about.
 *
 * ## Idempotent by construction
 *
 * The same event evaluated twice is one moment. Sources will re-read their own
 * history — a backup restore, a re-sync, a second tab — and a pipeline that
 * doubles a counter on a refresh is worse than one that does not run at all.
 */
import type { BadgeMetrics } from '../badges/registry.js';
import type { Metric } from '../badges/metric-policy.js';
import {
  EVENT_MEANING,
  LONG_CONVERSATION_BONUS,
  LONG_CONVERSATION_MINUTES,
  type JourneyEvent,
} from './events.js';

/** Why an event earned nothing. Every one of these is a philosophy rule. */
export type RejectionReason =
  /** The one-year test said no. */
  | 'not-memorable'
  /** Nobody answered in that conversation that day. */
  | 'unanswered'
  /** The same thing said again, with nothing in between. */
  | 'repeat'
  /** The day's ceiling for that metric is already used up. */
  | 'ceiling'
  /** Only one side confirmed something that needs both. */
  | 'not-mutual'
  /** A call nobody answered, a note nobody heard, a story nobody watched. */
  | 'unreceived'
  /** Too short to be an interaction: a five-second call, a two-word "session". */
  | 'too-brief'
  /** Already counted — the same friend, the same place, the same event. */
  | 'already-counted'
  /** Seen before in this same evaluation. */
  | 'duplicate';

export interface Moment {
  eventId: string;
  at: number;
  /** The counter it advances, when it advances one. */
  metric?: Metric;
  /** How much it advances that counter by. Usually one; minutes for calls. */
  count: number;
  /** What it is worth towards a level. Quality, not volume. */
  weight: number;
  with?: string;
}

export interface Rejection {
  eventId: string;
  kind: JourneyEvent['kind'];
  reason: RejectionReason;
}

export interface Evaluation {
  moments: Moment[];
  rejected: Rejection[];
  /** Ready for `libraryFor` — the Badge Evaluator is the next stage and unchanged. */
  metrics: BadgeMetrics;
  /** The level's unit. Displayed as "moments"; never as XP. */
  momentsEarned: number;
}

const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Ceilings, taken from the policy and restated as numbers. */
const CEILINGS = {
  messagesPerConversationPerDay: 30,
  longMessagesPerDay: 5,
  nightPerDay: 15,
  dawnPerDay: 15,
  voiceNotesPerDay: 10,
  callsPerDay: 5,
  callMinutesPerDay: 120,
  weekendCallsPerWeekend: 4,
  photosPerDay: 15,
  photosSavedPerDay: 15,
  storiesPerDay: 3,
  groupsPerDay: 1,
  aiPerDay: 20,
  studyMinutesPerDay: 120,
  goalsPerDay: 1,
  meetupsPerFriendPerDay: 1,
} as const;

const LONG_MESSAGE_CHARACTERS = 300;
const CALL_MINIMUM_SECONDS = 30;
const VOICE_MINIMUM_SECONDS = 5;
const CELEBRATION_MINIMUM_PEOPLE = 3;

/**
 * Turn what happened into what it was worth.
 *
 * `selfId` is not needed: an event is already something *this* user did or had
 * done to them by the time it reaches here. Sources are responsible for not
 * emitting somebody else's activity, which is a much easier thing to get right
 * at the source than to unpick downstream.
 */
export function evaluateJourney(events: readonly JourneyEvent[]): Evaluation {
  const ordered = [...events].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const moments: Moment[] = [];
  const rejected: Rejection[] = [];
  const metrics: Record<string, number> = {};
  let momentsEarned = 0;

  const seen = new Set<string>();
  /** (conversation, day) pairs in which somebody else wrote. */
  const answered = new Set<string>();
  for (const event of ordered) {
    if (event.kind === 'message.received') answered.add(`${event.conversationId}:${dayKey(event.at)}`);
  }

  /** Per-window counters, so a ceiling is one lookup rather than a scan. */
  const used = new Map<string, number>();
  const withinCeiling = (key: string, ceiling: number, by = 1) => {
    const already = used.get(key) ?? 0;
    if (already >= ceiling) return false;
    used.set(key, already + by);
    return true;
  };

  /** Things that may only ever count once: a place, a friend, a birthday year. */
  const forever = new Set<string>();

  /** The last thing said in each conversation, cleared when they answer. */
  const lastSaid = new Map<string, string>();

  const reject = (event: JourneyEvent, reason: RejectionReason) => {
    rejected.push({ eventId: event.id, kind: event.kind, reason });
  };

  const earn = (event: JourneyEvent, metric: Metric | undefined, count: number, weight: number) => {
    moments.push({ eventId: event.id, at: event.at, metric, count, weight, with: event.with });
    if (metric) metrics[metric] = (metrics[metric] ?? 0) + count;
    momentsEarned += weight;
  };

  for (const event of ordered) {
    if (seen.has(event.id)) {
      reject(event, 'duplicate');
      continue;
    }
    seen.add(event.id);

    const meaning = EVENT_MEANING[event.kind];
    const day = dayKey(event.at);

    if (!meaning.counts) {
      /*
       * `message.received` is context rather than achievement — it earns
       * nothing and is not a rejection either. It does one thing on its way
       * past: their turn clears the echo memory, so somebody answering "ok"
       * again after a reply is saying a second thing rather than repeating a
       * first one.
       */
      if (event.kind === 'message.received') lastSaid.delete(event.conversationId);
      else reject(event, 'not-memorable');
      continue;
    }

    switch (event.kind) {
      case 'message.sent': {
        const conversationDay = `${event.conversationId}:${day}`;

        /*
         * The echo rule, and it is about repeating *yourself*: their reply
         * clears the memory, so a friendship that ends every evening the same
         * way is not penalised for it.
         */
        const fingerprint = event.fingerprint?.trim() ?? '';
        const repeat = fingerprint.length > 0 && lastSaid.get(event.conversationId) === fingerprint;
        lastSaid.set(event.conversationId, fingerprint);
        if (repeat) {
          reject(event, 'repeat');
          continue;
        }

        if (!answered.has(conversationDay)) {
          reject(event, 'unanswered');
          continue;
        }

        if (!withinCeiling(`sent:${conversationDay}`, CEILINGS.messagesPerConversationPerDay)) {
          reject(event, 'ceiling');
          continue;
        }

        earn(event, 'messagesSent', 1, meaning.weight);

        if (
          event.characters >= LONG_MESSAGE_CHARACTERS &&
          withinCeiling(`long:${day}`, CEILINGS.longMessagesPerDay)
        ) {
          // Three, not one: the long ones take time, and time given to one
          // person is the thing being recognised.
          earn(event, 'longMessages', 1, 3);
        }

        const hour = new Date(event.at).getHours();
        if (hour < 4 && withinCeiling(`night:${day}`, CEILINGS.nightPerDay)) {
          earn(event, 'messagesAtNight', 1, 0);
        } else if (hour >= 4 && hour < 7 && withinCeiling(`dawn:${day}`, CEILINGS.dawnPerDay)) {
          earn(event, 'messagesAtDawn', 1, 0);
        }
        break;
      }

      case 'conversation.started': {
        // Once per conversation, ever. Reopening an old thread is not starting
        // something.
        const key = `started:${event.conversationId}`;
        if (forever.has(key)) {
          reject(event, 'already-counted');
          continue;
        }
        forever.add(key);
        earn(event, 'conversationsStarted', 1, meaning.weight);
        break;
      }

      case 'voice.played': {
        if (event.seconds < VOICE_MINIMUM_SECONDS) {
          reject(event, 'too-brief');
          continue;
        }
        if (!withinCeiling(`voice:${day}`, CEILINGS.voiceNotesPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'voiceNotesSent', 1, meaning.weight);
        break;
      }

      case 'call.ended': {
        if (!event.answered || event.seconds < CALL_MINIMUM_SECONDS) {
          reject(event, event.answered ? 'too-brief' : 'unreceived');
          continue;
        }
        if (!withinCeiling(`call:${day}`, CEILINGS.callsPerDay)) {
          reject(event, 'ceiling');
          continue;
        }

        const minutes = Math.floor(event.seconds / 60);
        earn(event, 'callsPlaced', 1, meaning.weight);

        const room = Math.max(0, CEILINGS.callMinutesPerDay - (used.get(`callmin:${day}`) ?? 0));
        const counted = Math.min(minutes, room);
        if (counted > 0) {
          used.set(`callmin:${day}`, (used.get(`callmin:${day}`) ?? 0) + counted);
          /*
           * A minute of talking is worth a message, and then a long
           * conversation is worth a great deal more than the sum of its
           * minutes — because that is the difference the philosophy is about.
           */
          const bonus = minutes >= LONG_CONVERSATION_MINUTES ? LONG_CONVERSATION_BONUS : 0;
          earn(event, 'callMinutes', counted, counted + bonus);
        }

        const weekday = new Date(event.at).getDay();
        if ((weekday === 0 || weekday === 6) && withinCeiling(`weekend:${weekendKey(event.at)}`, CEILINGS.weekendCallsPerWeekend)) {
          earn(event, 'weekendCalls', 1, 0);
        }
        break;
      }

      case 'photo.opened': {
        if (!withinCeiling(`photo:${day}`, CEILINGS.photosPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'photosSent', 1, meaning.weight);
        if (event.edited) earn(event, 'editedPhotosSent', 1, 1);
        break;
      }

      case 'photo.saved': {
        if (!withinCeiling(`saved:${day}`, CEILINGS.photosSavedPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'photosSaved', 1, meaning.weight);
        break;
      }

      case 'story.posted': {
        if (!withinCeiling(`story:${day}`, CEILINGS.storiesPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'storiesPosted', 1, meaning.weight);
        break;
      }

      case 'story.watched': {
        /*
         * One per friend per place, forever. Not a view count — the same friend
         * watching from the same city every day is one fact about a friendship,
         * and repeating it is exactly what the replaced badge got wrong.
         */
        const key = `place:${event.with ?? '?'}:${event.place.toLowerCase()}`;
        if (forever.has(key)) {
          reject(event, 'already-counted');
          continue;
        }
        forever.add(key);
        earn(event, 'storyPlaces', 1, meaning.weight);
        break;
      }

      case 'friend.established': {
        const key = `friend:${event.with ?? event.id}`;
        if (forever.has(key)) {
          reject(event, 'already-counted');
          continue;
        }
        forever.add(key);
        earn(event, 'friends', 1, meaning.weight);
        break;
      }

      case 'friend.close.mutual': {
        const key = `close:${event.with ?? event.id}`;
        if (forever.has(key)) {
          reject(event, 'already-counted');
          continue;
        }
        forever.add(key);
        earn(event, 'mutualFriends', 1, meaning.weight);
        break;
      }

      case 'group.created': {
        if (event.speakers < CELEBRATION_MINIMUM_PEOPLE) {
          // A group nobody talked in is a list of names.
          reject(event, 'unreceived');
          continue;
        }
        if (!withinCeiling(`group:${day}`, CEILINGS.groupsPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'groupsCreated', 1, meaning.weight);
        break;
      }

      case 'meetup.confirmed': {
        if (!event.bothConfirmed) {
          reject(event, 'not-mutual');
          continue;
        }
        if (!withinCeiling(`meet:${event.with ?? '?'}:${day}`, CEILINGS.meetupsPerFriendPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'meetupsConfirmed', 1, meaning.weight);
        break;
      }

      case 'birthday.wished': {
        if (!event.read) {
          reject(event, 'unreceived');
          continue;
        }
        const key = `bday:${event.with ?? '?'}:${new Date(event.at).getFullYear()}`;
        if (forever.has(key)) {
          reject(event, 'already-counted');
          continue;
        }
        forever.add(key);
        earn(event, 'birthdayWishes', 1, meaning.weight);
        break;
      }

      case 'celebration.joined': {
        if (!event.theirDay) {
          // Your own party is not showing up for somebody.
          reject(event, 'not-memorable');
          continue;
        }
        if (event.participants < CELEBRATION_MINIMUM_PEOPLE) {
          reject(event, 'too-brief');
          continue;
        }
        earn(event, 'celebrationsShared', 1, meaning.weight);
        break;
      }

      case 'ai.message': {
        if (event.turnsInThread < 3) {
          reject(event, 'too-brief');
          continue;
        }
        if (!withinCeiling(`ai:${day}`, CEILINGS.aiPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'aiMessages', 1, meaning.weight);
        break;
      }

      case 'study.session': {
        if (event.idle) {
          reject(event, 'not-memorable');
          continue;
        }
        const room = Math.max(0, CEILINGS.studyMinutesPerDay - (used.get(`study:${day}`) ?? 0));
        const counted = Math.min(event.minutes, room);
        if (counted <= 0) {
          reject(event, 'ceiling');
          continue;
        }
        used.set(`study:${day}`, (used.get(`study:${day}`) ?? 0) + counted);
        earn(event, 'studyMinutes', counted, meaning.weight);
        break;
      }

      case 'goal.completed': {
        if (event.setDaysAgo < 1) {
          // Set and finished the same day is a button, not a goal.
          reject(event, 'too-brief');
          continue;
        }
        if (!withinCeiling(`goal:${day}`, CEILINGS.goalsPerDay)) {
          reject(event, 'ceiling');
          continue;
        }
        earn(event, 'goalsCompleted', 1, meaning.weight);
        break;
      }

      default:
        break;
    }
  }

  return { moments, rejected, metrics: metrics as BadgeMetrics, momentsEarned };
}

/** Saturday and the Sunday after it are one weekend, so a pair of calls is not four. */
function weekendKey(at: number): string {
  const d = new Date(at);
  const saturday = new Date(d);
  if (d.getDay() === 0) saturday.setDate(d.getDate() - 1);
  return dayKey(saturday.getTime());
}
