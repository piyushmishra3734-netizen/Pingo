import type { Message } from '@pingo/core';
import { useSyncExternalStore } from 'react';

import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * Nicknames, the way Messenger does them: set in a chat, seen by both people.
 *
 * A nickname is a message - "Piyush set Rohit's nickname to “Ro”" - so both
 * sides are told, in the thread, when it changes. Each device learns the
 * current one from those messages and keeps it here, per conversation, so the
 * list and the header can use it without scrolling back to find the message.
 *
 * The message is a sentence and a link, so an older build still reads it; the
 * link carries who it is for and the nickname. An empty nickname removes it.
 */

const KEY = 'pingo:nicknames-v1';
type Store = Record<string, Record<string, { n: string; at: number }>>;

let store: Store = read();
const listeners = new Set<() => void>();

function read(): Store {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store) ?? {};
  } catch {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode: holds for this session */
  }
  listeners.forEach((fn) => fn());
}

export interface NicknameEvent {
  /** Whose nickname it is. */
  userId: string;
  nick: string;
  /** Names as the setter saw them, for the line in the thread. */
  actorName: string;
  targetName: string;
}

export const MAX_NICKNAME = 30;

export function nicknameBody(e: NicknameEvent): string {
  const q = new URLSearchParams({ u: e.userId, n: e.nick, a: e.actorName.slice(0, 40), t: e.targetName.slice(0, 40) });
  const line = e.nick ? `${e.actorName} set ${e.targetName}'s nickname to “${e.nick}”` : `${e.actorName} removed ${e.targetName}'s nickname`;
  return `${line}\n${publicAppUrl(`/nick?${q.toString()}`)}`;
}

export function parseNickname(body: string): NicknameEvent | undefined {
  const match = /https?:\/\/\S+\/nick\?(\S+)/.exec(body);
  if (!match) return undefined;
  const q = new URLSearchParams(match[1]);
  const userId = q.get('u') ?? '';
  if (!/^[\w-]{1,64}$/.test(userId)) return undefined;
  return {
    userId,
    nick: (q.get('n') ?? '').slice(0, MAX_NICKNAME),
    actorName: q.get('a') ?? 'Someone',
    targetName: q.get('t') ?? 'someone',
  };
}

/** Reads nickname messages in a thread; the newest for each person wins. */
export function learnNicknames(conversationId: string, messages: readonly Message[]) {
  let changed = false;
  const known = { ...(store[conversationId] ?? {}) };
  for (const message of messages) {
    if (message.deleted) continue;
    const e = parseNickname(message.body);
    if (!e) continue;
    const had = known[e.userId];
    if (had && had.at >= message.createdAt) continue;
    known[e.userId] = { n: e.nick, at: message.createdAt };
    changed = true;
  }
  if (!changed) return;
  store = { ...store, [conversationId]: known };
  save();
}

export function nicknameOf(conversationId: string | undefined, userId: string | undefined): string | undefined {
  if (!conversationId || !userId) return undefined;
  return store[conversationId]?.[userId]?.n || undefined;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** A person's nickname in a conversation, kept current. */
export function useNickname(conversationId: string | undefined, userId: string | undefined): string | undefined {
  return useSyncExternalStore(subscribe, () => nicknameOf(conversationId, userId), () => undefined);
}
