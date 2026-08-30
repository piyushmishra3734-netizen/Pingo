import { useEffect } from 'react';
import { useChat } from '@pingo/core';
import { LoadingState, cn } from '@pingo/ui';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';

import { Dock } from './Dock.js';
import { ConnectionBanner } from '../features/connection/ConnectionBanner.js';
import { useT } from '../features/i18n/useT.js';
import { useIsDesktop } from '../hooks/useMediaQuery.js';
import { useIncomingShare } from '../features/share/useIncomingShare.js';
import { startLensing } from '../features/glass/lens.js';
import { redeemHeldReferral } from '../features/referrals/referrals-service.js';
import { doneAddingAccount } from '../features/auth/adding-account.js';
import { useLiveOnResume } from '../features/notifications/useLiveOnResume.js';
import { usePushTapRouting } from '../features/notifications/usePushTapRouting.js';

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
  const t = useT();
  // A share can start the app, so it is listened for above every screen -
  // see the note in useIncomingShare.
  useIncomingShare();

  /*
   * A referral that did not get recorded when the account was created.
   *
   * The signup path calls this already; this is the second chance, for the
   * person who opened the link, abandoned signup halfway and came back a day
   * later, or whose connection dropped at exactly the wrong moment. It is one
   * call per launch, and `redeemHeldReferral` returns immediately when there is
   * no code waiting - which is every launch for almost everybody.
   */
  useEffect(() => {
    void redeemHeldReferral().catch(() => undefined);
  }, []);

  /*
   * The refracting rim on every glass surface. Started once, above every
   * screen: glass is applied by a class from the stylesheet, so nothing in
   * React knows which elements have it.
   */
  useEffect(() => startLensing(), []);

  /*
   * Whatever they were in the middle of, they are inside the app now.
   *
   * This shell only mounts behind the session gate, so reaching it means the
   * add-an-account journey has either finished or been abandoned. Left set, the
   * flag would keep `RequireGuest` open on Welcome for the rest of the tab.
   */
  useEffect(() => doneAddingAccount(), []);

  /*
   * Two things that only make sense above every screen: a tap on a
   * notification has to be able to reach any thread, and coming back from the
   * background has to make the app live again wherever it was left.
   */
  usePushTapRouting();
  useLiveOnResume();

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

  /**
   * Which screens are allowed the whole window.
   *
   * Only the ones whose content genuinely is the width: the chat list beside a
   * thread, and the viewfinder. Everything else is a list of rows, and a row of
   * one word with its chevron fifteen hundred pixels away is not a layout, it
   * is the absence of one. On Appearance it was worse than untidy - the glass
   * slider became a saturated block the full width of the display, which made a
   * *setting* the loudest thing on the screen.
   *
   * Done here rather than in each screen because there are thirteen of them and
   * this is the kind of rule that is remembered for the first eight. Phones are
   * untouched: the cap is above any phone width, so it only ever engages on a
   * desktop window.
   */
  const wide = fullscreen || /^\/(chats|camera)(\/|$)/.test(location.pathname);

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
   *
   * Read here, above the `!ready` return, and that placement is not tidiness.
   * It sat below it, so it ran on every render where the shell was ready and on
   * none of the renders before - the hook count changed the instant the app
   * finished opening, and React answered with #310 and a blank screen. It was
   * invisible locally because a warm load is ready on the first render.
   */
  const back = useNavigationType() === 'POP';

  if (!ready) {
    return (
      <div className="grid h-full place-items-center bg-page">
        <LoadingState label={t('common.opening')} />
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
  return (
    <div className="flex h-full flex-col bg-page">
      {/*
        Above every screen, because losing the network is not a property of the
        one you happen to be on.
      */}
      <ConnectionBanner />

      <main
        className={cn(
          'min-h-0 flex-1',
          // Clears the floating dock: its height, the assistant's line under
          // it, and the gap they leave below.
          !fullscreen && 'pb-[8rem]',
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
          className={cn(
            'h-full',
            !wide && 'mx-auto w-full max-w-2xl',
            back ? 'animate-screen-back' : 'animate-screen-in',
          )}
        >
          <Outlet />
        </div>
      </main>

      {!fullscreen && <Dock />}
    </div>
  );
}
