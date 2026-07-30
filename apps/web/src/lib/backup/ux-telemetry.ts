/**
 * Which backup screens people saw, and nothing else.
 *
 * Written against [docs/13 § 2.3](../../../../docs/13-analytics-telemetry.md),
 * which puts product analytics in the opt-in stream and is explicit about why:
 * knowing which features get used is useful to us and is not necessary for the
 * app to work, so for a product whose whole claim is privacy the default has to
 * be off.
 *
 * ## The allowlist is the mechanism, not a guideline
 *
 * An event is a name from a fixed list and a millisecond timestamp. There is no
 * properties bag, because a properties bag is how privacy-respecting analytics
 * stops being privacy-respecting: one conversation id, aggregated over a week,
 * reconstructs who talks to whom. `record` cannot carry one — there is nowhere
 * to put it.
 *
 * ## Nothing leaves the device in this stage
 *
 * There is no collection endpoint yet, so events accumulate in a small ring
 * buffer for inspection and are dropped on overflow. Shipping a transport that
 * nobody has reviewed would be the wrong order.
 */
import { openRecord, sealRecord } from '../crypto/session.js';
import { STORE, localGet, localSet } from '../local/db.js';

/**
 * Every event this module may ever emit.
 *
 * Names describe a screen or a tap. None of them can be made to carry who,
 * what, or with whom.
 */
export const UX_EVENTS = [
  'backup.prompt.shown',
  'backup.prompt.enable',
  'backup.prompt.notnow',
  'backup.reminder.shown',
  'backup.reminder.dismissed',
  'backup.restore.prompt.shown',
  'backup.restore.accepted',
  'backup.restore.skipped',
] as const;

export type UxEvent = (typeof UX_EVENTS)[number];

/** One event: what happened and when. There is deliberately no third field. */
export interface RecordedEvent {
  event: UxEvent;
  at: number;
}

const CONSENT_KEY = 'ux-telemetry-consent';
const BUFFER_KEY = 'ux-telemetry-buffer';
const MAX_EVENTS = 200;

/**
 * Off unless the user has said yes.
 *
 * Absence of consent is not consent, so a missing record reads as false rather
 * than as "not asked yet, assume fine".
 */
export async function telemetryEnabled(): Promise<boolean> {
  return (await openRecord<boolean>(await localGet<unknown>(STORE.meta, CONSENT_KEY))) === true;
}

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  await localSet(STORE.meta, CONSENT_KEY, await sealRecord(enabled));
  // Turning it off discards what was already collected. Keeping it would make
  // the switch a pause button, which is not what it says.
  if (!enabled) await localSet(STORE.meta, BUFFER_KEY, await sealRecord([]));
}

/**
 * Record one event, if the user has opted in.
 *
 * Never throws and never blocks the caller: a UI action must not fail because
 * analytics did. Callers use `void record(...)` and carry on.
 */
export async function record(event: UxEvent): Promise<void> {
  try {
    if (!UX_EVENTS.includes(event)) return;
    if (!(await telemetryEnabled())) return;

    const held =
      (await openRecord<RecordedEvent[]>(await localGet<unknown>(STORE.meta, BUFFER_KEY))) ?? [];

    // Oldest out first. A buffer that grows without limit is a storage bug
    // wearing an analytics costume.
    const next = [...held, { event, at: Date.now() }].slice(-MAX_EVENTS);
    await localSet(STORE.meta, BUFFER_KEY, await sealRecord(next));
  } catch {
    /* analytics must never be able to break a screen */
  }
}

/** What has been collected, for the user to inspect and for verification. */
export async function collected(): Promise<RecordedEvent[]> {
  return (await openRecord<RecordedEvent[]>(await localGet<unknown>(STORE.meta, BUFFER_KEY))) ?? [];
}

/** Counts per event, which is the only shape anything downstream should want. */
export function summarise(events: RecordedEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.event] = (out[e.event] ?? 0) + 1;
  return out;
}
