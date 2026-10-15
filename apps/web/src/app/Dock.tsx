import { useChat } from '@pingo/core';
import { Badge, CameraIcon, ChatIcon, UserIcon, cn } from '@pingo/ui';
import { Music2, TvMinimalPlay } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import { AiPill } from './AiPill.js';
import { useT } from '../features/i18n/useT.js';
import { openMusic, preloadMusic } from '../features/music/app/sheet-store.js';

/**
 * The bottom bar: Chats, Music, Camera, Pingo TV, Profile.
 *
 * Camera is the raised pink circle in the middle - the one creating action
 * among four places to go. Music opens the music sheet over whatever is on
 * screen; Pingo TV has its own page (coming soon). Calls, Communities and
 * Activity moved to the Chats header (the bell and the ⋮ menu).
 */
export function Dock() {
  const t = useT();
  const { totalUnread } = useChat();
  const { pathname } = useLocation();

  const tab = (active: boolean) =>
    cn(
      'focus-ring flex h-[58px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl',
      'transition-colors duration-quick',
      active ? 'text-brand' : 'text-text-secondary hover:text-ink',
    );
  const label = (active: boolean) => cn('text-[11px] leading-none', active ? 'font-semibold' : 'font-medium');

  return (
    <nav
      aria-label={t('nav.primary')}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-200 flex flex-col items-center"
    >
      <div className="pointer-events-auto mb-1">
        <AiPill />
      </div>
      <div
        className={cn(
          'pointer-events-auto flex w-full items-end border-t border-line bg-page/95 px-2 backdrop-blur-xl',
          'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="mx-auto flex w-full max-w-[520px] items-end">
          <NavLink to="/chats" className={({ isActive }) => tab(isActive || pathname.startsWith('/chats'))}>
            {({ isActive }) => {
              const on = isActive || pathname.startsWith('/chats');
              return (
                <>
                  <span className="relative">
                    <ChatIcon size={25} className={on ? '[&_path]:fill-current' : undefined} />
                    {!on && totalUnread > 0 && (
                      <Badge
                        count={totalUnread}
                        className="absolute -top-1.5 -right-2.5 h-4 min-w-4 px-1 text-[0.625rem] ring-2 ring-page"
                        srSuffix="unread messages"
                      />
                    )}
                  </span>
                  <span className={label(on)}>{t('nav.chats')}</span>
                </>
              );
            }}
          </NavLink>

          <button type="button" onPointerDown={preloadMusic} onClick={openMusic} className={tab(false)}>
            <Music2 size={25} strokeWidth={1.9} aria-hidden />
            <span className={label(false)}>Music</span>
          </button>

          {/* The raised camera: a pink circle that sits above the bar's line. */}
          <NavLink to="/camera" aria-label={t('nav.camera')} className="focus-ring flex flex-1 flex-col items-center gap-1 rounded-2xl">
            {({ isActive }) => (
              <>
                <span className="-mt-7 grid size-[60px] place-items-center rounded-full bg-brand text-on-brand shadow-[0_8px_20px_-6px_var(--color-brand)] ring-4 ring-page transition-transform duration-base ease-spring active:scale-95">
                  <CameraIcon size={28} />
                </span>
                <span className={cn(label(isActive), isActive ? 'text-brand' : 'text-text-secondary')}>{t('nav.camera')}</span>
              </>
            )}
          </NavLink>

          <NavLink to="/tv" className={({ isActive }) => tab(isActive)}>
            {({ isActive }) => (
              <>
                <span className="relative">
                  <TvMinimalPlay size={25} strokeWidth={1.9} aria-hidden />
                  {/* New: Pingo TV is coming. */}
                  {!isActive && <span aria-label="New" className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-brand ring-2 ring-page" />}
                </span>
                <span className={label(isActive)}>Pingo TV</span>
              </>
            )}
          </NavLink>

          <NavLink to="/profile" className={({ isActive }) => tab(isActive || pathname.startsWith('/profile'))}>
            {({ isActive }) => {
              const on = isActive || pathname.startsWith('/profile');
              return (
                <>
                  <UserIcon size={25} />
                  <span className={label(on)}>{t('nav.profile')}</span>
                </>
              );
            }}
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
