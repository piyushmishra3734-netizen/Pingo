/**
 * Messages, turned into events.
 *
 * This used to be a counter with the rules inside it. It is now a **source**:
 * it knows about messages and about threads, and it knows nothing at all about
 * what any of that is worth. Everything it produces goes through the same
 * pipeline as every future surface —
 *
 *     Events → Meaning Evaluator → Journey Metrics → Badge Evaluator → Journey UI
 *
 * — which is the point of the abstraction. When stories, communities, meetups
 * and the calendar arrive, none of them gets to bring its own opinion about
 * spam, repetition or what a friendship is worth.
 *
 * ## What a source is responsible for
 *
 * Facts, and only facts about *this* user: what was sent, how long it was, who
 * else wrote and when. It decides one thing the evaluator cannot — whether an
 * opener was answered — because that is a property of the thread and the thread
 * is what this holds.
 *
 * ## What is not emitted, and why that is the honest answer
 *
 * No `voice.played`: the policy counts voice notes the recipient *played*, and
 * nothing records a play. A source that emitted `voice.played` on send would be
 * lying to the evaluator, which is worse than a metric sitting at zero. Same
 * for photo opens and saves.
 */
import { evaluateJourney, type Evaluation } from '../journey/evaluate.js';
import type { JourneyEvent } from '../journey/events.js';
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

/** An opener counts as a conversation only if they answered inside this. */
const OPENER_ANSWERED_WITHIN = 7 * 24 * 60 * 60 * 1000;

/**
 * Everything a message list can honestly say happened.
 *
 * `selfId` is required rather than optional: a source that guesses which
 * messages are yours would feed the evaluator somebody else's activity, and
 * every number on Journey would quietly be about the wrong person.
 */
export function messageEvents(
  messages: readonly CountableMessage[],
  selfId: string,
): JourneyEvent[] {
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const events: JourneyEvent[] = [];

  for (const message of ordered) {
    if (message.authorId === selfId) {
      events.push({
        kind: 'message.sent',
        id: message.id,
        at: message.createdAt,
        conversationId: message.conversationId,
        characters: message.body.trim().length,
        // The trimmed body, used only to notice the same thing said twice. It
        // never leaves the device and never reaches a counter.
        fingerprint: message.body.trim(),
      });
    } else {
      events.push({
        kind: 'message.received',
        id: message.id,
        at: message.createdAt,
        conversationId: message.conversationId,
        with: message.authorId,
      });
    }
  }

  for (const started of conversationsStarted(ordered, selfId)) events.push(started);

  return events;
}

/**
 * Openers that became conversations.
 *
 * The first message in a thread is only an opener; it is a conversation once
 * the other person answers, and only if they answer inside a week. An opener
 * nobody replied to is not a conversation, and counting it would reward sending
 * them.
 */
function conversationsStarted(
  ordered: readonly CountableMessage[],
  selfId: string,
): JourneyEvent[] {
  const first = new Map<string, CountableMessage>();
  for (const message of ordered) if (!first.has(message.conversationId)) first.set(message.conversationId, message);

  const events: JourneyEvent[] = [];
  for (const [conversationId, opener] of first) {
    if (opener.authorId !== selfId) continue;

    const answer = ordered.find(
      (m) => m.conversationId === conversationId && m.authorId !== selfId && m.createdAt > opener.createdAt,
    );
    if (!answer || answer.createdAt - opener.createdAt > OPENER_ANSWERED_WITHIN) continue;

    events.push({
      kind: 'conversation.started',
      // Dated to the answer, because that is when it became one.
      id: `started:${conversationId}`,
      at: answer.createdAt,
      conversationId,
      with: answer.authorId,
    });
  }
  return events;
}

/** The whole pipeline over a message list, for callers that want the detail. */
export function evaluateMessages(
  messages: readonly CountableMessage[],
  selfId: string,
): Evaluation {
  return evaluateJourney(messageEvents(messages, selfId));
}

/** Just the counters, for the Badge Evaluator. */
export function countMessageMetrics(
  messages: readonly CountableMessage[],
  selfId: string,
): BadgeMetrics {
  return evaluateMessages(messages, selfId).metrics;
}
