import { cn } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';

import {
  KINDS,
  STATUS_LABEL,
  dayLabel,
  loadInbox,
  setStatus,
  type FeedbackStatus,
  type InboxItem,
} from './feedback.js';

/**
 * Operator only (Controlling): what people wrote in Wishes & feedback.
 *
 * Defaults to what has not been dealt with yet. Setting a status is what the
 * person sees beside their own message, so "Planned" and "Done" are promises
 * and are set by hand.
 */

const FILTERS: { id: FeedbackStatus | 'open'; label: string }[] = [
  { id: 'open', label: 'To read' },
  { id: 'planned', label: 'Planned' },
  { id: 'done', label: 'Done' },
  { id: 'declined', label: 'Not now' },
];

const SET: FeedbackStatus[] = ['seen', 'planned', 'done', 'declined'];

export function FeedbackInbox() {
  const [filter, setFilter] = useState<FeedbackStatus | 'open'>('open');
  const [rows, setRows] = useState<InboxItem[]>();
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    try {
      setRows(await loadInbox(filter));
      setNote(undefined);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not load feedback');
      setRows([]);
    }
  }, [filter]);

  useEffect(() => {
    setRows(undefined);
    void load();
  }, [load]);

  const mark = async (row: InboxItem, status: FeedbackStatus) => {
    setBusy(row.id);
    try {
      await setStatus(row.id, status);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="text-[17px] font-semibold">Wishes &amp; feedback</h2>
      <p className="mt-1 text-[13px] text-text-secondary">
        What people wrote in Settings → Wishes &amp; feedback. The status you set shows beside their message.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px]',
              filter === f.id ? 'bg-accent text-white' : 'bg-hover text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows === undefined && <p className="mt-3 text-[13px] text-text-secondary">Loading...</p>}
      {rows?.length === 0 && !note && <p className="mt-3 text-[13px] text-text-secondary">Nothing here.</p>}

      <ul className="mt-3 flex flex-col gap-2">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-text-secondary">
              <span className="font-medium text-ink">{row.display_name ?? 'Unknown'}</span>
              {row.username && <span>@{row.username}</span>}
              <span aria-hidden>·</span>
              <span>{KINDS.find((k) => k.id === row.kind)?.label ?? row.kind}</span>
              <span aria-hidden>·</span>
              <span>{dayLabel(row.created_at)}</span>
              {row.app_version && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {row.platform === 'android' ? 'Android' : 'Web'} {row.app_version}
                  </span>
                </>
              )}
              <span className="ml-auto rounded-full bg-hover px-2 py-0.5 text-[12px]">{STATUS_LABEL[row.status]}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[14.5px] text-ink">{row.body}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SET.filter((s) => s !== row.status).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy === row.id}
                  onClick={() => void mark(row, s)}
                  className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink disabled:opacity-50"
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {note && <p className="mt-2 text-[13px] text-text-secondary">{note}</p>}
    </section>
  );
}
