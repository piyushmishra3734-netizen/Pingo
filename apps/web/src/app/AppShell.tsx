import { useChat } from '@pingo/core';
import { LoadingState, cn } from '@pingo/ui';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';

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
 *      would otherwise end with its last row trapped under the glass - so the
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

  /**
   * The screen a path belongs to, ignoring what is open *within* it.
   *
   * `/chats` and `/chats/:id` are one screen - the list and a thread are two
   * views of the same place, and on desktop they are literally on screen
   * together. Everything else keys on its first segment, so moving between
   * tabs still animates.
   */
  function screenKey(pathname: string): string {
    return pathname.split('/')[1] ?? '';
  }

  /*
   * Which way the screen should travel.
   *
   * Every navigation used to animate identically, which is what made moving
   * around feel like a page reloading rather than a stack being pushed. The
   * direction is the whole point: going deeper should come from the right and
   * coming back from the left, so the motion agrees with the gesture that
   * caused it. When it does not, the app feels like it is guessing.
   *
   * `navigationType` is what the router already knows - POP is the back button
   * or a swipe back, PUSH and REPLACE are going somewhere. No history stack of
   * our own to keep in sync, which is the usual way this goes wrong.
   */
  const back = useNavigationType() === 'POP';

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
          Keyed on the *screen*, so React remounts the subtree and the animation
          replays when you move between screens. Without a key it would run once
          on first mount and never again, which is what "no animation anywhere"
          actually looks like.

          Keying on the full path was too fine. Opening a second chat changed
          the key, so the whole thread - header, scroller, composer - was torn
          down and rebuilt, replaying the screen animation and re-running every
          load. It read as the app reloading itself just to move one row over.
          Switching conversations is a change of *content*, and the thread
          already handles that: it reloads its own messages and resets its own
          scroll when the id changes.

          The dock is deliberately outside: a navigation bar that fades on every
          tap draws attention to itself rather than to what changed.
        */}
        <div
          key={screenKey(location.pathname)}
          className={cn('h-full', back ? 'animate-screen-back' : 'animate-screen-in')}
        >
          <Outlet />
        </div>
      </main>

      {!fullscreen && <Dock />}
    </div>
  );
}
