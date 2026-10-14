import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useConfirm } from '../../../components/ConfirmProvider.js';
import { getSupabaseClient } from '../../../lib/supabase/client.js';

/** Keep equal to CONTEXT_LIMIT in supabase/functions/ai-chat/luna.ts. */
export const AI_CONTEXT_LIMIT = 32_000;

/**
 * How full this PINGO AI chat's memory of itself is, as the ring other AI apps
 * put in the corner. The number is the latest turn's prompt as OpenAI counted
 * it, not a guess. Tapping says what it means; when it is nearly full it asks,
 * once, whether to compact - older messages folded into a short summary the
 * chat keeps reading. Nothing is compacted without that yes.
 */
export function AiContextRing({ conversationId, version }: { conversationId: string; version: number }) {
  const confirm = useConfirm();
  const [tokens, setTokens] = useState<number>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const asked = useRef(false);

  // Read again whenever the thread moves on: a reply changes the size.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void getSupabaseClient()
        .rpc('ai_context', { target: conversationId })
        .then(({ data }) => {
          if (live) setTokens(data?.[0]?.tokens ?? 0);
        });
    }, 1500);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [conversationId, version]);

  const share = Math.min(1, (tokens ?? 0) / AI_CONTEXT_LIMIT);
  const percent = Math.round(share * 100);
  const full = share >= 0.9;

  const compact = async () => {
    const yes = await confirm({
      title: 'Compact this chat?',
      description:
        'PINGO AI folds the older messages into a short summary and keeps reading that, so the chat goes on without losing the thread. Your messages stay on screen.',
      confirmLabel: 'Compact',
      tone: 'normal',
    });
    if (!yes) return;
    setBusy(true);
    setNote('');
    const { data, error } = await getSupabaseClient().functions.invoke<{ compacted?: boolean; tokens?: number; reason?: string; error?: string }>(
      'ai-chat',
      { body: { conversationId, action: 'compact' } },
    );
    setBusy(false);
    if (error || data?.error) return setNote(data?.error ?? 'Could not compact right now. Try again.');
    if (!data?.compacted) return setNote(data?.reason ?? 'Nothing to compact yet.');
    setTokens(data.tokens ?? 0);
    setNote('Compacted. PINGO AI still remembers the whole chat.');
  };

  // Nearly full: ask once per visit, the way the ring would ask if it could talk.
  useEffect(() => {
    if (!full || asked.current) return;
    asked.current = true;
    setOpen(true);
  }, [full]);

  // Escape or a tap anywhere else closes the card.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (tokens === undefined) return null;
  const r = 9;
  const c = 2 * Math.PI * r;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={`Chat memory ${percent}% full`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="room-icon grid size-11 place-items-center rounded-full active:scale-95"
      >
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden className="-rotate-90">
          <circle cx={12} cy={12} r={r} fill="none" strokeWidth={2.5} className="stroke-current opacity-20" />
          <circle
            cx={12}
            cy={12}
            r={r}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(share, 0.02))}
            className={cn('transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none', full ? 'stroke-[#e5484d]' : 'stroke-current')}
          />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Chat memory" className="lq-glass-water absolute top-12 right-0 z-30 w-[270px] rounded-[18px] p-3.5 text-left shadow-lg">
          <p className="text-[15px] font-semibold text-ink">{percent}% of this chat's memory used</p>
          <p className="mt-1 text-[13.5px] leading-snug text-text-secondary">
            PINGO AI reads this whole chat on every reply ({Math.round((tokens ?? 0) / 1000)}k of {AI_CONTEXT_LIMIT / 1000}k tokens).
            {full ? ' It is nearly full: compact it, or the oldest messages start to slip out.' : ' When it fills up, compact it to keep going.'}
          </p>
          {note && <p role="status" className="mt-2 text-[13px] text-text-secondary">{note}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1.5 text-[14px] font-medium text-text-secondary active:bg-hover">
              Close
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void compact()}
              className="rounded-full bg-brand px-3.5 py-1.5 text-[14px] font-semibold text-on-brand active:scale-95 disabled:opacity-50"
            >
              {busy ? 'Compacting…' : 'Compact'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
