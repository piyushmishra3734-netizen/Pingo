/**
 * Real counters, built from messages, obeying the policy exactly.
 *
 * `metric-policy.ts` decides what may be counted. This file is the half of
 * Phase 2 that does the counting, and it is deliberately a **pure function over
 * a list of messages** rather than a service: the interesting part is the rules
 * — the reply condition, the echo rule, the daily ceiling — and rules are worth
 * testing without a database in the way.
 *
 * ## What is wired, and what is honestly not
 *
 * Only the metrics a message list can actually answer:
 *
 * | Wired | Needs a signal that does not exist yet |
 * | --- | --- |
 * | messagesSent | voiceNotesSent — the policy counts notes the recipient *played*, and nothing records a play |
 * | conversationsStarted | photosSent, photosSaved — the same, for opens and saves |
 * | longMessages | callsPlaced, callMinutes, weekendCalls — call history is not local |
 * | messagesAtNight | storiesPosted, storyPlaces, storyWeeks |
 * | messagesAtDawn | friends, mutualFriends, groupsCreated |
 * | | the three Real Life metrics, which need mutual confirmation |
 *
 * The unwired ones are simply absent from the result, which reads as zero. The
 * alternative — approximating "played" with "sent" — is how a metric quietly
 * stops meaning what its policy says, and the policy is the whole point.
 *
 * ## Local time, deliberately
 *
 * Every window here (a day, the night, the dawn) is the user's local day, taken
 * from the runtime's own timezone. UTC days would put an evening conversation
 * in two different days depending on where somebody lives.
 */
import type { BadgeMetrics } from './registry.js';

/** The little that is needed from a message. Anything wider is untestable. */
export interface CountableMessage {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: number;
  /** Voice notes and photos, so a body-less message is not read as empty text. */
  attachmentKinds?: readonly string[];
}

/** From `metric-policy.ts`, restated here as numbers the counter can use. */
const CEILING_PER_CONVERSATION_PER_DAY = 30;
const LONG_MESSAGE_CHARACTERS = 300;
const LONG_MESSAGES_PER_DAY = 5;
const NIGHT_MESSAGES_PER_DAY = 15;
const DAWN_MESSAGES_PER_DAY = 15;
/** A conversation counts as started only if the other side answered inside this. */
const OPENER_ANSWERED_WITHIN = 7 * 24 * 60 * 60 * 1000;

const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * Count what the local messages can answer.
 *
 * `selfId` is required rather than optional: a counter that guesses which
 * messages are yours would silently count the other person's, and every number
 * on Journey would be somebody else's activity.
 */
export function countMessageMetrics(
  messages: readonly CountableMessage[],
  selfId: string,
): BadgeMetrics {
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  /*
   * Which (conversation, day) pairs had somebody else writing in them.
   *
   * This is the reply condition, and it is what turns "messages sent" into an
   * exchange: without it the metric counts talking at somebody, which the
   * policy rules out.
   */
  const answered = new Set<string>();
  for (const message of ordered) {
    if (message.authorId !== selfId) answered.add(`${message.conversationId}:${dayKey(message.createdAt)}`);
  }

  const sentPerConversationDay = new Map<string, number>();
  const longPerDay = new Map<string, number>();
  const nightPerDay = new Map<string, number>();
  const dawnPerDay = new Map<string, number>();
  /** The last thing said in each conversation, to catch the repeat. */
  const lastBody = new Map<string, string>();

  let messagesSent = 0;
  let longMessages = 0;
  let messagesAtNight = 0;
  let messagesAtDawn = 0;

  const bump = (map: Map<string, number>, key: string, ceiling: number): boolean => {
    const used = map.get(key) ?? 0;
    if (used >= ceiling) return false;
    map.set(key, used + 1);
    return true;
  };

  for (const message of ordered) {
    if (message.authorId !== selfId) {
      /*
       * Their turn clears the echo memory.
       *
       * Saying the same thing twice in a row is a repeat; saying it again after
       * somebody has answered is a new turn in a conversation. Without this the
       * counter would drop the second "see you tomorrow" of a friendship that
       * ends every evening the same way.
       */
      lastBody.delete(message.conversationId);
      continue;
    }

    const day = dayKey(message.createdAt);
    const conversationDay = `${message.conversationId}:${day}`;

    /*
     * The echo rule.
     *
     * "ok" then "ok" again is one thing said, however many times it was typed.
     * Compared against the last message *you* sent in that conversation rather
     * than the last message overall, so an answer that happens to repeat the
     * other person's word still counts.
     */
    const body = message.body.trim();
    const repeated = body.length > 0 && lastBody.get(message.conversationId) === body;
    lastBody.set(message.conversationId, body);
    if (repeated) continue;

    // Nobody answered here today, so nothing said here today counts.
    if (!answered.has(conversationDay)) continue;

    if (!bump(sentPerConversationDay, conversationDay, CEILING_PER_CONVERSATION_PER_DAY)) continue;
    messagesSent += 1;

    if (body.length >= LONG_MESSAGE_CHARACTERS && bump(longPerDay, day, LONG_MESSAGES_PER_DAY)) {
      longMessages += 1;
    }

    const hour = new Date(message.createdAt).getHours();
    if (hour < 4 && bump(nightPerDay, day, NIGHT_MESSAGES_PER_DAY)) messagesAtNight += 1;
    else if (hour >= 4 && hour < 7 && bump(dawnPerDay, day, DAWN_MESSAGES_PER_DAY)) messagesAtDawn += 1;
  }

  return {
    messagesSent,
    longMessages,
    messagesAtNight,
    messagesAtDawn,
    conversationsStarted: countConversationsStarted(ordered, selfId),
  };
}

/**
 * Conversations you started that became conversations.
 *
 * The first message in a thread is only an opener; it counts once the other
 * person answers, and only if they answer inside a week. An opener nobody
 * replied to is not a conversation, and counting it would reward sending them.
 */
function countConversationsStarted(ordered: readonly CountableMessage[], selfId: string): number {
  const first = new Map<string, CountableMessage>();
  for (const message of ordered) if (!first.has(message.conversationId)) first.set(message.conversationId, message);

  let started = 0;
  for (const [conversationId, opener] of first) {
    if (opener.authorId !== selfId) continue;
    const answer = ordered.find(
      (m) => m.conversationId === conversationId && m.authorId !== selfId && m.createdAt > opener.createdAt,
    );
    if (answer && answer.createdAt - opener.createdAt <= OPENER_ANSWERED_WITHIN) started += 1;
  }
  return started;
}
