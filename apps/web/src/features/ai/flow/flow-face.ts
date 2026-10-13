import { useEffect, useState, useSyncExternalStore } from 'react';


export type FlowFace =
  | 'default'
  | 'happy'
  | 'excited'
  | 'thinking'
  | 'surprised'
  | 'sleepy'
  | 'confused'
  | 'sad'
  | 'angry'
  | 'listening'
  | 'talking';
export type FlowMode = 'idle' | 'listening' | 'talking';

/**
 * What Pingo Flow's face says, from what PINGO AI is doing.
 *
 * Work shows as work (thinking while it thinks, eyes wide while it draws), a
 * reply shows the mood the model gave it for a few seconds, and a command can
 * pull a face on demand. Then it settles back to its resting face.
 */

const MOODS = new Set<FlowFace>(['default', 'happy', 'excited', 'thinking', 'surprised', 'sleepy', 'confused', 'sad', 'angry', 'listening', 'talking']);

export function asFlowFace(value: unknown): FlowFace | undefined {
  return typeof value === 'string' && MOODS.has(value as FlowFace) ? (value as FlowFace) : undefined;
}

/* A face asked for from outside (a command, a tap), held for a moment. */
let reaction: { face: FlowFace; until: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function reactWith(face: FlowFace, ms = 2600): void {
  reaction = { face, until: Date.now() + ms };
  emit();
  window.setTimeout(emit, ms + 20);
}

function useReaction(): FlowFace | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (reaction && reaction.until > Date.now() ? reaction.face : undefined),
  );
}

const STAGE_FACE: Record<string, FlowFace> = {
  remembering: 'thinking',
  reading: 'thinking',
  thinking: 'thinking',
  reconsidering: 'confused',
  reading_reply: 'thinking',
  polishing: 'thinking',
  searching: 'thinking',
  looking: 'surprised',
  reading_file: 'thinking',
  drawing: 'excited',
  uploading: 'excited',
  writing: 'talking',
};

export function useFlowFace({
  stage,
  writing,
  lastReplyId,
  lastReplyMood,
  failed,
}: {
  stage: string | undefined;
  /** The reply is streaming into the thread. */
  writing: boolean;
  /** The newest message from PINGO AI, so a new one can show its mood. */
  lastReplyId: string | undefined;
  lastReplyMood: unknown;
  failed?: boolean;
}): { face: FlowFace; mode: FlowMode } {
  const reacting = useReaction();
  const [afterglow, setAfterglow] = useState<{ id: string; face: FlowFace } | null>(null);
  const [seenId, setSeenId] = useState(lastReplyId);
  const [dozing, setDozing] = useState(false);

  // A reply that arrives while the chat is open shows its mood for a few seconds.
  useEffect(() => {
    if (!lastReplyId || lastReplyId === seenId) return;
    setSeenId(lastReplyId);
    if (seenId === undefined) return; // the history loading in is not news
    const face = asFlowFace(lastReplyMood) ?? 'happy';
    setAfterglow({ id: lastReplyId, face });
    const timer = window.setTimeout(() => setAfterglow((a) => (a?.id === lastReplyId ? null : a)), 5200);
    return () => window.clearTimeout(timer);
  }, [lastReplyId, lastReplyMood, seenId]);

  // Left alone for a while, it nods off; any activity wakes it.
  const busy = Boolean(stage || writing);
  useEffect(() => {
    setDozing(false);
    if (busy) return;
    const timer = window.setTimeout(() => setDozing(true), 90_000);
    return () => window.clearTimeout(timer);
  }, [busy, lastReplyId, reacting]);

  if (reacting) return { face: reacting, mode: 'idle' };
  if (failed) return { face: 'sad', mode: 'idle' };
  if (writing) return { face: 'talking', mode: 'talking' };
  if (stage) return { face: STAGE_FACE[stage] ?? 'thinking', mode: 'idle' };
  if (afterglow) return { face: afterglow.face, mode: 'idle' };
  if (dozing) return { face: 'sleepy', mode: 'idle' };
  return { face: 'default', mode: 'idle' };
}

/* ---------- motion, per device ---------- */

/** Pingo's motion: the float, the hops and the bob while it talks. */
export interface FlowMotion {
  body: boolean;
}

const MOTION_KEY = 'pingo.flow.motion';
const motionListeners = new Set<() => void>();
let motionCache: { raw: string | null; value: FlowMotion } | undefined;

function readMotion(): FlowMotion {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(MOTION_KEY);
  } catch {
    /* private mode: on */
  }
  if (motionCache && motionCache.raw === raw) return motionCache.value;
  let value: FlowMotion = { body: true };
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<FlowMotion>) : {};
    value = { body: parsed.body !== false };
  } catch {
    /* a bad value: on */
  }
  motionCache = { raw, value };
  return value;
}

export function setFlowMotion(patch: Partial<FlowMotion>): void {
  const next = { ...readMotion(), ...patch };
  try {
    localStorage.setItem(MOTION_KEY, JSON.stringify(next));
  } catch {
    /* this session only */
    motionCache = { raw: JSON.stringify(next), value: next };
  }
  motionListeners.forEach((l) => l());
}

export function useFlowMotion(): FlowMotion {
  return useSyncExternalStore(
    (l) => {
      motionListeners.add(l);
      return () => motionListeners.delete(l);
    },
    readMotion,
  );
}
