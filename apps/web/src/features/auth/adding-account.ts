/**
 * "I am adding a second account", held for as long as that takes.
 *
 * `RequireGuest` sends a signed-in visitor to `/chats`, which is right
 * everywhere except one journey: Settings → Switch account → Add account,
 * where being signed in is the premise rather than a mistake. That exception
 * was carried in the URL as `?add=1`.
 *
 * A query string only survives the screen it is on. Welcome hands off to
 * `/login` or `/signup`, neither of which carries it, so the guard fired on the
 * very next tap and returned the person to the account they were trying to add
 * one alongside - which is exactly the reported "it goes back to the same
 * account".
 *
 * `sessionStorage` is the right shape for it: the intent belongs to this tab
 * and this attempt, it survives every navigation within the flow, and it is
 * gone if the tab is closed. Nothing here is a secret - it is a boolean about
 * what the person is in the middle of doing.
 */

const KEY = 'pingo:adding-account';

export function beginAddingAccount(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Private mode with storage blocked. The `?add=1` fallback still gets them
    // through Welcome, which is where the button lands.
  }
}

export function isAddingAccount(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Called once the person is inside the app again.
 *
 * Whether they finished adding an account or backed out, they are no longer in
 * the middle of it - and a flag left set would keep the guard open on Welcome
 * for the rest of the tab's life.
 */
export function doneAddingAccount(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
