import { useSyncExternalStore } from 'react';

import { getSupabaseClient } from '../supabase/client.js';
import { deriveSessionKey, newKeyPair, open, seal } from './crypto.js';
import { dropKeys, keepOnly, loadKeys, saveKeys } from './keystore.js';

/**
 * Private chat, from the app's side. See docs/private-chat-plan.md.
 *
 * A session is the same on both phones. Whoever starts it makes a temporary key
 * pair and tells the server the public half; the other phone, as soon as it is
 * open, makes its own and does the same, with no tap. From then on each phone
 * can derive the session key and every message is sealed under it.
 *
 * Nothing here is kept on the device beyond the session: messages are fetched
 * (still sealed) and opened into memory, and the key pair is dropped when the
 * session ends, on either side, or runs out.
 */

export interface PrivateMessage {
  id: string;
  mine: boolean;
  text: string;
  at: number;
  status: 'sending' | 'sent' | 'failed';
}

export interface PrivateSession {
  id: string;
  conversationId: string;
  peerId: string;
  /** Whether I started it. */
  creator: boolean;
  expiresAt: number;
  /** Both keys are in and messages can be sent. Until then they wait on this phone. */
  ready: boolean;
  /** Started on another device of mine: this one has no key and cannot read it. */
  unreadable: boolean;
  messages: PrivateMessage[];
}

interface Row {
  id: string;
  conversation_id: string;
  creator_id: string;
  peer_id: string;
  creator_pub: string | null;
  peer_pub: string | null;
  state: 'active' | 'ended';
  expires_at: string;
}

interface MsgRow {
  id: string;
  sender_id: string;
  ct: string;
  created_at: string;
}

type Reply<T> = Promise<{ data: T | null; error: { message: string } | null }>;
interface Channel {
  on: (type: 'postgres_changes', filter: Record<string, string>, cb: (p: { new: unknown }) => void) => Channel;
  subscribe: () => Channel;
}
interface Loose {
  rpc: (fn: string, args?: Record<string, unknown>) => Reply<unknown>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => {
        order: (col: string) => Reply<MsgRow[]>;
        maybeSingle: () => Reply<Row>;
      } & Reply<Row[]>;
    };
  };
  channel: (name: string) => Channel;
  removeChannel: (c: Channel) => unknown;
}
const db = () => getSupabaseClient() as unknown as Loose;

/** What lives only in this tab, never in the snapshot a screen reads. */
interface Runtime {
  userId: string;
  key?: CryptoKey;
  pub?: string;
  pair?: CryptoKeyPair;
  channel?: Channel;
  timer?: ReturnType<typeof setTimeout>;
  seen: Set<string>;
  waiting: { localId: string; text: string }[];
  /** The newest row of the sessions table seen for this session. */
  row?: Row;
  /** One claim of a key pair at a time, however many events arrive together. */
  claim?: Promise<void>;
  deriving?: boolean;
}

const sessions = new Map<string, PrivateSession>(); // by conversation id
const runtimes = new Map<string, Runtime>(); // by session id
const listeners = new Set<() => void>();
let me: string | undefined;
let sessionsChannel: Channel | undefined;
let lastResume = 0;
/** The pair a start in progress made, so its own Realtime event can find it before it is saved. */
let fresh: { pair: CryptoKeyPair; pub: string } | undefined;
/** Sessions I am ending right now, so the end that comes back over Realtime is not announced as theirs. */
const ending = new Set<string>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function put(next: PrivateSession) {
  sessions.set(next.conversationId, next);
  emit();
}

const bySessionId = (id: string) => [...sessions.values()].find((s) => s.id === id);

/** What the app should tell the person: someone started one, or one ended. */
export type PrivateNotice = { kind: 'started' | 'ended'; conversationId: string; byMe: boolean };
const noticeListeners = new Set<(n: PrivateNotice) => void>();
export const onPrivateNotice = (fn: (n: PrivateNotice) => void) => {
  noticeListeners.add(fn);
  return () => noticeListeners.delete(fn);
};
const notify = (n: PrivateNotice) => noticeListeners.forEach((l) => l(n));

export function usePrivateSession(conversationId: string | undefined): PrivateSession | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (conversationId ? sessions.get(conversationId) : undefined),
    () => undefined,
  );
}

/** A session is over for this phone: its key, its messages, its timer and its channel. */
async function teardown(sessionId: string, byMe: boolean) {
  const s = bySessionId(sessionId);
  const rt = runtimes.get(sessionId);
  if (rt?.timer) clearTimeout(rt.timer);
  if (rt?.channel) db().removeChannel(rt.channel);
  runtimes.delete(sessionId);
  await dropKeys(sessionId);
  if (s) {
    sessions.delete(s.conversationId);
    emit();
    notify({ kind: 'ended', conversationId: s.conversationId, byMe });
  }
}

function arm(sessionId: string, expiresAt: number) {
  const rt = runtimes.get(sessionId);
  if (!rt) return;
  if (rt.timer) clearTimeout(rt.timer);
  // The server sweeps what has run out; this makes the phone stop at the same moment.
  rt.timer = setTimeout(() => void teardown(sessionId, false), Math.max(0, expiresAt - Date.now()) + 500);
}

async function openRow(rt: Runtime, sessionId: string, row: MsgRow): Promise<PrivateMessage | undefined> {
  if (!rt.key || rt.seen.has(row.id)) return undefined;
  const body = await open(rt.key, sessionId, row.sender_id, row.ct);
  rt.seen.add(row.id);
  return {
    id: row.id,
    mine: row.sender_id === rt.userId,
    text: body ? body.b : 'This message could not be opened.',
    at: Date.parse(row.created_at),
    status: 'sent',
  };
}

function addMessages(sessionId: string, incoming: PrivateMessage[]) {
  const s = bySessionId(sessionId);
  if (!s || incoming.length === 0) return;
  const known = new Set(s.messages.map((m) => m.id));
  const merged = [...s.messages, ...incoming.filter((m) => !known.has(m.id))].sort((a, b) => a.at - b.at);
  put({ ...s, messages: merged });
}

/** Both keys are known: derive the session key, read what is already there, and listen. */
async function becomeReady(row: Row, rt: Runtime) {
  if (rt.key || !rt.pair || rt.deriving) return;
  const theirs = row.creator_id === rt.userId ? row.peer_pub : row.creator_pub;
  if (!theirs) return;
  rt.deriving = true;
  try {
    rt.key = await deriveSessionKey(rt.pair.privateKey, theirs, row.id);
  } catch {
    rt.deriving = false;
    return;
  }
  const s = bySessionId(row.id);
  if (s) put({ ...s, ready: true });

  rt.channel = db()
    .channel(`private-msgs:${row.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'private_messages', filter: `session_id=eq.${row.id}` }, (payload) => {
      void openRow(rt, row.id, payload.new as MsgRow).then((m) => m && addMessages(row.id, [m]));
    })
    .subscribe();

  const { data } = await db().from('private_messages').select('id,sender_id,ct,created_at').eq('session_id', row.id).order('created_at');
  const opened = await Promise.all((data ?? []).map((r) => openRow(rt, row.id, r)));
  addMessages(row.id, opened.filter((m): m is PrivateMessage => Boolean(m)));
  void flush(row.id);
}

/** A row of the sessions table arrived, from a query or from Realtime. */
async function apply(row: Row) {
  if (!me) return;
  if (row.state === 'ended') {
    if (runtimes.has(row.id) || bySessionId(row.id)) await teardown(row.id, ending.has(row.id));
    return;
  }
  const expiresAt = Date.parse(row.expires_at);
  if (expiresAt <= Date.now()) {
    if (runtimes.has(row.id)) await teardown(row.id, false);
    return;
  }

  let rt = runtimes.get(row.id);
  if (!rt) {
    rt = { userId: me, seen: new Set(), waiting: [] };
    runtimes.set(row.id, rt);
    const creator = row.creator_id === me;
    put({
      id: row.id,
      conversationId: row.conversation_id,
      peerId: creator ? row.peer_id : row.creator_id,
      creator,
      expiresAt,
      ready: false,
      unreadable: false,
      messages: [],
    });
  }
  rt.row = row;
  const known = bySessionId(row.id);
  if (known) put({ ...known, expiresAt });
  arm(row.id, expiresAt);

  if (!rt.pair) {
    rt.claim ??= claimPair(row, rt);
    await rt.claim;
  }
  const s = bySessionId(row.id);
  if (!rt.pair) {
    // Started on another device of mine, or the key was lost: this phone cannot read it.
    if (s && !s.unreadable) put({ ...s, unreadable: true });
    return;
  }
  if (s?.unreadable) put({ ...s, unreadable: false });
  await becomeReady(rt.row ?? row, rt);
}

/** Find this phone's key pair for the session, or, when somebody started one with me, make it and answer. */
async function claimPair(row: Row, rt: Runtime) {
  const creator = row.creator_id === rt.userId;
  const mine = creator ? row.creator_pub : row.peer_pub;
  if (creator && fresh && fresh.pub === row.creator_pub) {
    rt.pair = fresh.pair;
    rt.pub = fresh.pub;
    return;
  }
  const stored = await loadKeys(row.id);
  if (stored && (mine === null || stored.pub === mine)) {
    rt.pair = stored.pair;
    rt.pub = stored.pub;
    return;
  }
  if (!creator && row.peer_pub === null) {
    const made = await newKeyPair();
    await saveKeys(row.id, made);
    rt.pair = made.pair;
    rt.pub = made.pub;
    const { error } = await db().rpc('private_join', { p_session: row.id, p_pub: made.pub });
    if (error) {
      await teardown(row.id, false);
      rt.pair = undefined;
      return;
    }
    notify({ kind: 'started', conversationId: row.conversation_id, byMe: false });
  }
}

async function loadMine() {
  if (!me) return;
  const { data, error } = await db().from('private_sessions').select('id,conversation_id,creator_id,peer_id,creator_pub,peer_pub,state,expires_at').eq('state', 'active');
  const live = (data ?? []).filter((r) => Date.parse(r.expires_at) > Date.now());
  await keepOnly(new Set(live.map((r) => r.id)));
  // Anything this phone still shows that the server no longer lists is over.
  for (const s of [...sessions.values()]) if (!live.some((r) => r.id === s.id)) await teardown(s.id, false);
  for (const r of live) await apply(r);
}

/**
 * Called once when somebody is signed in. Finds a session already running (after
 * a reload, or one started while the app was shut) and listens for new ones.
 * Does nothing at all for a person who never uses the feature: one small query.
 */
export function startPrivateService(userId: string): () => void {
  if (me === userId) return () => undefined;
  me = userId;
  void loadMine().catch(() => undefined);

  const onSession = (p: { new: unknown }) => void apply(p.new as Row).catch(() => undefined);
  sessionsChannel = db()
    .channel(`private-sessions:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'private_sessions', filter: `creator_id=eq.${userId}` }, onSession)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'private_sessions', filter: `peer_id=eq.${userId}` }, onSession)
    .subscribe();

  // Coming back to the app, or the network returning: look once, no more than every 30 s.
  const resume = () => {
    if (document.visibilityState === 'hidden' || Date.now() - lastResume < 30_000) return;
    lastResume = Date.now();
    void loadMine().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);

  return () => {
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
    if (sessionsChannel) db().removeChannel(sessionsChannel);
    sessionsChannel = undefined;
    for (const id of [...runtimes.keys()]) {
      const rt = runtimes.get(id);
      if (rt?.timer) clearTimeout(rt.timer);
      if (rt?.channel) db().removeChannel(rt.channel);
    }
    runtimes.clear();
    sessions.clear();
    me = undefined;
    emit();
  };
}

/** Start a private chat in a one to one chat. Throws with the server's own wording when it refuses. */
export async function startPrivateChat(conversationId: string): Promise<void> {
  if (!me) throw new Error('Sign in first.');
  const made = await newKeyPair();
  fresh = made;
  const { data, error } = await db().rpc('private_start', { p_conversation_id: conversationId, p_pub: made.pub });
  if (error) {
    fresh = undefined;
    throw new Error(error.message);
  }
  const id = data as string;
  const { data: row } = await db().from('private_sessions').select('id,conversation_id,creator_id,peer_id,creator_pub,peer_pub,state,expires_at').eq('id', id).maybeSingle();
  if (!row) {
    fresh = undefined;
    throw new Error('Could not start the private chat.');
  }
  // Only a session this call just made is mine to key; a live one handed back keeps its own pair.
  if (row.creator_id === me && row.creator_pub === made.pub) await saveKeys(id, made);
  await apply(row);
  fresh = undefined;
  notify({ kind: 'started', conversationId, byMe: true });
}

/** End it for both people. */
export async function endPrivateChat(conversationId: string): Promise<void> {
  const s = sessions.get(conversationId);
  if (!s) return;
  ending.add(s.id);
  const { error } = await db().rpc('private_end', { p_session: s.id });
  if (error) {
    ending.delete(s.id);
    throw new Error(error.message);
  }
  await teardown(s.id, true);
  ending.delete(s.id);
}

async function flush(sessionId: string) {
  const rt = runtimes.get(sessionId);
  if (!rt?.key) return;
  const queued = rt.waiting.splice(0);
  for (const q of queued) await transmit(sessionId, q.localId, q.text);
}

async function transmit(sessionId: string, localId: string, text: string) {
  const rt = runtimes.get(sessionId);
  if (!rt?.key) return;
  const mark = (patch: Partial<PrivateMessage>) => {
    const s = bySessionId(sessionId);
    if (s) put({ ...s, messages: s.messages.map((m) => (m.id === localId ? { ...m, ...patch } : m)) });
  };
  try {
    const sealed = await seal(rt.key, sessionId, rt.userId, { t: 'text', b: text });
    const { data, error } = await db().rpc('private_send', { p_session: sessionId, p_ct: sealed });
    if (error) throw new Error(error.message);
    const sent = data as { id: string; created_at: string };
    const s = bySessionId(sessionId);
    if (!s) return;
    if (rt.seen.has(sent.id)) {
      // Realtime delivered my own row before the reply did: keep that one.
      put({ ...s, messages: s.messages.filter((m) => m.id !== localId) });
    } else {
      rt.seen.add(sent.id);
      put({ ...s, messages: s.messages.map((m) => (m.id === localId ? { ...m, id: sent.id, status: 'sent', at: Date.parse(sent.created_at) } : m)) });
    }
  } catch {
    mark({ status: 'failed' });
  }
}

/** Send a line. It appears at once; if the other phone has no key yet it waits here, unsent. */
export function sendPrivateMessage(conversationId: string, text: string): void {
  const s = sessions.get(conversationId);
  const rt = s ? runtimes.get(s.id) : undefined;
  const body = text.trim();
  if (!s || !rt || !body || s.unreadable) return;
  const localId = `local-${crypto.randomUUID()}`;
  put({ ...s, messages: [...s.messages, { id: localId, mine: true, text: body.slice(0, 4000), at: Date.now(), status: 'sending' }] });
  if (rt.key) void transmit(s.id, localId, body.slice(0, 4000));
  else rt.waiting.push({ localId, text: body.slice(0, 4000) });
}

export function retryPrivateMessage(conversationId: string, messageId: string): void {
  const s = sessions.get(conversationId);
  const m = s?.messages.find((x) => x.id === messageId);
  if (!s || !m || m.status !== 'failed') return;
  put({ ...s, messages: s.messages.map((x) => (x.id === messageId ? { ...x, status: 'sending' } : x)) });
  void transmit(s.id, messageId, m.text);
}

/**
 * Whether the feature is on for this person (`app_flag('private_chat')`), asked
 * once per launch. While it is off nothing else here runs: no channel, no query.
 */
let enabled = false;
export const usePrivateEnabled = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => enabled,
    () => false,
  );

const OFF_FOR_MS = 30 * 60_000;
const offKey = (userId: string) => `pingo.private.off.${userId}`;

/**
 * Asks the server once per launch whether this person has the feature. A "no" is
 * remembered for half an hour, so people who do not have it (almost everybody)
 * cost the server next to nothing; a "yes" is asked again every launch, so the
 * kill switch takes effect at once for the people who use it.
 */
export async function refreshPrivateEnabled(userId: string): Promise<boolean> {
  try {
    const at = Number(localStorage.getItem(offKey(userId)));
    if (at && Date.now() - at < OFF_FOR_MS) {
      enabled = false;
      emit();
      return false;
    }
  } catch {
    // storage unavailable: just ask
  }
  try {
    const { data } = await db().rpc('app_flag', { p_key: 'private_chat' });
    enabled = data === true;
  } catch {
    enabled = false;
  }
  try {
    if (enabled) localStorage.removeItem(offKey(userId));
    else localStorage.setItem(offKey(userId), String(Date.now()));
  } catch {
    // storage unavailable: nothing to remember
  }
  emit();
  return enabled;
}
