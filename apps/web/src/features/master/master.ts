import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * PINGO Master, from the app's side: read what the person switched on, read and
 * decide tasks. Every rule lives in the database (20261106000000_pingo_master);
 * these are thin calls, and a refusal comes back as the sentence to show.
 */

export type MasterKind = 'send_message' | 'set_setting';
export type MasterStatus = 'pending' | 'scheduled' | 'done' | 'failed' | 'cancelled' | 'declined' | 'expired';

export interface MasterSettings {
  enabled: boolean;
  allow_messages: boolean;
  allow_settings: boolean;
}

export interface MasterAction {
  id: string;
  kind: MasterKind;
  params: { conversation_id?: string; text?: string; key?: string; value?: string };
  status: MasterStatus;
  run_at: string | null;
  credits: number;
  created_at: string;
  expires_at: string;
  result: string | null;
}

type Reply<T> = Promise<{ data: T | null; error: { message: string } | null }>;
interface Loose {
  rpc: (fn: string, args?: Record<string, unknown>) => Reply<unknown>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => { maybeSingle: () => Reply<unknown> };
      in: (col: string, values: string[]) => Reply<unknown>;
      order: (col: string, o: { ascending: boolean }) => { limit: (n: number) => Reply<unknown> };
      maybeSingle?: never;
    };
  };
}
const db = () => getSupabaseClient() as unknown as Loose;

const COLUMNS = 'id, kind, params, status, run_at, credits, created_at, expires_at, result';

/** The database's own sentence for a refusal, without the Postgres prefix. */
export function sayError(message: string | undefined): string {
  return (message ?? 'That did not work.').replace(/^.*?ERROR:\s*/, '').slice(0, 200);
}

export async function loadSettings(): Promise<MasterSettings> {
  const { data } = await db()
    .from('ai_master_settings')
    .select('enabled, allow_messages, allow_settings')
    .eq('user_id', (await getSupabaseClient().auth.getUser()).data.user?.id ?? '')
    .maybeSingle();
  return (data as MasterSettings | null) ?? { enabled: false, allow_messages: true, allow_settings: true };
}

export async function configure(next: MasterSettings): Promise<void> {
  const { error } = await db().rpc('master_configure', {
    p_enabled: next.enabled,
    p_messages: next.allow_messages,
    p_settings: next.allow_settings,
  });
  if (error) throw new Error(sayError(error.message));
}

/**
 * One action, by id - but asked together with every other card on the screen.
 *
 * Each action card loads its own row when it appears, and a thread with the
 * assistant shows several at once: nine cards were nine identical-looking
 * requests the moment the chat opened. Everything asked for within a few
 * milliseconds now goes out as a single `in (...)` query.
 */
let waiting = new Map<string, Array<(row: MasterAction | null) => void>>();
let flushing = false;

async function flushActions(): Promise<void> {
  const batch = waiting;
  waiting = new Map();
  flushing = false;
  const settle = (rows: MasterAction[]) => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const [id, callbacks] of batch) for (const done of callbacks) done(byId.get(id) ?? null);
  };
  try {
    const { data } = await db().from('ai_actions').select(COLUMNS).in('id', [...batch.keys()]);
    settle((data as MasterAction[] | null) ?? []);
  } catch {
    settle([]);
  }
}

export function loadAction(id: string): Promise<MasterAction | null> {
  return new Promise((resolve) => {
    const callbacks = waiting.get(id) ?? [];
    callbacks.push(resolve);
    waiting.set(id, callbacks);
    if (!flushing) {
      flushing = true;
      setTimeout(() => void flushActions(), 20);
    }
  });
}

export async function loadLog(limit = 30): Promise<MasterAction[]> {
  const { data } = await db().from('ai_actions').select(COLUMNS).order('created_at', { ascending: false }).limit(limit);
  return (data as MasterAction[] | null) ?? [];
}

export async function approve(id: string): Promise<MasterAction> {
  const { data, error } = await db().rpc('master_approve', { p_id: id });
  if (error || !data) throw new Error(sayError(error?.message));
  return data as MasterAction;
}

export async function decline(id: string): Promise<void> {
  await db().rpc('master_decline', { p_id: id });
}

export async function cancel(id: string): Promise<void> {
  await db().rpc('master_cancel', { p_id: id });
}

/** "Tomorrow, 9:00 am" style, in the reader's own time. */
export function whenLabel(iso: string | null): string {
  if (!iso) return 'right away';
  const date = new Date(iso);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `tomorrow, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}
