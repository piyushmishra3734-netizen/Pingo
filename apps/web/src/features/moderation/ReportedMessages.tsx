import { Button } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Operator only (Controlling): messages somebody reported, and a way to take
 * one down for everyone.
 *
 * ## What it can and cannot do
 *
 * It lists reported messages by who sent them and how many people reported
 * them. It does not show the text: chats are end to end encrypted and the server
 * has nothing readable to hand over. The only way to judge a report is from the
 * people involved, so this asks before it acts.
 *
 * Removing is the same delete-for-everyone as anywhere else: everybody in the
 * chat still sees that a message was deleted. The server only accepts a message
 * that has been reported, and writes every removal to a log nobody can read
 * through the API.
 */

interface Row {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  reports: number;
  first_reported_at: string;
  sent_at: string;
}

export function ReportedMessages() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>();
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseClient().rpc('operator_reported_messages');
    if (error) {
      setNote(error.message);
      setRows([]);
      return;
    }
    setNote(undefined);
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (row: Row) => {
    const go = await confirm({
      title: 'Remove this message for everyone?',
      description: `Reported ${row.reports} time${row.reports === 1 ? '' : 's'}. Everybody in the chat will see that a message was deleted. You cannot read it, so only do this if you have checked with the people involved.`,
      confirmLabel: 'Remove',
    });
    if (!go) return;
    setBusy(row.message_id);
    const { error } = await getSupabaseClient().rpc('operator_remove_reported_message', { p_message_id: row.message_id });
    setBusy(undefined);
    setNote(error ? error.message : 'Removed');
    if (!error) await load();
  };

  return (
    <section className="mt-8">
      <h2 className="text-[17px] font-semibold">Reported messages</h2>
      <p className="mt-1 text-[13px] text-text-secondary">
        Messages people reported. You see who sent them, not what they say. Removing one leaves a deleted note in the chat.
      </p>

      {rows === undefined && <p className="mt-3 text-[13px] text-text-secondary">Loading...</p>}
      {rows?.length === 0 && !note && <p className="mt-3 text-[13px] text-text-secondary">Nothing reported.</p>}

      <ul className="mt-3 flex flex-col gap-2">
        {(rows ?? []).map((row) => (
          <li key={row.message_id} className="flex items-center gap-3 rounded-xl border border-line p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{row.sender_name ?? 'Unknown'}</span>
              <span className="block text-[12.5px] text-text-secondary">
                {row.reports} report{row.reports === 1 ? '' : 's'} · sent {new Date(row.sent_at).toLocaleDateString()}
              </span>
            </span>
            <Button type="button" variant="secondary" disabled={busy === row.message_id} onClick={() => void remove(row)}>
              {busy === row.message_id ? 'Removing...' : 'Remove for everyone'}
            </Button>
          </li>
        ))}
      </ul>

      {note && <p className="mt-2 text-[13px] text-text-secondary">{note}</p>}
    </section>
  );
}
