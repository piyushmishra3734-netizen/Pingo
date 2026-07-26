/**
 * `AuthService`, implemented on Supabase Auth.
 *
 * The only file in the product that knows Supabase handles identity. Screens
 * depend on the interface in `@pingo/core`; this is injected once in `App.tsx`.
 * The boundary note in `client.ts` applies here too — nothing under `screens/`
 * or `components/` may import this module.
 *
 * ## The three doors
 *
 * | Door | Sign up | Sign in |
 * | --- | --- | --- |
 * | Email | `signUp({ email, password })` | `signInWithPassword({ email, … })` |
 * | Phone | the same, on a derived address — see `PHONE_IDENTITY_DOMAIN` | the same |
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
} from '@pingo/core';
import type {
  AuthError as SupabaseAuthError,
  Session as SupabaseSession,
  User as SupabaseUser,
} from '@supabase/supabase-js';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';

/**
 * The reserved domain that carries a phone identity.
 *
 * ## Why a phone number signs in through the email provider
 *
 * Supabase's native phone provider cannot be switched on without SMS provider
 * credentials — the dashboard refuses to save without a Twilio (or Messagebird /
 * Textlocal / Vonage) account, and there is no "none" option. That is true even
 * with phone confirmations off, when not a single SMS would ever be sent.
 *
 * So a phone account is a real Supabase user keyed on a **derived address**:
 *
 *   +91 98765 43210  →  919876543210@phone.pingo.chat
 *
 * The derivation is deterministic, so the same number always resolves to the
 * same account — sign-up, sign-in and the § 17 duplicate check all behave
 * exactly as they do for email, because underneath they *are* the email path.
 * The number itself is stored on the account in `user_metadata` and is what the
 * product displays; the derived address is plumbing and never shown.
 *
 * ### What this costs, stated plainly
 *
 * | | |
 * | --- | --- |
 * | The number is unverified | Same as email in this flow — no OTP anywhere |
 * | `auth.users.phone` stays empty | The number lives in `user_metadata`, not the native column |
 * | Migration is not free | Moving to the native provider later means backfilling `phone` and re-keying these accounts |
 * | Metadata is user-writable | So it is display only — **authentication never reads it** |
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
 * Anything else — a provider enabled in the dashboard but not in the product —
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
   * A phone account is recognised by its derived address, not by metadata —
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
 * Translate a Supabase error into the product's closed set.
 *
 * Supabase's `code` is the reliable signal and `status` is the fallback — the
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
     * countdown is left undefined and the screen shows the honest version —
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
     * the project, and they are the one with devtools open — the user in front
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
 * `field` is the only difference between them — Supabase's `signUp` and
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
     * create — or sign in to — a phone account that is not theirs. The whole
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
     * confirmations off, so the error path is the one that runs — but the
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
 * Google, via Supabase's OAuth redirect.
 *
 * Redirect rather than popup: § 5.1 forbids a webview and popups are blocked by
 * default on mobile browsers. The client is already configured for the return
 * trip — `detectSessionInUrl` and `flowType: 'pkce'` in `client.ts` — so landing
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
         * § 5.1: openid, email, profile. Nothing else — no Drive, no Contacts,
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
   * this class deliberately does not ask at construction time — a network round
   * trip before the first render would delay every launch to answer something
   * that only matters when a row is tapped. A disabled provider surfaces as
   * `provider_disabled` at that point, with copy that says so.
   */
  readonly supportedMethods: readonly AuthMethodKind[] = ['email', 'phone', 'google'];

  readonly email: PasswordAuth;
  readonly phone: PasswordAuth;
  readonly google: OAuthAuth;

  private readonly client: PingoSupabaseClient;

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.client = client;
    this.email = new SupabasePasswordAuth(client, 'email');
    this.phone = new SupabasePasswordAuth(client, 'phone');
    this.google = new SupabaseGoogleAuth(client);
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) rethrow(error);
    return toSession(data.session);
  }

  onSessionChange(listener: (session: AuthSession | null) => void): Unsubscribe {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(toSession(session));
    });

    return () => data.subscription.unsubscribe();
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) rethrow(error);
  }
}
