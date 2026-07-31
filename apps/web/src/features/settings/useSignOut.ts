import { useAuth } from '@pingo/core';
import { useCallback } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';

/**
 * Logging out, with the question in front of it.
 *
 * Two screens offer it - Settings and Account - and both used to sign out on
 * the tap. It sits in a list of navigation rows on one of them, which is the
 * worst possible place for an action that ends the session: a thumb reaching
 * for "Help" lands one row away.
 *
 * The hook exists so both ask the same question in the same words. Duplicating
 * the copy is how one of them ends up saying something slightly different, and
 * a confirmation that is not word-for-word identical is one people start
 * reading as a different question.
 *
 * ## What it says, and what it does not
 *
 * It names what is kept, not what is lost. "Your chats stay on this device" is
 * the fact somebody hesitating actually wants, and it is true - messages live
 * on the server and come back on the next sign-in. A warning about losing
 * things would be both frightening and wrong.
 */
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  const confirm = useConfirm();

  return useCallback(async () => {
    const go = await confirm({
      title: 'Log out of PINGO?',
      description:
        'Your chats stay where they are - you will need to sign in again to reach them.',
      confirmLabel: 'Log out',
    });
    if (!go) return;
    await signOut();
  }, [confirm, signOut]);
}
