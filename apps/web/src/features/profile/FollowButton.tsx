import { useProfile, type FollowState } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';

/**
 * The friend control, and the only place a friendship state changes.
 *
 * ## One state, one button
 *
 * `FollowState` is a single value rather than a set of booleans precisely so
 * this component can be a lookup rather than a pile of conditions. Every screen
 * asking "what do I show?" gets the same answer.
 *
 * | State | Button | What it means |
 * | --- | --- | --- |
 * | `none` | Add friend | nothing between you |
 * | `requested` | Requested | waiting on them |
 * | `incoming` | Accept | waiting on you — Accept makes you friends |
 * | `following` | Requested | legacy one-way (heal on next accept path) |
 * | `follower` | Add back | legacy one-way; rare after accept-both-ways |
 * | `mutual` | Friends | calls, Pings and stories are open |
 *
 * ## Why it says "friend" rather than "follow"
 *
 * Under the hood there are still two follow rows (both accepted once friends),
 * but the product is not a follow graph: one person sends a request, the other
 * accepts, and they are friends. No second "Add back" step.
 */
export function FollowButton({
  userId,
  name,
  onChange,
  className,
}: {
  userId: string;
  /** Used in the confirmation when a friendship is about to end. */
  name?: string;
  onChange?: (state: FollowState) => void;
  className?: string;
}) {
  const { service } = useProfile();
  const confirm = useConfirm();
  const [state, setState] = useState<FollowState>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void service
      .followState(userId)
      .then((next) => {
        if (active) {
          setState(next);
          onChange?.(next);
        }
      })
      .catch(() => {
        if (active) setState('none');
      });
    return () => {
      active = false;
    };
    // `onChange` is deliberately not a dependency: callers pass an inline
    // function, and depending on it would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, userId]);

  const run = async (action: () => Promise<FollowState>) => {
    setBusy(true);
    try {
      const next = await action();
      setState(next);
      onChange?.(next);
    } catch {
      // Leaves the button as it was. A follow that silently *looks* applied is
      // worse than one that visibly did not take.
    } finally {
      setBusy(false);
    }
  };

  if (state === undefined) {
    return <span className={cn('h-9 w-24 animate-pulse rounded-full bg-hover', className)} />;
  }

  const label =
    state === 'none'
      ? 'Add friend'
      : state === 'requested' || state === 'following'
        ? 'Requested'
        : state === 'incoming'
          ? 'Accept'
          : state === 'follower'
            ? 'Add back'
            : 'Friends';

  const primary = state === 'none' || state === 'incoming' || state === 'follower';

  const onClick = () =>
    void (async () => {
      /*
       * Only ending a friendship asks. Withdrawing a request you sent is
       * undoing your own action a moment later, and adding somebody is not
       * destructive at all - a dialog on either would be the kind of noise
       * that trains people to tap through the one that matters.
       */
      if (state === 'mutual') {
        const go = await confirm({
          title: `Remove ${name ?? 'this person'} as a friend?`,
          description:
            'Calls, Pings and stories close between you. You can still message each other, and either of you can ask again.',
          confirmLabel: 'Remove friend',
        });
        if (!go) return;
      }

      await run(() => {
        if (state === 'incoming') return service.acceptFollow(userId);
        if (state === 'none' || state === 'follower') return service.requestFollow(userId);
        // Requested, following, mutual - all undo to the same thing.
        return service.removeFollow(userId);
      });
    })();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'focus-ring rounded-full px-5 py-2 text-caption font-medium',
        'transition-transform duration-instant ease-standard active:scale-[0.96]',
        primary
          ? 'bg-brand-gradient text-white shadow-brand'
          : 'bg-surface text-ink shadow-sm',
        busy && 'opacity-60',
        className,
      )}
    >
      {label}
    </button>
  );
}
