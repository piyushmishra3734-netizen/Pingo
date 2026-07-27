import { PIN_LIMIT, useChat, type Conversation, type ConversationFlags } from '@pingo/core';
import { useCallback, useState } from 'react';

/**
 * Every mutation the chat list can perform, in one place.
 *
 * The list, the swipe gestures, the selection bar and the overflow menu all act
 * on the same set of things, and each of them wanting its own error handling and
 * its own pin-limit check is how four slightly different versions of a rule end
 * up in one screen. This owns the rule once.
 *
 * ## Nothing here is optimistic
 *
 * These are deliberate, one-off acts on a list the user is looking at, and the
 * service already pushes a `conversation:updated` the instant the write lands.
 * An optimistic archive that un-archives itself a moment later is worse than one
 * that takes a beat — the row would leave and come back, which reads as the app
 * having changed its mind.
 */

export interface ConversationActions {
  /** Non-null while something failed, for the caller to announce. */
  error: string | undefined;
  dismissError: () => void;
  busy: boolean;

  pin: (conversations: Conversation[], pinned: boolean) => Promise<void>;
  mute: (ids: string[], muted: boolean) => Promise<void>;
  favorite: (ids: string[], favorite: boolean) => Promise<void>;
  archive: (ids: string[], archived: boolean) => Promise<void>;
  markUnread: (ids: string[], unread: boolean) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  clear: (ids: string[]) => Promise<void>;
}

export function useConversationActions(): ConversationActions {
  const { service, conversations } = useChat();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /*
   * One wrapper for every call, so no action can forget to report its own
   * failure. A silent catch here would mean an archive that did nothing and
   * said nothing, which is the failure mode hardest to notice.
   */
  const run = useCallback(async (what: string, work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch {
      setError(`${what} didn't work. Try again.`);
    } finally {
      setBusy(false);
    }
  }, []);

  const flags = useCallback(
    (what: string, ids: string[], patch: ConversationFlags) =>
      run(what, () => service.setConversationFlags(ids, patch)),
    [run, service],
  );

  const pin = useCallback(
    async (targets: Conversation[], pinned: boolean) => {
      if (!pinned) {
        await flags('Unpinning', targets.map((c) => c.id), { pinned: false });
        return;
      }

      /*
       * The cap counts what is already pinned *plus* what this call would add,
       * and it is checked here rather than in the database on purpose: the
       * useful response is a sentence explaining the limit, and a constraint
       * violation cannot say which chats it refused or why.
       */
      const alreadyPinned = conversations.filter((c) => c.pinned && !c.archived);
      const adding = targets.filter((c) => !c.pinned);
      if (alreadyPinned.length + adding.length > PIN_LIMIT) {
        setError(`You can pin ${PIN_LIMIT} chats. Unpin one first.`);
        return;
      }

      await flags('Pinning', adding.map((c) => c.id), { pinned: true });
    },
    [flags, conversations],
  );

  return {
    error,
    dismissError: useCallback(() => setError(undefined), []),
    busy,
    pin,
    mute: useCallback(
      (ids, muted) => flags(muted ? 'Muting' : 'Unmuting', ids, { muted }),
      [flags],
    ),
    favorite: useCallback(
      (ids, favorite) => flags('Updating favourites', ids, { favorite }),
      [flags],
    ),
    archive: useCallback(
      (ids, archived) => flags(archived ? 'Archiving' : 'Unarchiving', ids, { archived }),
      [flags],
    ),
    markUnread: useCallback(
      (ids, unread) => flags('Updating', ids, { unread }),
      [flags],
    ),
    remove: useCallback(
      (ids) => run('Deleting', () => service.deleteConversations(ids)),
      [run, service],
    ),
    clear: useCallback(
      (ids) => run('Clearing', () => service.clearConversations(ids)),
      [run, service],
    ),
  };
}
