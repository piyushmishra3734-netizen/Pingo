import { useChat } from '@pingo/core';
import { LoadingState, cn } from '@pingo/ui';
import { Outlet, useLocation } from 'react-router-dom';

import { Dock } from './Dock.js';
import { useIsDesktop } from '../hooks/useMediaQuery.js';

/**
 * The shell every signed-in screen renders inside.
 *
 * Two responsibilities, both about not making each screen solve them again:
 *
 *   1. It holds the session gate. Screens can assume `currentUser` exists, which
 *      removes a loading branch from every one of them.
 *   2. It owns the bottom inset for the floating dock. A screen that scrolls
 *      would otherwise end with its last row trapped under the glass — so the
 *      padding is applied here, once.
 *
 * An open chat thread on a phone is the one exception: it manages its own bottom
 * edge, because the composer must sit against the keyboard with the dock hidden.
 */
export function AppShell() {
  const { ready } = useChat();
  const location = useLocation();
  const isDesktop = useIsDesktop();

  // On a phone, an open thread takes the whole screen: the composer replaces the
  // dock rather than stacking above it. On desktop both are visible at once.
  const threadIsFullscreen =
    !isDesktop && /^\/chats\/[^/]+$/.test(location.pathname);

  /*
   * The camera takes the whole screen everywhere, phone and desktop alike.
   *
   * A viewfinder with a navigation bar across it is a viewfinder you are
   * composing around. It also has its own way out, so the dock would be a
   * second exit competing with the one already on screen.
   */
  const cameraIsFullscreen = location.pathname === '/camera';
  const fullscreen = threadIsFullscreen || cameraIsFullscreen;

  if (!ready) {
    return (
      <div className="grid h-full place-items-center bg-page">
        <LoadingState label="Opening PINGO" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-page">
      <main
        className={cn(
          'min-h-0 flex-1',
          // Clears the floating dock: its height plus the gap it leaves below.
          !fullscreen && 'pb-[6.5rem]',
        )}
      >
        {/*
          Keyed on the path, so React remounts the subtree and the animation
          replays on every navigation. Without the key it would run once, on
          first mount, and never again — which is what "no animation anywhere"
          actually looks like.

          The dock is deliberately outside: a navigation bar that fades on every
          tap draws attention to itself rather than to what changed.
        */}
        <div key={location.pathname} className="h-full animate-screen-in">
          <Outlet />
        </div>
      </main>

      {!fullscreen && <Dock />}
    </div>
  );
}
