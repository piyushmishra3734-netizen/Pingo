/**
 * Saved accounts, for one-tap switching.
 *
 * Supabase keeps exactly one session, under `pingo.auth.session`. Switching
 * accounts therefore means keeping the others somewhere of our own and putting
 * the chosen one back into that slot — which is all this file does.
 *
 * ## What is stored, and the honest cost
 *
 * A saved account holds a refresh token. That is the same class of secret the
 * app already keeps for the signed-in account, so this is not a new *kind* of
 * exposure — but it is five times as much of it. Somebody with the device and
 * an unlocked browser can reach every saved account, not just the current one.
 *
 * That is the trade every app with account switching makes, and it is worth
 * writing down rather than discovering later. `forget()` exists so a person can
 * take an account off a device without signing out of it everywhere.
 *
 * ## Why it does not touch the keys
 *
 * Each account's E2EE identity is parked and restored by `switchAccount` in
 * `crypto/session.ts`, keyed by user id. Switching is therefore lossless: the
 * account you come back to still has the private key its messages were
 * encrypted to. That behaviour was a bug fix before it was a feature, and it is
 * what makes this safe to build on.
 */

const KEY = 'pingo.accounts';

/**
 * Five, as asked, and the number is a product decision rather than a technical
 * limit. Past a handful the list stops being a row of faces you recognise and
 * becomes a menu you have to read.
 */
export const MAX_ACCOUNTS = 5;

export interface SavedAccount {
  userId: string;
  /** Shown in the list. Refreshed on each save so a rename does not stick. */
  name: string;
  handle: string;
  avatarUrl?: string;
  /** What `setSession` needs. */
  accessToken: string;
  refreshToken: string;
  savedAt: number;
}

function read(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedAccount[]) : [];
  } catch {
    // A corrupted list must not be able to lock somebody out of their app.
    return [];
  }
}

function write(accounts: SavedAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(accounts.slice(0, MAX_ACCOUNTS)));
  } catch {
    /* storage full or blocked; switching degrades, nothing breaks */
  }
}

export function savedAccounts(): SavedAccount[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Records the account that is signed in now.
 *
 * Called on every successful sign-in and whenever the session refreshes, so
 * the stored token stays usable — a saved account whose refresh token has
 * expired is a face in a list that fails when tapped, which is worse than not
 * offering it.
 */
export function remember(account: Omit<SavedAccount, 'savedAt'>): void {
  const others = read().filter((a) => a.userId !== account.userId);

  // The current account is never the one dropped when the list is full: it is
  // by definition the one in use.
  const next = [{ ...account, savedAt: Date.now() }, ...others].slice(0, MAX_ACCOUNTS);
  write(next);
}

export function forget(userId: string): void {
  write(read().filter((a) => a.userId !== userId));
}

export function isFull(): boolean {
  return read().length >= MAX_ACCOUNTS;
}

/** The saved entry for an account, if this device has one. */
export function savedAccount(userId: string): SavedAccount | undefined {
  return read().find((a) => a.userId === userId);
}
