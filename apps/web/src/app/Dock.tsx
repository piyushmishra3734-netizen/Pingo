import { useChat } from '@pingo/core';
import {
  Badge,
  CameraIcon,
  ChatIcon,
  GlassPanel,
  PhoneIcon,
  UserIcon,
  UsersIcon,
  cn,
} from '@pingo/ui';

import { NavLink } from 'react-router-dom';

import { useNotifications } from '../features/notifications/NotificationContext.js';

/**
 * The floating navigation dock — "Glass effect. Floating. Always accessible."
 *
 * Five destinations: Chats, Calls, Camera, Communities, Profile. Camera sits in
 * the middle because it is the one *creating* action among four browsing ones —
 * the same reason it is centred in every camera-first product.
 *
 * Five is the ceiling. Settings is reached from the Chats header and from
 * Profile, not from here, because a dock that grows by one every time a feature
 * ships stops being glanceable.
 *
 * The active item is marked by a purple dot beneath the icon rather than a filled
 * pill: the brand element already means "here, now" everywhere else in the
 * product, so reusing it costs the user nothing to learn.
 *
 * It floats above content on every size — phone and desktop alike — which is what
 * keeps the two platforms feeling like one product.
 */

interface DockItem {
  to: string;
  label: string;
  Icon: typeof ChatIcon;
  /** Also match nested paths, so an open thread keeps Chats lit. */
  matchPrefix?: string;
}

const ITEMS: DockItem[] = [
  { to: '/chats', label: 'Chats', Icon: ChatIcon, matchPrefix: '/chats' },
  { to: '/calls', label: 'Calls', Icon: PhoneIcon },
  { to: '/camera', label: 'Camera', Icon: CameraIcon },
  { to: '/communities', label: 'Communities', Icon: UsersIcon },
  { to: '/profile', label: 'Profile', Icon: UserIcon, matchPrefix: '/profile' },
];

export function Dock() {
  const { totalUnread } = useChat();
  const { unread: unreadNotifications } = useNotifications();

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
        {ITEMS.map(({ to, label, Icon, matchPrefix }) => (
          <NavLink
            key={to}
            to={to}
            end={!matchPrefix}
            className={({ isActive }) =>
              cn(
                'relative grid size-12 place-items-center rounded-lg',
                /*
                  Transform was missing from the transition list, so the press
                  scale snapped to 0.96 and back with no easing at all — the
                  one control in the app that is pressed on every navigation.
                */
                'focus-ring ease-standard',
                'transition-[color,background-color,transform] duration-quick',
                'active:scale-[0.92]',
                isActive
                  ? 'text-brand'
                  : 'text-text-secondary hover:bg-hover hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={26} />
                <span className="sr-only">{label}</span>

                {/*
                  The brand dot as the active marker.

                  It used to cross-fade: the old dot faded out while the new one
                  faded in, so at the midpoint there were two half-dots and no
                  sense of having gone anywhere. Now it also *arrives* — dropping
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
                    'transition-[opacity,width,transform] duration-base ease-standard',
                    isActive
                      ? 'w-3.5 translate-y-0 opacity-100'
                      : 'w-1 translate-y-1 opacity-0',
                  )}
                  aria-hidden
                />

                {/*
                  Notifications hang off Profile, and the dock is the one thing
                  on screen everywhere — which is the point. A dot rather than a
                  count: the number is on the screen it leads to, and two
                  numbers side by side on one bar is a scoreboard.
                */}
                {to === '/profile' && unreadNotifications > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand ring-2 ring-glass"
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
