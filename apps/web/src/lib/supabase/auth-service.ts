/**
 * `AuthService`, implemented on Supabase Auth.
 *
 * The only file in the product that knows Supabase handles identity. Screens
 * depend on the interface in `@pingo/core`; this is injected once in `App.tsx`.
 * The boundary note in `client.ts` applies here too - nothing under `screens/`
 * or `components/` may import this module.
 *
 * ## The three doors
 *
 * | Door | Sign up | Sign in |
 * | --- | --- | --- |
 * | Email | `signUp({ email, password })` | `signInWithPassword({ email, … })` |
 * | Phone | the same, on a derived address - see `PHONE_IDENTITY_DOMAIN` | the same |
 * | Google | `signInWithOAuth({ provider: 'google' })` | the same call |
 *
 * No OTP anywhere. Every door hands back a session immediately.
 *
 * ## ⚠️ This depends on one project setting
 *
 * Supabase only returns a session from `signUp` when the identifier does not
 * need confirming. With **Confirm email** on, `signUp` returns `session: null`
 * and the user is stranded on a screen whose next step is Home.
 *
 * | Setting | Required | Why |
 * | --- | --- | --- |
 * | Email → Confirm email | **off** | On means no session until a link is clicked |
 *
 * Notably **the phone provider does not need to be on**, because no call here
 * uses it. That is the point of the derived address: phone sign-in works on a
 * project with no SMS provider configured and no SMS budget.
 *
 * `assertSession` below turns a confirmation-required response into an explicit
 * `identity_unconfirmed` error rather than letting it read as success, because
 * a silent `session: null` is the failure mode that looks like a UI bug for a
 * day before anyone checks the dashboard.
 */

import {
  AuthError,
  type AuthMethodKind,
  type AuthService,
  type AuthSession,
  type AuthUser,
  type OAuthAuth,
  type PasswordAuth,
  type Unsubscribe,
  type UsernameAuth,
} from '@pingo/core';
import type {
  AuthError as SupabaseAuthError,
  Session as SupabaseSession,
  User as SupabaseUser,
} from '@supabase/supabase-js';

import { Capacitor } from '@capacitor/core';
import { SupabaseNativeGoogleAuth } from './google-native.js';
import { forgetPublication } from '../crypto/session.js';
import { forget, remember, savedAccount, savedAccounts, type SavedAccount } from './accounts.js';
import { localClear } from '../local/db.js';
import { getSupabaseClient, type PingoSupabaseClient } from './client.js';

/**
 * The reserved domain that carries a phone identity.
 *
 * ## Why a phone number signs in through the email provider
 *
 * Supabase's native phone provider cannot be switched on without SMS provider
 * credentials - the dashboard refuses to save without a Twilio (or Messagebird /
 * Textlocal / Vonage) account, and there is no "none" option. That is true even
 * with phone confirmations off, when not a single SMS would ever be sent.
 *
 * So a phone account is a real Supabase user keyed on a **derived address**:
 *
 *   +91 98765 43210  →  919876543210@phone.pingo.chat
 *
 * The derivation is deterministic, so the same number always resolves to the
 * same account - sign-up, sign-in and the § 17 duplicate check all behave
 * exactly as they do for email, because underneath they *are* the email path.
 * The number itself is stored on the account in `user_metadata` and is what the
 * product displays; the derived address is plumbing and never shown.
 *
 * ### What this costs, stated plainly
 *
 * | | |
 * | --- | --- |
 * | The number is unverified | Same as email in this flow - no OTP anywhere |
 * | `auth.users.phone` stays empty | The number lives in `user_metadata`, not the native column |
 * | Migration is not free | Moving to the native provider later means backfilling `phone` and re-keying these accounts |
 * | Metadata is user-writable | So it is display only - **authentication never reads it** |
 *
 * That last row is the one that matters. A user can edit their own
 * `user_metadata` through the Supabase client, so if sign-in trusted it, anyone
 * could point their account at someone else's number. It does not: the address
 * is always re-derived from what was typed, and metadata is read only to show
 * the number back.
 */
const PHONE_IDENTITY_DOMAIN = 'phone.pingo.chat';

/** Where the number is kept for display. Never consulted to authenticate. */
const PHONE_METADATA_KEY = 'pingo_phone';

/** `+91 98765 43210` → `919876543210@phone.pingo.chat`. */
function phoneToAddress(e164: string): string {
  return `${e164.replace(/\D/g, '')}@${PHONE_IDENTITY_DOMAIN}`;
}

function isPhoneAddress(address: string): boolean {
  return address.trim().toLowerCase().endsWith(`@${PHONE_IDENTITY_DOMAIN}`);
}

/**
 * Supabase's provider strings, narrowed to the doors PINGO recognises.
 *
 * Anything else - a provider enabled in the dashboard but not in the product  - 
 * is dropped rather than surfaced, so an unexpected value cannot reach a screen
 * that has no row for it.
 */
function toMethodKind(provider: string): AuthMethodKind | undefined {
  if (provider === 'email') return 'email';
  if (provider === 'google') return 'google';
  if (provider === 'phone') return 'phone';
  return undefined;
}

function toAuthUser(user: SupabaseUser): AuthUser {
  /*
   * A phone account is recognised by its derived address, not by metadata  - 
   * the address is set at sign-up and a user cannot change it, whereas
   * `user_metadata` is theirs to edit. Reading the number from metadata is safe
   * *because* the classification does not depend on it.
   */
  const phoneAccount = user.email ? isPhoneAddress(user.email) : false;
  const storedPhone = user.user_metadata?.[PHONE_METADATA_KEY];

  if (phoneAccount) {
    return {
      id: user.id,
      // The derived address is plumbing. Surfacing it would put
      // `919876543210@phone.pingo.chat` on the profile screen.
      email: undefined,
      phone: typeof storedPhone === 'string' ? storedPhone : undefined,
      methods: ['phone'],
      createdAt: Date.parse(user.created_at),
    };
  }

  const methods = (user.identities ?? [])
    .map((identity) => toMethodKind(identity.provider))
    .filter((kind): kind is AuthMethodKind => kind !== undefined);

  /*
   * A fresh sign-up can race the identities array. Falling back to whichever
   * identifier is present keeps `methods` from ever being empty, which § 1.1
   * rule 2 treats as impossible.
   */
  const fallback: AuthMethodKind[] = user.email ? ['email'] : user.phone ? ['phone'] : [];

  return {
    id: user.id,
    email: user.email ?? undefined,
    phone: user.phone || undefined,
    methods: methods.length > 0 ? methods : fallback,
    createdAt: Date.parse(user.created_at),
  };
}

function toSession(session: SupabaseSession | null): AuthSession | null {
  if (!session?.user) return null;
  return {
    user: toAuthUser(session.user),
    // Supabase reports seconds; the rest of the product works in epoch ms.
    expiresAt: session.expires_at ? session.expires_at * 1000 : undefined,
  };
}

/**
 * The session as it sits on disk, without asking anybody whether it is current.
 *
 * The key is ours - `client.ts` sets `storageKey` explicitly - and the value is
 * the session object as auth-js wrote it, so this is a read of our own record
 * rather than a guess at a library's internals. Everything is defended anyway:
 * a value that is absent, unparseable or the wrong shape means no session, and
 * the caller carries on to the ordinary answer.
 */
function persistedSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem('pingo.auth.session');
    if (!raw) return null;
    return toSession(JSON.parse(raw) as SupabaseSession);
  } catch {
    return null;
  }
}

/**
 * Translate a Supabase error into the product's closed set.
 *
 * Supabase's `code` is the reliable signal and `status` is the fallback - the
 * message is not consulted at all, because it is server copy that can change
 * without notice.
 */
function toAuthError(error: SupabaseAuthError): AuthError {
  const code = error.code ?? '';

  if (code === 'invalid_credentials' || (error.status === 400 && code === '')) {
    return new AuthError('invalid_credentials', 'Those details did not match.');
  }

  if (code === 'user_already_exists' || code === 'email_exists' || code === 'phone_exists') {
    return new AuthError('identity_exists', 'That account already exists.');
  }

  if (code === 'email_not_confirmed' || code === 'phone_not_confirmed') {
    return new AuthError('identity_unconfirmed', 'That account is not confirmed.');
  }

  if (code === 'email_provider_disabled' || code === 'phone_provider_disabled') {
    return new AuthError('provider_disabled', 'That sign-in method is switched off.');
  }

  if (code === 'signup_disabled') {
    return new AuthError('signup_disabled', 'New accounts are switched off.');
  }

  if (code === 'weak_password') {
    return new AuthError('weak_password', 'That password is too weak.');
  }

  if (code === 'validation_failed') {
    return new AuthError('invalid_identifier', 'That is not a valid identifier.');
  }

  if (
    error.status === 429 ||
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_sms_send_rate_limit'
  ) {
    /*
     * Supabase does not return Retry-After in the client payload, so the
     * countdown is left undefined and the screen shows the honest version  - 
     * "too many attempts" without inventing a number it cannot know.
     */
    return new AuthError('rate_limited', 'Too many attempts.');
  }

  // A failed fetch has no status at all: the request never reached Supabase.
  if (error.status === undefined && !navigator.onLine) {
    return new AuthError('offline', 'You are offline.');
  }

  return new AuthError('unknown', error.message);
}

/** Wraps a call so every rejection reaching a screen is an `AuthError`. */
function rethrow(error: unknown): never {
  if (error instanceof AuthError) throw error;

  if (typeof error === 'object' && error !== null && 'code' in error && 'status' in error) {
    throw toAuthError(error as SupabaseAuthError);
  }

  if (!navigator.onLine) {
    throw new AuthError('offline', 'You are offline.');
  }

  throw new AuthError('unknown', error instanceof Error ? error.message : 'Something went wrong.');
}

/**
 * A `signUp` that returns no session means the backend wants the identifier
 * confirmed first. Named as such rather than passed off as a generic failure,
 * because the fix is a dashboard toggle and the message should say so.
 */
function assertSession(session: SupabaseSession | null, context: 'signUp' | 'signIn'): AuthSession {
  const mapped = toSession(session);
  if (mapped) return mapped;

  if (context === 'signUp') {
    /*
     * Console, not the screen. The person who can act on this is whoever runs
     * the project, and they are the one with devtools open - the user in front
     * of the form can do nothing with it. `authErrorMessage` renders copy aimed
     * at them instead.
     */
    console.warn(
      '[pingo/auth] signUp returned no session: the project still requires ' +
        'confirmation. Turn off "Confirm email" in Supabase → Authentication → ' +
        'Sign In / Providers. Accounts created while it was on stay unconfirmed ' +
        'and cannot sign in until confirmed from Authentication → Users.',
    );

    throw new AuthError(
      'identity_unconfirmed',
      'The account was created but the backend requires confirmation before issuing a session.',
    );
  }

  throw new AuthError('invalid_credentials', 'Those details did not match.');
}

/**
 * Both credential doors, one implementation.
 *
 * `field` is the only difference between them - Supabase's `signUp` and
 * `signInWithPassword` take `{ email, password }` or `{ phone, password }`, and
 * nothing else about the two paths diverges.
 */
class SupabasePasswordAuth implements PasswordAuth {
  constructor(
    private readonly client: PingoSupabaseClient,
    private readonly kind: 'email' | 'phone',
  ) {}

  /**
   * The address this identifier signs in with.
   *
   * Always recomputed from what the user typed. Nothing here reads stored state,
   * which is what stops a user-editable `user_metadata` from influencing who
   * they can sign in as.
   */
  private toAddress(identifier: string): string {
    const value = identifier.trim();

    if (this.kind === 'phone') return phoneToAddress(value);

    /*
     * The email door must refuse the reserved domain. Without this, typing
     * `919876543210@phone.pingo.chat` into the email screen would let anyone
     * create - or sign in to - a phone account that is not theirs. The whole
     * scheme rests on that address space belonging to the phone door alone.
     */
    if (isPhoneAddress(value)) {
      throw new AuthError('invalid_identifier', 'That address is not available.');
    }

    return value;
  }

  /** The number, stored on the account for display. Phone door only. */
  private metadata(identifier: string): Record<string, string> | undefined {
    if (this.kind !== 'phone') return undefined;
    return { [PHONE_METADATA_KEY]: identifier.trim() };
  }

  async signUp(identifier: string, password: string): Promise<AuthSession> {
    const data_ = this.metadata(identifier);

    const { data, error } = await this.client.auth.signUp({
      email: this.toAddress(identifier),
      password,
      ...(data_ ? { options: { data: data_ } } : {}),
    });

    if (error) rethrow(error);

    /*
     * With confirmations off, an identifier that is already taken comes back as
     * an error. With them on, Supabase instead returns an obfuscated user and no
     * session, to avoid confirming the account exists. This flow requires
     * confirmations off, so the error path is the one that runs - but the
     * identities check below catches the obfuscated shape too, rather than
     * reporting "unconfirmed" for what is really a collision.
     */
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      throw new AuthError('identity_exists', 'That account already exists.');
    }

    return assertSession(data.session, 'signUp');
  }

  async signIn(identifier: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: this.toAddress(identifier),
      password,
    });

    if (error) rethrow(error);
    return assertSession(data.session, 'signIn');
  }
}

/**
 * The @username door.
 *
 * ## Why this one call goes through an Edge Function
 *
 * Every other door talks to Supabase directly. This one cannot, because
 * Supabase authenticates on an address and a username is not one, and the
 * translation between them must not be available to the browser: an endpoint
 * that turns a public handle into the private email address behind it is a way
 * to harvest every address on the product, one username at a time.
 *
 * So `username-login` does the lookup with the service-role key, signs in on
 * the caller's behalf, and returns tokens. `setSession` then installs them, and
 * from that moment the session is the same object every other door produces -
 * `onSessionChange` fires, the account is remembered, nothing downstream can
 * tell which door was used.
 *
 * The function is deliberately incurious about failure: unknown username and
 * wrong password come back identically, so the code below has nothing to
 * branch on and cannot leak the distinction even by accident.
 */
class SupabaseUsernameAuth implements UsernameAuth {
  constructor(private readonly client: PingoSupabaseClient) {}

  async signIn(username: string, password: string): Promise<AuthSession> {
    const handle = username.trim().replace(/^@/, '').toLowerCase();

    let payload: { access_token?: string; refresh_token?: string; code?: string };

    try {
      const { data, error } = await this.client.functions.invoke<typeof payload>(
        'username-login',
        { body: { username: handle, password } },
      );

      /*
       * A non-2xx response is an `error` here, and its body carries the code.
       * Read rather than assumed: `invoke` reports "non-2xx" for a refusal and
       * for a crash alike, and treating a 500 as "wrong password" would tell
       * somebody their password is wrong when the server is simply down.
       */
      if (error) {
        const body: unknown = await (
          error as { context?: { json?: () => Promise<unknown> } }
        ).context?.json?.();
        const code = (body as { code?: string } | undefined)?.code;

        if (code === 'rate_limited') throw new AuthError('rate_limited', 'Too many attempts.');
        if (code === 'invalid_credentials') {
          throw new AuthError('invalid_credentials', 'Those details did not match.');
        }
        throw new AuthError('unknown', 'Something went wrong. Try again.');
      }

      payload = data ?? {};
    } catch (cause) {
      if (cause instanceof AuthError) throw cause;
      rethrow(cause);
    }

    if (!payload.access_token || !payload.refresh_token) {
      throw new AuthError('invalid_credentials', 'Those details did not match.');
    }

    const { data, error } = await this.client.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });

    if (error) rethrow(error);
    return assertSession(data.session, 'signIn');
  }
}

/**
 * Google, via Supabase's OAuth redirect.
 *
 * Redirect rather than popup: § 5.1 forbids a webview and popups are blocked by
 * default on mobile browsers. The client is already configured for the return
 * trip - `detectSessionInUrl` and `flowType: 'pkce'` in `client.ts` - so landing
 * back on the app is what produces the session, and it arrives through
 * `onSessionChange` like any other.
 */
class SupabaseGoogleAuth implements OAuthAuth {
  constructor(private readonly client: PingoSupabaseClient) {}

  async start(redirectTo: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        /*
         * § 5.1: openid, email, profile. Nothing else - no Drive, no Contacts,
         * no Calendar. A scope we do not need is a scope we do not ask for.
         */
        scopes: 'openid email profile',
      },
    });

    if (error) rethrow(error);
    // No return value by design: the browser is leaving this page.
  }
}

export class SupabaseAuthService implements AuthService {
  /**
   * All three doors are built.
   *
   * Whether the backend has each one switched on is a separate question, and one
   * this class deliberately does not ask at construction time - a network round
   * trip before the first render would delay every launch to answer something
   * that only matters when a row is tapped. A disabled provider surfaces as
   * `provider_disabled` at that point, with copy that says so.
   */
  readonly supportedMethods: readonly AuthMethodKind[] = [
    'email',
    'phone',
    'google',
    'username',
  ];

  readonly email: PasswordAuth;
  readonly phone: PasswordAuth;
  readonly google: OAuthAuth;
  readonly username: UsernameAuth;

  private readonly client: PingoSupabaseClient;

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.client = client;
    this.email = new SupabasePasswordAuth(client, 'email');
    this.phone = new SupabasePasswordAuth(client, 'phone');
    this.username = new SupabaseUsernameAuth(client);
    /*
     * One door, two ways through it.
     *
     * The web keeps the OAuth redirect: it is correct in a browser and Supabase
     * handles the return trip. Android gets the system account picker, because
     * a redirect out to a browser and back is the seam that makes an app feel
     * like a wrapped website - and because the shell has no address bar for the
     * return to land in.
     *
     * Chosen once, here, on the only line in the product that knows there are
     * two. Both satisfy `OAuthAuth`, both finish by producing a Supabase
     * session through `onSessionChange`, so every screen above is unaware.
     * Email and phone are untouched by any of this.
     */
    this.google = Capacitor.isNativePlatform()
      ? new SupabaseNativeGoogleAuth(client)
      : new SupabaseGoogleAuth(client);
  }

  /**
   * The session, and the answer that made a cold launch offline possible.
   *
   * ## Why the stored copy is consulted at all
   *
   * An access token lasts an hour and refreshing one is a network call. So a
   * device that has been closed since last night launches with a session that
   * is on disk, intact, and *expired* - and `getSession` tries to refresh it,
   * cannot reach the server, and returns null. Null is what this returned, and
   * null is read one level up as `anonymous`, which sends the person to the Log
   * In screen. Everything behind the guard - the cached conversation list, the
   * media on the device, the draft, the outbox - was unreachable, on an app
   * whose entire claim is that it works without a connection.
   *
   * ## Why "still in storage" is the right test, and not `navigator.onLine`
   *
   * Auth-js removes the stored session when the server *rejects* it - a revoked
   * or reused refresh token - and deliberately keeps it when the refresh failed
   * for a retryable fetch error. So the presence of the blob already carries
   * exactly the distinction that matters, decided by the library that owns it,
   * and re-deriving it from a connectivity flag would be guessing at something
   * already known.
   *
   * ## What this does not do
   *
   * It does not extend anybody's access. The token it reports is the expired
   * one; every request made with it is refused by the server exactly as before,
   * and each screen falls back to what the device holds. The only thing that
   * changes is which side of the login guard the user waits on. When the
   * network returns, auth-js refreshes and `onSessionChange` replaces this with
   * the real thing - or signs the user out, if the refresh token is genuinely
   * dead.
   */
  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (data.session) return toSession(data.session);

    const stored = persistedSession();
    if (stored) return stored;

    if (error) rethrow(error);
    return null;
  }

  /**
   * Change the password, old one first.
   *
   * ## The old password is verified by signing in with it
   *
   * There is no "check this password" call in Supabase, and writing one would
   * mean comparing hashes ourselves. Re-signing in is the check: a wrong
   * password fails there, before `updateUser` is ever reached, and a right one
   * leaves the session freshly authenticated - which is exactly what
   * `secure_password_change = true` in `config.toml` requires before it will
   * accept a new password. One call satisfies both needs.
   *
   * The address is taken from the current session rather than typed, so this
   * works identically for a phone account (whose address is derived and never
   * shown) without the screen having to know that such a thing exists.
   *
   * ## Other devices stay signed in
   *
   * A password change does not end the session on someone's phone, for the same
   * reason `signOut` is local: this is a routine maintenance action, and having
   * it silently log you out of every device you own is the behaviour that makes
   * people avoid changing their password at all. Ending other sessions belongs
   * to a "you were compromised" flow, which is a different button with a
   * different warning on it.
   */
  async changePassword(current: string, next: string): Promise<void> {
    const { data: sessionData } = await this.client.auth.getSession();
    const address = sessionData.session?.user.email;

    if (!address) {
      /*
       * A Google-only account. It has no password, so there is nothing to
       * change - and quietly setting one would attach a second sign-in method
       * the user never asked for, on an address they have not confirmed is
       * theirs to use here.
       */
      throw new AuthError(
        'provider_disabled',
        'This account signs in with Google and has no password.',
      );
    }

    const { error: signInError } = await this.client.auth.signInWithPassword({
      email: address,
      password: current,
    });

    if (signInError) rethrow(signInError);

    const { error } = await this.client.auth.updateUser({ password: next });
    if (error) rethrow(error);
  }

  onSessionChange(listener: (session: AuthSession | null) => void): Unsubscribe {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      /*
       * Recorded on every sign-in and every refresh.
       *
       * Refresh matters more than sign-in here: a saved account whose refresh
       * token has gone stale is a face in a list that fails when tapped, which
       * is worse than not offering the account at all. Keeping the stored copy
       * current is what makes one-tap switching actually work a week later.
       */
      if (session?.user && session.refresh_token) {
        const meta = session.user.user_metadata ?? {};
        remember({
          userId: session.user.id,
          name: String(meta.name ?? meta.full_name ?? session.user.email ?? 'Account'),
          handle: String(meta.username ?? session.user.email ?? ''),
          ...(meta.avatar_url ? { avatarUrl: String(meta.avatar_url) } : {}),
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        });
      }

      listener(toSession(session));
    });

    return () => data.subscription.unsubscribe();
  }

  /** Accounts saved on this device, most recently used first. */
  listSavedAccounts(): SavedAccount[] {
    return savedAccounts();
  }

  /**
   * Switch to a saved account in one step.
   *
   * `setSession` swaps the token Supabase holds; the reload is what rebuilds
   * every provider, subscription and cache around the new identity. Trying to
   * re-point all of that in place would mean auditing every module that has
   * ever captured a user id, and getting one wrong shows another person's
   * conversations - a reload is a fraction of a second and cannot be subtly
   * wrong.
   *
   * The E2EE identity follows automatically: `publishDeviceKey` notices the
   * owner has changed and restores that account's parked keys, so history
   * encrypted before the switch is still readable after it.
   */
  async switchTo(userId: string): Promise<void> {
    const account = savedAccount(userId);
    if (!account) throw new Error('That account is not saved on this device.');

    const { error } = await this.client.auth.setSession({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    if (error) {
      // A refresh token the server no longer accepts. Drop it rather than
      // leaving a row that fails every time it is tapped.
      forget(userId);
      rethrow(error);
    }

    forgetPublication();
    window.location.assign('/chats');
  }

  /** Take an account off this device without signing it out elsewhere. */
  forgetAccount(userId: string): void {
    forget(userId);
  }

  async signOut(): Promise<void> {
    /*
     * This browser only.
     *
     * Supabase defaults `signOut` to `scope: 'global'`, which revokes every
     * refresh token the account has anywhere — so logging out of Edge signed
     * the same person out of Chrome, their phone, and any tab they had left
     * open. Nobody means that by "log out"; they mean "not on this machine".
     *
     * The device identity stays either way (see below), so signing back in on
     * any of those devices keeps its history.
     */
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) rethrow(error);

    /*
     * Signing out ends the session and nothing else.
     *
     * It used to wipe local storage as well, and that was the wrong trade. The
     * device identity lives there, so a logout destroyed the private key every
     * encrypted message had been sealed to - signing back in minted a new one
     * and the old conversations became permanently unreadable. Nobody expects
     * "log out" to mean "burn your history", and no messaging app people
     * actually use behaves that way.
     *
     * So the keys stay, the sealed cache stays, and signing back in on this
     * device picks up exactly where it left off - including chats that were
     * encrypted before the logout.
     *
     * The shared-device worry that motivated the wipe is real but is a
     * different question, and it now has its own answer: Clear local data, run
     * deliberately by someone who means it. A destructive default is not a
     * privacy feature if it fires on the ninety-nine people who just wanted to
     * switch accounts.
     */
    forgetPublication();
  }

  /**
   * Erases everything this device holds: cached chats, the outbox, and the
   * device keys themselves.
   *
   * Deliberately separate from signing out, and deliberately not reversible.
   * Anything encrypted to this device's key becomes unreadable here once the
   * key is gone, which is exactly what somebody handing the laptop back wants
   * and exactly what somebody switching accounts does not.
   */
  async clearLocalData(): Promise<void> {
    await localClear();
    forgetPublication();
  }
}
