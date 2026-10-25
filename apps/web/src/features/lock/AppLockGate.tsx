import { useAuth } from '@pingo/core';

import { PinGate } from './PinGate.js';
import { unlockApp, useAppLock } from './app-lock.js';

/**
 * The PINGO lock, standing in front of everything while it is shut.
 *
 * Mounted once, in the shell every signed-in screen renders inside. While the
 * lock is on and shut it draws the PIN pad over the whole window, above every
 * sheet, viewer and call screen, and it cannot be closed: the only ways past
 * are the PIN, or proving it is you again from "Forgot PIN?".
 */
export function AppLockGate() {
  const { session } = useAuth();
  const { locked } = useAppLock(session?.user.id);
  if (!locked) return null;
  return <PinGate mode="app" onSuccess={unlockApp} />;
}
