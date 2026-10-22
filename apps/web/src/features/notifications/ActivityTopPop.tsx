import { useChat, type AppNotification } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { AtSign, Heart, MessageCircle, Phone, UserPlus, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useNotifications } from './NotificationContext.js';

/**
 * What happened while you were away, under the bell, every time the Chats page
 * opens.
 *
 * Instagram puts a coloured bubble there with counts. This says who instead,
 * in plain rows on the app's own surface: a face, a name, what they did. A few
 * seconds, then it leaves; a tap anywhere on it opens Activity. Nothing is
 * shown when there is nothing new, and nothing in it is a button you have to
 * aim at.
 */

const KINDS: Partial<Record<AppNotification['kind'], { icon: LucideIcon; one: string; many: string }>> = {
  like: { icon: Heart, one: 'liked your post', many: 'liked your post' },
  comment: { icon: MessageCircle, one: 'commented on your post', many: 'commented on your post' },
  story_reply: { icon: MessageCircle, one: 'replied to your story', many: 'replied to your story' },
  mention: { icon: AtSign, one: 'tagged you', many: 'tagged you' },
  follow_request: { icon: UserPlus, one: 'asked to follow you', many: 'asked to follow you' },
  follow_accepted: { icon: UserPlus, one: 'accepted your follow request', many: 'accepted your follow request' },
  call: { icon: Phone, one: 'called you', many: 'called you' },
  ping_opened: { icon: Heart, one: 'opened your Ping', many: 'opened your Ping' },
};

/** Newest first within a group, groups ordered by their newest item. */
interface Row {
  kind: AppNotification['kind'];
  actorId: string | undefined;
  name: string;
  /** A sentence the server already wrote, used as is (a tag in a group names the group, not the person). */
  line?: string;
  others: number;
  at: number;
}

const SHOW_MS = 7000;
const MAX_ROWS = 3;

function group(items: AppNotification[], nameOf: (n: AppNotification) => string): Row[] {
  const by = new Map<string, AppNotification[]>();
  for (const item of items) {
    if (!KINDS[item.kind]) continue;
    by.set(item.kind, [...(by.get(item.kind) ?? []), item]);
  }
  return [...by.values()]
    .map((list) => {
      const newest = list.slice().sort((a, b) => b.createdAt - a.createdAt)[0]!;
      const people = new Set(list.map((n) => n.actorId ?? n.id));
      return {
        kind: newest.kind,
        actorId: newest.actorId,
        name: nameOf(newest),
        ...(newest.kind === 'mention' && newest.body ? { line: `${newest.body}${newest.title ? ` in ${newest.title}` : ''}` } : {}),
        others: people.size - 1,
        at: newest.createdAt,
      };
    })
    .sort((a, b) => b.at - a.at);
}

export function ActivityTopPop() {
  const { service, users, ready } = useChat();
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

  const rows = useMemo(
    () => (items ? group(items, (n) => users.find((u) => u.id === n.actorId)?.name ?? n.title) : []),
    [items, users],
  );

  useEffect(() => {
    if (!rows.length) return;
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
  }, [rows.length]);

  if (!rows.length) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;

  return (
    <div
      className={cn(
        'absolute right-0 top-full z-40 mt-2 w-[min(19rem,calc(100vw-1.5rem))] origin-top-right transition-[opacity,transform] duration-300 ease-out',
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1.5 opacity-0',
      )}
    >
      {/* The little notch, pointing up at the bell. */}
      <span aria-hidden className="absolute -top-1.5 right-4 size-3 rotate-45 rounded-[3px] border-l border-t border-line bg-surface" />
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          navigate('/notifications');
        }}
        className="relative block w-full rounded-2xl border border-line bg-surface p-1.5 text-left shadow-[0_14px_36px_-14px_rgb(0_0_0/0.28)] focus-ring"
      >
        {shown.map((row) => {
          const meta = KINDS[row.kind]!;
          const Icon = meta.icon;
          const actor = users.find((u) => u.id === row.actorId);
          return (
            <span key={row.kind} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
              <span className="relative shrink-0">
                <Avatar name={row.name} id={row.actorId ?? row.kind} src={actor?.avatarUrl} size="sm" />
                <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-surface text-brand ring-2 ring-surface">
                  <Icon size={9} strokeWidth={2.6} aria-hidden />
                </span>
              </span>
              <span className="min-w-0 flex-1 line-clamp-2 text-[13.5px] leading-snug text-text-secondary">
                {row.line ? (
                  <span className="text-ink">{row.line}</span>
                ) : (
                  <>
                    <span className="font-semibold text-ink">{row.name}</span>
                    {row.others > 0 ? ` and ${row.others} other${row.others === 1 ? '' : 's'}` : ''} {row.others > 0 ? meta.many : meta.one}
                  </>
                )}
              </span>
            </span>
          );
        })}
        {more > 0 && <span className="block px-2 pb-1 pt-0.5 text-[12px] text-text-tertiary">+{more} more in Activity</span>}
      </button>
    </div>
  );
}
