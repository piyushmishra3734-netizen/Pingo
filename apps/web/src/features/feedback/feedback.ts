import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Wishes and feedback, from the app's side.
 *
 * Every rule (length, five a day, no repeats, who may read what) lives in the
 * database (20261125000000_feedback); these are thin calls, and a refusal comes
 * back as the sentence to show.
 */

export type FeedbackKind = 'wish' | 'fix' | 'love' | 'other';
export type FeedbackStatus = 'new' | 'seen' | 'planned' | 'done' | 'declined';

export const MAX_LENGTH = 2000;

/** What the person is telling us, in their words, and the hint under the box. */
export const KINDS: { id: FeedbackKind; label: string; hint: string }[] = [
  { id: 'wish', label: 'I wish PINGO had…', hint: 'A feature or a change you would love to see.' },
  { id: 'fix', label: 'Something to fix', hint: 'What went wrong, and what you were doing when it did.' },
  { id: 'love', label: 'I love…', hint: 'What you enjoy, so we keep it.' },
  { id: 'other', label: 'Something else', hint: 'Anything at all.' },
];

/** What a person sees beside their own message, and what the operator sets. */
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'Sent',
  seen: 'Seen',
  planned: 'Planned',
  done: 'Done',
  declined: 'Not now',
};

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  body: string;
  status: FeedbackStatus;
  created_at: string;
}

export interface InboxItem extends FeedbackItem {
  user_id: string;
  username: string | null;
  display_name: string | null;
  app_version: string | null;
  platform: 'android' | 'web' | null;
}

type Reply<T> = Promise<{ data: T | null; error: { message: string } | null }>;
interface Loose {
  rpc: (fn: string, args?: Record<string, unknown>) => Reply<unknown>;
  from: (table: string) => {
    select: (cols: string) => {
      order: (col: string, o: { ascending: boolean }) => { limit: (n: number) => Reply<unknown> };
    };
  };
}
const db = () => getSupabaseClient() as unknown as Loose;

/** The database's own sentence for a refusal, without the Postgres prefix. */
function sayError(message: string | undefined): string {
  return (message ?? 'That did not work. Please try again.').replace(/^.*?ERROR:\s*/, '').slice(0, 200);
}

export async function sendFeedback(input: {
  kind: FeedbackKind;
  body: string;
  appVersion: string;
  platform: 'android' | 'web';
}): Promise<FeedbackItem> {
  const { data, error } = await db().rpc('feedback_send', {
    p_kind: input.kind,
    p_body: input.body,
    p_app_version: input.appVersion,
    p_platform: input.platform,
  });
  if (error || !data) throw new Error(sayError(error?.message));
  return data as FeedbackItem;
}

/** The person's own messages, newest first. Loaded when the screen opens, never pushed. */
export async function loadMine(limit = 30): Promise<FeedbackItem[]> {
  const { data } = await db()
    .from('feedback')
    .select('id, kind, body, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as FeedbackItem[] | null) ?? [];
}

/** `open` is what has not been dealt with: new and seen. */
export async function loadInbox(status: FeedbackStatus | 'open' | null): Promise<InboxItem[]> {
  const { data, error } = await db().rpc('operator_feedback', { p_status: status });
  if (error) throw new Error(sayError(error.message));
  return (data as InboxItem[] | null) ?? [];
}

export async function setStatus(id: string, status: FeedbackStatus): Promise<void> {
  const { error } = await db().rpc('operator_feedback_set', { p_id: id, p_status: status });
  if (error) throw new Error(sayError(error.message));
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
