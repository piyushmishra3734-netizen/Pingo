/**
 * Today's three missions, counted from what actually happened today.
 *
 * The daily card used to draw `DUMMY_MISSIONS`: the same three rows with the
 * same frozen bars for everybody, every day. However much somebody talked or
 * called, nothing moved - which is exactly what "the tasks never count" meant.
 *
 * Same missions, real numbers. Each still names something done *with*
 * somebody, and each is counted only from this device's own cache and call
 * log, with nothing sent anywhere.
 */
import { useChat } from '@pingo/core';
import { useEffect, useMemo, useState } from 'react';

import type { Mission } from './dummy-journey.js';

export interface MissionMessage {
  conversationId: string;
  authorId: string;
  createdAt: number;
}

export interface MissionCall {
  startedAt: number;
  duration: number;
  outcome: string;
}

const DAY = 24 * 60 * 60 * 1000;
/** Quiet for this long before today, and a message to them is checking in. */
const QUIET_FOR = 3 * DAY;

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dailyMissions(
  messages: readonly MissionMessage[],
  calls: readonly MissionCall[],
  selfId: string,
  directIds: ReadonlySet<string>,
  now = Date.now(),
): Mission[] {
  const today = startOfDay(now);
  const byConversation = new Map<string, MissionMessage[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }

  /** Chats where they wrote and you answered, today. One per chat. */
  let replied = 0;
  /** Direct chats that had gone quiet, that you wrote to today. */
  let checkedIn = 0;
  for (const [conversationId, list] of byConversation) {
    const ordered = [...list].sort((a, b) => a.createdAt - b.createdAt);
    const waited = ordered.some(
      (m, i) => m.authorId === selfId && m.createdAt >= today && i > 0 && ordered[i - 1]!.authorId !== selfId,
    );
    if (waited) replied += 1;

    if (!directIds.has(conversationId)) continue;
    const firstToday = ordered.find((m) => m.createdAt >= today && m.authorId === selfId);
    if (!firstToday) continue;
    const before = ordered.filter((m) => m.createdAt < today).pop();
    if (before && firstToday.createdAt - before.createdAt >= QUIET_FOR) checkedIn += 1;
  }

  const called = calls.filter((c) => c.startedAt >= today && c.outcome === 'answered' && c.duration > 0).length;

  return [
    { id: 'daily_reply', title: 'Reply to someone waiting', unit: 'replies', done: Math.min(replied, 2), target: 2, xpReward: 10 },
    { id: 'daily_call', title: 'Call a friend', unit: 'calls', done: Math.min(called, 1), target: 1, xpReward: 15 },
    { id: 'daily_check_in', title: 'Check in on someone quiet', unit: 'friends', done: Math.min(checkedIn, 1), target: 1, xpReward: 10 },
  ];
}

/** The card's missions, live. Starts at zero while the count is taken. */
export function useDailyMissions(): Mission[] {
  const { service, currentUser, conversations, ready } = useChat();
  const userId = currentUser?.id;
  const [counted, setCounted] = useState<Mission[]>(() => dailyMissions([], [], '', new Set()));

  // Only chats with something in them today can have moved a mission.
  const activeKey = useMemo(() => {
    const today = startOfDay(Date.now());
    return conversations
      .filter((c) => (c.lastMessage?.createdAt ?? 0) >= today)
      .map((c) => `${c.id}:${c.lastMessage?.id ?? ''}`)
      .sort()
      .join(',');
  }, [conversations]);

  useEffect(() => {
    if (!userId || !ready) return;
    let cancelled = false;
    void (async () => {
      const today = startOfDay(Date.now());
      const active = conversations.filter((c) => (c.lastMessage?.createdAt ?? 0) >= today);
      const messages: MissionMessage[] = [];
      for (const conversation of active) {
        const cached = await service.cachedMessages(conversation.id).catch(() => undefined);
        for (const m of cached ?? []) {
          if (!m.deleted) messages.push({ conversationId: m.conversationId, authorId: m.authorId, createdAt: m.createdAt });
        }
      }
      const calls = await service.listCalls().catch(() => []);
      const direct = new Set(conversations.filter((c) => c.kind === 'direct').map((c) => c.id));
      if (!cancelled) setCounted(dailyMissions(messages, calls, userId, direct));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on today's activity, see `activeKey`
  }, [service, userId, ready, activeKey]);

  return counted;
}
