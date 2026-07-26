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
                'focus-ring transition-colors duration-instant ease-standard',
                'active:scale-[0.96]',
                isActive
                  ? 'text-brand'
                  : 'text-text-secondary hover:bg-hover hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={24} />
                <span className="sr-only">{label}</span>

                {/* The brand dot as the active marker. */}
                <span
                  className={cn(
                    'absolute bottom-1.5 size-1 rounded-full bg-dot',
                    'transition-opacity duration-quick ease-standard',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden
                />

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
