/**
 * The "this account is suspended" state, on the app's side.
 *
 * When the operator bans an account (Supabase `auth.users.banned_until`), every
 * sign-in and every token refresh for it is refused with HTTP 403 and
 * `error_code: "user_banned"`. Supabase gives no reason with that answer, so
 * this notices it once and tells the app, which shows `AccountSuspended`
 * instead of leaving a stranger to read "User is banned".
 *
 * Same shape as `update-required.ts`: it wraps fetch, reads only error
 * responses, from a clone, and announces once.
 */

const EVENT = 'pingo:account-suspended';
let suspended = false;

export function isAccountSuspended(): boolean {
  return suspended;
}

export function onAccountSuspended(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

function announce(): void {
  if (suspended) return;
  suspended = true;
  window.dispatchEvent(new Event(EVENT));
}

export function watchForSuspended(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await inner(input, init);
    if (response.status === 403 && !suspended) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/auth/v1/')) {
        void response
          .clone()
          .text()
          .then((body) => {
            if (body.includes('user_banned') || body.includes('User is banned')) announce();
          })
          .catch(() => undefined);
      }
    }
    return response;
  };
}
