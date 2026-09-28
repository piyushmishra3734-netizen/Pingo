import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { checkForNewBuild, newBuildWaiting } from '../lib/sw-refresh.js';

/**
 * Moves to a new screen as a full page load when a newer build is live.
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
    if (newBuildWaiting()) {
      // Replace, not assign: the router already added this entry to history.
      window.location.replace(`${location.pathname}${location.search}${location.hash}`);
      return;
    }
    checkForNewBuild();
  }, [location.key, location.pathname, location.search, location.hash]);
  return null;
}
