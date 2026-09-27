import { useChat, useProfile } from '@pingo/core';
import {
  Badge,
  BellIcon,
  CameraIcon,
  ChatIcon,
  GlassPanel,
  PhoneIcon,
  UserIcon,
  UsersIcon,
  cn,
} from '@pingo/ui';
import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { AiPill } from './AiPill.js';
import { useT } from '../features/i18n/useT.js';
import { useNotifications } from '../features/notifications/NotificationContext.js';
import { canAccessCommunities } from '../lib/community-access.js';

/**
 * The floating navigation dock - "Glass effect. Floating. Always accessible."
 *
 * Five destinations: Chats, Calls, Camera, then either Notifications or
 * Communities, then Profile. Camera sits in the middle because it is the one
 * *creating* action among four browsing ones - the same reason it is centred in
 * every camera-first product.
 *
 * Communities is allowlisted (see `canAccessCommunities`). Everyone else gets
 * Notifications in that slot, which used to live only on the chats header.
 *
 * Five is the ceiling. Settings is reached from the Chats header and from
 * Profile, not from here, because a dock that grows by one every time a feature
 * ships stops being glanceable.
 *
 * The active item is marked by a purple dot beneath the icon rather than a filled
 * pill: the brand element already means "here, now" everywhere else in the
 * product, so reusing it costs the user nothing to learn.
 *
 * It floats above content on every size - phone and desktop alike - which is what
 * keeps the two platforms feeling like one product.
 */

interface DockItem {
  to: string;
  label: string;
  Icon: typeof ChatIcon;
  /** Also match nested paths, so an open thread keeps Chats lit. */
  matchPrefix?: string;
}

export function Dock() {
  const t = useT();
  const { totalUnread } = useChat();
  const { profile } = useProfile();
  const { unread: unreadNotifications } = useNotifications();
  const communities = canAccessCommunities(profile?.username);

  const { pathname } = useLocation();
  const items = useMemo<DockItem[]>(
    () => [
      { to: '/chats', label: t('nav.chats'), Icon: ChatIcon, matchPrefix: '/chats' },
      { to: '/calls', label: t('nav.calls'), Icon: PhoneIcon },
      { to: '/camera', label: t('nav.camera'), Icon: CameraIcon },
      communities
        ? { to: '/communities', label: t('nav.communities'), Icon: UsersIcon }
        : { to: '/notifications', label: t('nav.activity'), Icon: BellIcon },
      { to: '/profile', label: t('nav.profile'), Icon: UserIcon, matchPrefix: '/profile' },
    ],
    [communities, t],
  );
  // Which tab the plate sits under.
  const active = items.findIndex(({ to, matchPrefix }) => (matchPrefix ? pathname.startsWith(matchPrefix) : pathname === to));

  return (
    <nav
      aria-label={t('nav.primary')}
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-200',
        // A column now: the dock, and the assistant's line under it.
        'flex flex-col items-center gap-1',
        // The dock clears the viewport edge, and the iOS home indicator.
        'px-3 pb-3',
        'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      )}
    >
      {/*
        Dock glow ~15% quieter than default `shadow-lg` brand haze - luxury
        chrome elevates without a purple halo. Layout and shape untouched.
      */}
      {/*
        One bar, five equal tabs, each an icon over its name - the shape iOS
        and Telegram settled on, because a label is what makes an icon row a
        map instead of a guessing game. Where you are is a soft plate that
        slides from tab to tab, not a dot; the camera is a tab like the others
        rather than a coloured key shouting over them.
      */}
      <GlassPanel
        className={cn(
          'glass-lit pointer-events-auto relative flex w-full max-w-[420px] items-stretch p-1.5',
          'rounded-[28px]',
          'shadow-[0_4px_12px_rgba(16,17,20,0.06),0_16px_40px_rgba(16,17,20,0.08)]',
        )}
      >
        {active >= 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-1.5 left-1.5 rounded-[22px] bg-brand/12 transition-transform duration-base ease-spring"
            style={{ width: `calc((100% - 12px) / ${items.length})`, transform: `translateX(${active * 100}%)` }}
          />
        )}
        {items.map(({ to, label, Icon, matchPrefix }) => (
          <NavLink
            key={to}
            to={to}
            end={!matchPrefix}
            className={({ isActive }) =>
              cn(
                'focus-ring glass-press relative flex h-[54px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[22px]',
                'transition-colors duration-quick',
                isActive ? 'text-brand' : 'text-text-secondary hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <Icon size={24} className={cn('transition-transform duration-base ease-spring', isActive && 'scale-105')} />
                  {/* Unread chats: a count, hidden while you are on Chats. */}
                  {to === '/chats' && !isActive && totalUnread > 0 && (
                    <Badge
                      count={totalUnread}
                      className="absolute -top-1.5 -right-2.5 h-4 min-w-4 px-1 text-[0.625rem] ring-2 ring-surface"
                      srSuffix="unread messages"
                    />
                  )}
                  {/* Unread activity: a dot on Activity, or on Profile when Communities has the slot. */}
                  {((to === '/notifications' && !isActive) || (to === '/profile' && communities)) && unreadNotifications > 0 && (
                    <span
                      className="bg-sweep absolute -top-0.5 -right-1 size-2.5 rounded-full ring-2 ring-surface"
                      aria-label={`${unreadNotifications} unread notifications`}
                    />
                  )}
                </span>
                <span className={cn('text-[10.5px] leading-none tracking-[0.01em]', isActive ? 'font-semibold' : 'font-medium')}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </GlassPanel>

      {/*
        Under the dock rather than in it.

        In it, it would be a sixth destination competing with five; under it, it
        is the same gesture both phones already put at the bottom of the screen -
        hold the line, the assistant comes up. It sits above the safe-area inset
        so it never argues with the system's own gesture bar.
      */}
      <div className="pointer-events-auto">
        <AiPill />
      </div>
    </nav>
  );
}
