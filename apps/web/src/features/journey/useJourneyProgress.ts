/**
 * The Journey screen, on real data.
 *
 * The last stage of the pipeline:
 *
 *     Events → Meaning Evaluator → Journey Metrics → Badge Evaluator → Journey UI
 *
 * and this hook is the seam. It reads the local message cache, hands it to the
 * source, hands the events to the evaluator, and merges the result with what
 * this account has earned before.
 *
 * ## Cached messages only, and no network at all
 *
 * `cachedMessages` reads what this device already has. Journey is a screen
 * somebody browses; it is not worth a round-trip per conversation, and it is
 * certainly not worth downloading a history to count it. The consequence is
 * that the count describes *this device* — which is exactly why the result goes
 * through `mergeProgress`, so a device that has seen less can never reduce what
 * a device that saw more already earned.
 *
 * ## Nothing here decrypts anything extra
 *
 * The cache holds messages this device has already opened. No key is used, no
 * body leaves the device, and the only thing taken from the text is its length
 * and a fingerprint used to notice the same thing said twice.
 */
import { useChat } from '@pingo/core';
import { useEffect, useMemo, useState } from 'react';

import { evaluateMessages, type CountableMessage } from '../badges/metrics.js';
import { libraryFor, type BadgeMetrics, type BadgeProgress } from '../badges/registry.js';
import type { PulseEntry } from './dummy-journey.js';
import {
  feelingFrom,
  noticeToday,
  pickNotice,
  type JourneyFeeling,
  type Notice,
} from './noticing.js';
import {
  EMPTY_PROGRESS,
  levelFor,
  loadProgress,
  mergeProgress,
  saveProgress,
  type JourneyProgress,
  type Level,
} from './progress.js';

export interface JourneyState {
  level: Level;
  metrics: BadgeMetrics;
  library: BadgeProgress[];
  unlockedAt: Record<string, number>;
  /** Who you have been talking to, warmest first. Direct chats only. */
  pulse: PulseEntry[];
  /** How the journey feels, in words. Never a percentage. */
  feeling: JourneyFeeling;
  /** What the system noticed today, at most one, worth no progress at all. */
  notice?: Notice;
  /** When this account started, for the first line of the first chapter. */
  joinedAt: number;
  /** False until the first count settles. The screen renders regardless. */
  ready: boolean;
  /** True when there is genuinely nothing yet — a new account, not a slow one. */
  empty: boolean;
}

export function useJourneyProgress(): JourneyState {
  const { service, currentUser, conversations, ready } = useChat();
  const [progress, setProgress] = useState<JourneyProgress>(EMPTY_PROGRESS);
  const [metrics, setMetrics] = useState<BadgeMetrics>({});
  const [pulse, setPulse] = useState<PulseEntry[]>([]);
  const [feeling, setFeeling] = useState<JourneyFeeling>('Quietly here');
  const [notice, setNotice] = useState<Notice | undefined>();
  const [counted, setCounted] = useState(false);

  const userId = currentUser?.id;

  /*
   * A stable key for "which conversations exist".
   *
   * `conversations` is a new array on every provider refresh — a new message, a
   * presence change, a read receipt — and using it directly as a dependency
   * would re-read every cached thread on each of those. The count is worth
   * doing when the set of conversations changes or the screen is opened, and
   * not once a second while somebody is typing to you.
   */
  const conversationKey = useMemo(
    () => conversations.map((c) => c.id).sort().join(','),
    [conversations],
  );

  useEffect(() => {
    if (!userId || !ready) return;
    let cancelled = false;

    void (async () => {
      const stored = loadProgress(userId);
      // Show what is already known immediately; the count refines it.
      if (!cancelled) setProgress(stored);

      const messages: CountableMessage[] = [];
      for (const conversation of conversations) {
        const cached = await service.cachedMessages(conversation.id);
        if (!cached) continue;
        for (const message of cached) {
          // A deleted message's body is gone; counting the tombstone would
          // count something the user chose to take back.
          if (message.deleted) continue;
          messages.push({
            id: message.id,
            conversationId: message.conversationId,
            authorId: message.authorId,
            body: message.body,
            createdAt: message.createdAt,
            attachmentKinds: message.attachments.map((a) => a.kind),
          });
        }
      }
      if (cancelled) return;

      const { metrics: counts, momentsEarned } = evaluateMessages(messages, userId);

      const rows = pulseFrom(conversations, messages, userId);
      if (!cancelled) {
        setPulse(rows);

        const month = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const firstSeen = new Map<string, number>();
        for (const message of messages) {
          const known = firstSeen.get(message.conversationId);
          if (known === undefined || message.createdAt < known) {
            firstSeen.set(message.conversationId, message.createdAt);
          }
        }
        setFeeling(
          feelingFrom({
            pulse: rows,
            newConnections: [...firstSeen.values()].filter((at) => at >= month).length,
          }),
        );

        /*
         * Noticing runs after the counting and feeds nothing back into it. It
         * cannot reach the metrics or the moments — see `noticing.ts`, and the
         * check in `verify:noticing` that a day full of notices leaves the
         * level exactly where it was.
         */
        setNotice(pickNotice(noticeToday(messages, userId), userId));
      }
      const earned = libraryFor(counts, new Set(stored.unlockedIds)).filter((e) => e.unlocked);

      /*
       * Unlock dates are recorded the first time a badge is seen as earned.
       * There is no history of *when* a counter crossed a threshold, and
       * inventing one would put a date on the timeline that never happened —
       * so the honest answer is "now", and `mergeProgress` keeps the earliest.
       */
      const now = Date.now();
      const unlockedAt: Record<string, number> = {};
      for (const entry of earned) unlockedAt[entry.badge.id] = now;

      const earliest = messages.reduce(
        (oldest, m) => (m.createdAt < oldest ? m.createdAt : oldest),
        Number.POSITIVE_INFINITY,
      );

      const merged = mergeProgress(stored, {
        momentsEarned,
        unlockedIds: earned.map((e) => e.badge.id),
        unlockedAt,
        ...(Number.isFinite(earliest) ? { joinedAt: earliest } : {}),
      });

      saveProgress(userId, merged);
      setProgress(merged);
      setMetrics(counts);
      setCounted(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids
    // rather than the array, deliberately; see `conversationKey`.
  }, [service, userId, ready, conversationKey]);

  const library = useMemo(
    () => libraryFor(metrics, new Set(progress.unlockedIds)),
    [metrics, progress.unlockedIds],
  );

  return {
    level: levelFor(progress.momentsEarned),
    metrics,
    library,
    pulse,
    feeling,
    notice,
    unlockedAt: progress.unlockedAt,
    joinedAt: progress.joinedAt ?? Date.now(),
    ready: counted,
    empty: counted && progress.momentsEarned === 0,
  };
}

/** A fortnight, which is long enough to show warmth and short enough to be current. */
const PULSE_WINDOW = 14 * 24 * 60 * 60 * 1000;
const PULSE_ROWS = 5;

/**
 * Pulse, from the same messages.
 *
 * Direct chats only — a group is not a friendship, and a busy group would sit
 * at the top of a list that is supposed to be about people. Ordered by how
 * recently you spoke rather than by volume, because the section answers "who am
 * I close to now" and volume answers a different question that belongs in
 * Statistics.
 */
export function pulseFrom(
  conversations: readonly { id: string; kind: string; title: string }[],
  messages: readonly CountableMessage[],
  selfId: string,
  now = Date.now(),
): PulseEntry[] {
  const byConversation = new Map<string, { last: number; exchanges: number; bothSides: boolean }>();

  for (const message of messages) {
    const entry = byConversation.get(message.conversationId) ?? { last: 0, exchanges: 0, bothSides: false };
    if (message.createdAt > entry.last) entry.last = message.createdAt;
    if (now - message.createdAt <= PULSE_WINDOW) entry.exchanges += 1;
    if (message.authorId !== selfId) entry.bothSides = true;
    byConversation.set(message.conversationId, entry);
  }

  return conversations
    .filter((c) => c.kind === 'direct')
    .map((c) => ({ conversation: c, stats: byConversation.get(c.id) }))
    // A chat where only one person ever wrote is not a friendship to report on.
    .filter((row) => row.stats !== undefined && row.stats.bothSides && row.stats.exchanges > 0)
    .map(({ conversation, stats }) => ({
      id: conversation.id,
      name: conversation.title,
      quietDays: Math.max(0, Math.floor((now - stats!.last) / (24 * 60 * 60 * 1000))),
      exchanges: stats!.exchanges,
    }))
    .sort((a, b) => a.quietDays - b.quietDays || b.exchanges - a.exchanges)
    .slice(0, PULSE_ROWS);
}
