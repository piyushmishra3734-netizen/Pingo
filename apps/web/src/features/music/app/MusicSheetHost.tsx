import { Suspense, lazy } from 'react';

import { useMusicEverOpened } from './sheet-store.js';

/**
 * Where PINGO Music lives in the app shell.
 *
 * Nothing is loaded until somebody first opens it: the catalogue, the views
 * and the player screens are their own chunk, so the chat list pays nothing
 * for a feature many sessions never touch. Once opened it stays mounted, so
 * going back to it lands exactly where it was left.
 */
const MusicSheet = lazy(() => import('./MusicSheet.js'));

export function MusicSheetHost() {
  const ever = useMusicEverOpened();
  if (!ever) return null;
  return (
    <Suspense fallback={null}>
      <MusicSheet />
    </Suspense>
  );
}
