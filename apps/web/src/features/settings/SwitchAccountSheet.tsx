import { Avatar, Button } from '@pingo/ui';
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import type { SavedAccountSummary } from '@pingo/core';

import { MAX_ACCOUNTS } from '../../lib/supabase/accounts.js';

/**
 * Switching accounts, in one tap.
 *
 * The whole value of this is that it is fast and certain — a list of faces,
 * tap one, you are them. Anything that makes it feel like signing in again
 * defeats the point, so there is no confirmation step on switching: it is
 * reversible by tapping the previous face, which is a better safety net than a
 * dialog nobody reads.
 *
 * Removing an account *does* confirm, because that one is not reversible from
 * here — it needs a full sign-in to undo.
 */
export interface SwitchAccountSheetProps {
  onClose: () => void;
  currentUserId: string | undefined;
  /** Summaries only — refresh tokens never reach a component. */
  accounts: SavedAccountSummary[];
  onSwitch: (userId: string) => Promise<void>;
  onForget: (userId: string) => void;
  onAddAccount: () => void;
}

export function SwitchAccountSheet({
  onClose,
  currentUserId,
  accounts,
  onSwitch,
  onForget,
  onAddAccount,
}: SwitchAccountSheetProps) {
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const full = accounts.length >= MAX_ACCOUNTS;

  return (
    <Sheet onClose={onClose} title="Switch account">
      <div className="flex flex-col gap-1 pb-2">
        {accounts.length === 0 && (
          <p className="px-3 py-6 text-center text-caption text-text-secondary">
            No other accounts saved on this device yet.
          </p>
        )}

        {accounts.map((account) => {
          const isCurrent = account.userId === currentUserId;
          return (
            <div
              key={account.userId}
              className="flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-surface-2"
            >
              <button
                type="button"
                disabled={isCurrent || Boolean(busy)}
                className="flex flex-1 items-center gap-3 text-left disabled:opacity-100"
                onClick={() => {
                  void (async () => {
                    setBusy(account.userId);
                    setError(undefined);
                    try {
                      await onSwitch(account.userId);
                    } catch {
                      /*
                       * The stored refresh token was rejected. The account has
                       * already been dropped from the list by the service, so
                       * say what happened rather than leaving a row that fails
                       * silently every time it is tapped.
                       */
                      setError(`Signing in as ${account.name} failed. Please add it again.`);
                      setBusy(undefined);
                    }
                  })();
                }}
              >
                <Avatar name={account.name} id={account.userId} src={account.avatarUrl} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body">{account.name}</span>
                  {account.handle && (
                    <span className="block truncate text-caption text-text-secondary">
                      {account.handle}
                    </span>
                  )}
                </span>
                {isCurrent && <span className="text-caption text-text-secondary">Current</span>}
                {busy === account.userId && (
                  <span className="text-caption text-text-secondary">Switching…</span>
                )}
              </button>

              {!isCurrent && (
                <button
                  type="button"
                  aria-label={`Remove ${account.name}`}
                  className="shrink-0 rounded-full px-2 py-1 text-caption text-text-secondary hover:text-danger"
                  onClick={() => onForget(account.userId)}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}

        {error && (
          <p role="alert" className="px-3 py-2 text-caption text-danger">
            {error}
          </p>
        )}

        <div className="px-3 pt-2">
          <Button variant="secondary" size="lg" block disabled={full} onClick={onAddAccount}>
            {full ? `Limit reached — ${MAX_ACCOUNTS} accounts` : 'Add account'}
          </Button>
          {full && (
            <p className="pt-2 text-center text-caption text-text-secondary">
              Remove one to add another.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
