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
import { NavLink } from 'react-router-dom';

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
  const { totalUnread } = useChat();
  const { profile } = useProfile();
  const { unread: unreadNotifications } = useNotifications();
  const communities = canAccessCommunities(profile?.username);

  const items = useMemo<DockItem[]>(
    () => [
      { to: '/chats', label: 'Chats', Icon: ChatIcon, matchPrefix: '/chats' },
      { to: '/calls', label: 'Calls', Icon: PhoneIcon },
      { to: '/camera', label: 'Camera', Icon: CameraIcon },
      communities
        ? { to: '/communities', label: 'Communities', Icon: UsersIcon }
        : { to: '/notifications', label: 'Notifications', Icon: BellIcon },
      { to: '/profile', label: 'Profile', Icon: UserIcon, matchPrefix: '/profile' },
    ],
    [communities],
  );

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-200',
        'flex justify-center',
        // The dock clears the viewport edge, and the iOS home indicator.
        'px-5 pb-5',
        'pb-[max(1.25rem,env(safe-area-inset-bottom))]',
      )}
    >
      <GlassPanel className="pointer-events-auto flex items-center gap-1 p-2">
        {items.map(({ to, label, Icon, matchPrefix }) => (
          <NavLink
            key={to}
            to={to}
            end={!matchPrefix}
            className={({ isActive }) =>
              cn(
                'relative grid size-12 place-items-center rounded-lg',
                /*
                  `glass-press` rather than a bare scale: the item compresses,
                  brightens along its lit edge and springs back, which is what
                  makes it read as a piece of the glass panel rather than a
                  button drawn on top of one.
                */
                'focus-ring glass-press',
                isActive
                  ? 'text-brand'
                  : 'text-text-secondary hover:bg-hover hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                {/*
                  Notifications gets a hair more weight optically: the bell's
                  silhouette is lighter than chat/camera, so without this it
                  reads as the cheap slot on the bar.
                */}
                <Icon
                  size={to === '/notifications' ? 27 : 26}
                  className={cn(
                    to === '/notifications' &&
                      (isActive ? 'text-brand drop-shadow-[0_0_10px_rgba(92,108,255,0.35)]' : undefined),
                  )}
                />
                <span className="sr-only">{label}</span>

                {/*
                  The brand dot as the active marker.

                  It used to cross-fade: the old dot faded out while the new one
                  faded in, so at the midpoint there were two half-dots and no
                  sense of having gone anywhere. Now it also *arrives* - dropping
                  the last couple of pixels into place and widening briefly, so
                  the eye is pulled to where you now are rather than being left
                  to notice which of two marks survived.

                  A single indicator sliding along the bar would be better still,
                  and needs the dock to measure its own items; this gets most of
                  the effect for none of that.
                */}
                <span
                  className={cn(
                    'absolute bottom-1.5 h-1 rounded-full bg-dot',
                    /*
                      Spring, so the indicator arrives with weight. It widens
                      past its resting size and settles, the way a bead of
                      liquid does when it stops moving.
                    */
                    'transition-[opacity,width,transform] duration-base ease-spring',
                    isActive
                      ? 'w-3.5 translate-y-0 opacity-100'
                      : 'w-1 translate-y-1 opacity-0',
                  )}
                  aria-hidden
                />

                {/*
                  Unread notifications sit on the Notifications tab when that
                  tab is in the dock. Allowlisted accounts keep Communities
                  there instead, so the dot still hangs off Profile for them
                  (and the chats-header bell remains as the open path).
                */}
                {to === '/notifications' && !isActive && unreadNotifications > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 size-2 rounded-full bg-dot shadow-[0_0_0_3px_rgba(139,93,255,0.18)] ring-2 ring-glass"
                    aria-label={`${unreadNotifications} unread notifications`}
                  />
                )}
                {to === '/profile' && communities && unreadNotifications > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 size-2 rounded-full bg-dot shadow-[0_0_0_3px_rgba(139,93,255,0.18)] ring-2 ring-glass"
                    aria-label={`${unreadNotifications} unread notifications`}
                  />
                )}

                {/*
                  Unread lives on Chats only. A count on a nav item the user is
                  already looking at is noise, so it hides while Chats is active.
                */}
                {to === '/chats' && !isActive && totalUnread > 0 && (
                  <Badge
                    count={totalUnread}
                    className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[0.625rem]"
                    srSuffix="unread messages"
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </GlassPanel>
    </nav>
  );
}
