import { cn } from '@pingo/ui';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { Sheet, SheetCancel } from './Sheet.js';

/**
 * "Are you sure?", once, for the whole product.
 *
 * ## Why a provider and not a component
 *
 * A confirmation is a question in the middle of a function, not a thing on a
 * page. Written as a component, every caller needs a piece of state, a pending
 * value to remember *what* was being deleted, two handlers, and a branch in its
 * JSX - perhaps fifteen lines to ask one question. Six callers means six
 * slightly different dialogs, and the seventh forgets entirely.
 *
 * As a promise it is the shape the code already has:
 *
 * ```ts
 * if (!(await confirm({ title: 'Log out?', confirmLabel: 'Log out' }))) return;
 * await signOut();
 * ```
 *
 * The guard reads in the order it happens, the destructive call stays exactly
 * where it was, and there is one dialog in the product rather than six.
 *
 * ## What it is for, and what it is not
 *
 * Anything that destroys something the user has - messages, posts, comments,
 * a photo, a friendship, their session - and the handful of reversible acts
 * that still change how the app behaves towards a person: unmuting a chat, and
 * unblocking someone. Those two get `tone: 'normal'` rather than the red
 * button, because they are decisions rather than losses.
 *
 * Not for the ordinary ones. Pin, favourite, archive and mark-as-read are all a
 * single tap to undo, and a product that asks twice about everything teaches
 * people to confirm without reading - which is how the important question gets
 * waved through too.
 *
 * ## Why cancelling resolves rather than rejects
 *
 * A rejection would make every call site need a `try`/`catch` to handle the
 * ordinary case of somebody changing their mind. `false` is not an error.
 */

export interface ConfirmOptions {
  /** The question. Names the thing, e.g. "Delete this message?" */
  title: string;
  /** What actually happens. Say the consequence, not "This cannot be undone." */
  description?: string;
  /** The button. Never "OK" - it says the action, so it can be read at a glance. */
  confirmLabel: string;
  /** `danger` is red and the default; `normal` for a heavy but harmless choice. */
  tone?: 'danger' | 'normal';
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | undefined>(undefined);

interface Pending {
  options: ConfirmOptions;
  settle: (answer: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | undefined>();

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((previous) => {
          /*
           * A second question while one is open answers the first with "no".
           * Without this the earlier promise never settles, and whatever was
           * awaiting it is stuck forever - a leak that only shows up as a
           * button that stopped responding.
           */
          previous?.settle(false);
          return { options, settle: resolve };
        });
      }),
    [],
  );

  const answer = useCallback((value: boolean) => {
    setPending((current) => {
      current?.settle(value);
      return undefined;
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      {pending && (
        <Sheet
          title={pending.options.title}
          description={pending.options.description}
          // Above the post viewer, the photo viewer and a live call, because a
          // confirmation is asked from inside all three.
          elevated
          // Escape and the scrim both mean "no", which is the safe answer.
          onClose={() => answer(false)}
        >
          <div className="mt-4 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => answer(true)}
              className={cn(
                'focus-ring w-full rounded-full px-5 py-3 text-body font-medium',
                'transition-transform duration-instant active:scale-[0.98]',
                pending.options.tone === 'normal'
                  ? 'bg-brand-gradient text-on-brand shadow-brand'
                  : 'bg-danger text-on-brand shadow-sm',
              )}
            >
              {pending.options.confirmLabel}
            </button>
            <SheetCancel onClick={() => answer(false)} />
          </div>
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Asks the user before doing something they cannot take back.
 *
 * Resolves `true` to go ahead and `false` for cancel, Escape, or a tap on the
 * scrim. Never rejects.
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside a <ConfirmProvider>');
  return confirm;
}
