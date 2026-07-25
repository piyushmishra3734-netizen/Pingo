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
          !threadIsFullscreen && 'pb-[6.5rem]',
        )}
      >
        <Outlet />
      </main>

      {!threadIsFullscreen && <Dock />}
    </div>
  );
}
