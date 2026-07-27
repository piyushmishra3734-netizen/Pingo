import { useCallback } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';

/**
 * Turning notifications back on, with the question in front of it.
 *
 * Three surfaces offer unmute — the thread's `⋯`, the chat list's selection
 * menu, and a person's profile — and all three used to do it on the tap. The
 * hook exists so all three ask the same question in the same words, because a
 * confirmation that is worded differently in different places reads as a
 * different question and stops being one people trust.
 *
 * ## Why unmuting asks at all
 *
 * It does not destroy anything, which is the usual test. But a mute is a thing
 * somebody set on purpose and often forgot about, and undoing it silently means
 * the next message arrives with a sound in a room where that was the whole
 * point of muting. The question is the reminder that something is about to
 * start making noise again.
 *
 * The copy says what will happen rather than asking whether they are sure —
 * "this chat can notify you again" is the fact; "are you sure" is not.
 */
export function useUnmuteConfirm(): (count: number, name?: string) => Promise<boolean> {
  const confirm = useConfirm();

  return useCallback(
    (count, name) =>
      confirm({
        title:
          count === 1
            ? `Unmute ${name ?? 'this chat'}?`
            : `Unmute ${count} chats?`,
        description:
          count === 1
            ? 'It can notify you again, starting with the next message.'
            : 'They can notify you again, starting with their next messages.',
        // Not destructive, so it is not the red button.
        tone: 'normal',
        confirmLabel: 'Unmute',
      }),
    [confirm],
  );
}
