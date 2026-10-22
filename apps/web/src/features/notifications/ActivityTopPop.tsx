import { useChat, type AppNotification } from '@pingo/core';
import { cn } from '@pingo/ui';
import { AtSign, Heart, MessageCircle, Phone, UserPlus, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useNotifications } from './NotificationContext.js';

/**
 * What came in while you were away, as a small pill under the bell, every time
 * the Chats page opens: a heart and how many likes, an @ and how many tags, a
 * phone and how many calls.
 *
 * The idea is Instagram's. The paint is not: solid brand colour with a soft
 * lift instead of a loud red bubble, rounded all the way, and it breathes in
 * from the bell rather than popping. A few seconds, then it goes; a tap opens
 * Activity. Nothing is shown when nothing is new.
 */

const GROUPS: { label: string; kinds: AppNotification['kind'][]; icon: LucideIcon }[] = [
  { label: 'likes', kinds: ['like', 'ping_opened'], icon: Heart },
  { label: 'comments and replies', kinds: ['comment', 'story_reply'], icon: MessageCircle },
  { label: 'tags', kinds: ['mention'], icon: AtSign },
  { label: 'missed calls', kinds: ['call'], icon: Phone },
  { label: 'follow requests', kinds: ['follow_request', 'follow_accepted'], icon: UserPlus },
];

const SHOW_MS = 5500;

export function ActivityTopPop() {
  const { service, ready } = useChat();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>();
  const [open, setOpen] = useState(false);

  // Once per visit: look at what is unread as soon as the count says there is something.
  const looked = useRef(false);
  useEffect(() => {
    if (!ready || looked.current || unread <= 0) return;
    looked.current = true;
    void service
      .listNotifications()
      .then((list) => setItems(list.filter((n) => !n.read)))
      .catch(() => undefined);
  }, [ready, unread, service]);

  const parts = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, count: (items ?? []).filter((n) => g.kinds.includes(n.kind)).length })).filter(
        (g) => g.count > 0,
      ),
    [items],
  );

  const total = parts.reduce((n, p) => n + p.count, 0);
  useEffect(() => {
    if (!total) return;
    let hide: ReturnType<typeof setTimeout> | undefined;
    // The once-a-day Journey card sits in the same place: let it finish first.
    const wait = setInterval(() => {
      if (document.querySelector('[data-daily-journey]')) return;
      clearInterval(wait);
      setOpen(true);
      hide = setTimeout(() => setOpen(false), SHOW_MS);
    }, 400);
    return () => {
      clearInterval(wait);
      clearTimeout(hide);
    };
  }, [total]);

  if (!parts.length) return null;

  return (
    <div
      className={cn(
        'absolute right-0 top-full z-40 mt-2.5 origin-top-right transition-[opacity,transform] duration-300 ease-out',
        open ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1 scale-90 opacity-0',
      )}
    >
      <button
        type="button"
        aria-label={`${parts.map((p) => `${p.count} ${p.label}`).join(', ')}. Open activity`}
        onClick={() => {
          setOpen(false);
          navigate('/notifications');
        }}
        className="relative flex items-center gap-3 rounded-full bg-brand px-3.5 py-2 text-white shadow-[0_10px_26px_-10px] shadow-brand/60 focus-ring"
      >
        {parts.map((p) => {
          const Icon = p.icon;
          return (
            <span key={p.label} className="flex items-center gap-1 text-[14px] font-semibold tabular-nums leading-none">
              <Icon size={15} strokeWidth={2.4} fill={p.icon === Heart || p.icon === MessageCircle ? 'currentColor' : 'none'} aria-hidden />
              {p.count > 99 ? '99+' : p.count}
            </span>
          );
        })}
        {/* The notch, pointing up at the bell. */}
        <span aria-hidden className="absolute -top-1 right-[1.15rem] size-2.5 rotate-45 rounded-[2px] bg-brand" />
      </button>
    </div>
  );
}
