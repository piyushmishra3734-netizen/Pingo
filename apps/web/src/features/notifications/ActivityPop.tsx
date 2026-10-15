import { cn } from '@pingo/ui';
import { AtSign, Heart, MessageCircle, Phone, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Instagram's activity popup: a little bubble that rises over the Activity
 * tab with what happened while you were away (hearts, follows, calls), stays
 * a few seconds, and goes. It comes back when something new arrives.
 *
 * Counts only, from `unread_activity_counts`; tapping the tab is how you see
 * the list. Not shown on the Activity page itself.
 */
const GROUPS: { kinds: string[]; icon: ReactNode; label: string }[] = [
  { kinds: ['like'], icon: <Heart size={15} fill="currentColor" strokeWidth={0} />, label: 'likes' },
  { kinds: ['comment', 'story_reply'], icon: <MessageCircle size={15} fill="currentColor" strokeWidth={0} />, label: 'comments and replies' },
  { kinds: ['follow_request', 'follow_accepted'], icon: <UserPlus size={15} strokeWidth={2.6} />, label: 'follow requests' },
  { kinds: ['call'], icon: <Phone size={14} fill="currentColor" strokeWidth={0} />, label: 'missed calls' },
  { kinds: ['story', 'live', 'ping_opened', 'ping_replayed'], icon: <AtSign size={15} strokeWidth={2.6} />, label: 'other activity' },
];

const SHOW_MS = 5000;

export function ActivityPop({ byKind, hidden }: { byKind: Record<string, number>; hidden: boolean }) {
  const parts = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, count: g.kinds.reduce((n, k) => n + (byKind[k] ?? 0), 0) })).filter((g) => g.count > 0),
    [byKind],
  );
  const total = parts.reduce((n, p) => n + p.count, 0);
  const [open, setOpen] = useState(false);
  const seen = useRef(0);

  // Up when there is more than last time, then away after a few seconds.
  useEffect(() => {
    if (hidden || total === 0) {
      setOpen(false);
      if (total === 0) seen.current = 0;
      return;
    }
    if (total <= seen.current) return;
    seen.current = total;
    setOpen(true);
    const timer = window.setTimeout(() => setOpen(false), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [total, hidden]);

  if (!parts.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={parts.map((p) => `${p.count} ${p.label}`).join(', ')}
      className={cn(
        'pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 transition-all duration-300 ease-out',
        open ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-90 opacity-0',
      )}
    >
      <div className="relative flex items-center gap-2.5 rounded-[14px] bg-[#ff3b5c] px-3 py-2 text-white shadow-[0_8px_24px_-6px_rgb(255_59_92/0.55)]">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1 text-[13px] font-bold tabular-nums leading-none">
            {p.icon}
            {p.count > 99 ? '99+' : p.count}
          </span>
        ))}
        <span aria-hidden className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-[#ff3b5c]" />
      </div>
    </div>
  );
}
