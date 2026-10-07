import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { checkForNewBuild } from '../lib/sw-refresh.js';

/**
 * Notes a newer build on navigation. It used to reload into it; see below.
 *
 * After a deploy the files the running build would fetch for its next screen
 * no longer exist, and opening one ended on "That screen did not open".
 * Loading that same screen fresh fetches the new build instead - one ordinary
 * page load, at the moment somebody was changing screens anyway.
 */
export function NewBuildNavigation() {
  const location = useLocation();
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    /*
     * No longer a full page load. That put the splash in front of people on
     * every screen change after a deploy, several times a day; the old build's
     * files now ship with the new one for three days (keep-old-assets.mjs), so
     * the running build simply keeps working and the new one arrives on the
     * next launch. RouteBoundary is still there if a file is truly gone.
     */
    checkForNewBuild();
  }, [location.key, location.pathname, location.search, location.hash]);
  return null;
}
