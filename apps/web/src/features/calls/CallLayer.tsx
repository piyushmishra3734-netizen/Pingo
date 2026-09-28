import { Suspense } from 'react';

import { lazyNamed } from '../../lib/lazy-named.js';
import { useCall } from './CallProvider.js';

const CallOverlay = lazyNamed(() => import('./CallOverlay.js'), 'CallOverlay');

/**
 * The call screen, fetched the first time there is something to show on it.
 *
 * It is drawn over everything and needed by nobody until a call rings, so it
 * no longer rides in the chunk every launch waits for. The same conditions
 * that make `CallOverlay` render anything at all decide when it is mounted.
 */
export function CallLayer() {
  const { call, error, failureNotice } = useCall();
  if (!call && !error && !failureNotice) return null;
  return (
    <Suspense fallback={null}>
      <CallOverlay />
    </Suspense>
  );
}
