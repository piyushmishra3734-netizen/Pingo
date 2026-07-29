/**
 * The AuthService boundary.
 *
 * The second data boundary in PINGO, and it follows the same rule as
 * `ChatService`: screens depend on this interface, never on a concrete
 * implementation. Supabase lives behind `SupabaseAuthService` in `apps/web`, and
 * swapping it — or running a fake in tests — is a one-line change at the
 * composition root.
 *
 * ## Shape follows the identity model
 *
 * [docs/01 § 1](../../../docs/01-onboarding-auth.md#1-identity-model--one-account-three-doors):
 * *one account, three doors.* Not three account types. So the methods are grouped
 * per door — `service.email.signIn(...)` — rather than flattened into
 * `signInWithEmail` / `signInWithGoogle` / `signInWithPhone`. Adding a fourth
 * door later is a new member here, not a reshaped call site
 * ([§ 20.2](../../../docs/01-onboarding-auth.md#202-architectural-seams-in-packagescore)
 * — *auth methods are a list, not a type*).
 *
 * ## There is no OTP in this product
 *
 * Both credential doors are **identifier + password**, and neither sends a code.
 * The blueprint's § 6.3 verification step is gone, along with the screens and the
 * service methods that drove it.
 *
 * The consequence is worth stating plainly, because it is a security decision and
 * not merely a simplification: **an address or number is no longer proven to
 * belong to the person signing up.** § 1 called that proof the point of the code.
 * Anything that depends on it — contact discovery by phone (§ 12), the email
 * reset link in the recovery triage (§ 14) — needs a verification step of its own
 * before it can be trusted, and cannot assume the identifier on the account was
 * ever checked.
 */

/** Returned by `onSessionChange`; call it to stop listening. */
export type Unsubscribe = () => void;

/**
 * A door into an account.
 *
 * An account has one or more of these attached, and gains the others from
 * Settings → Account.
 */
export type AuthMethodKind = 'email' | 'google' | 'phone';

/**
 * The signed-in identity.
 *
 * Deliberately thin: id, the contact points, and which doors are attached.
 * Display identity — name, username, photo, bio — is *profile* data and belongs
 * to `ChatService`, not here. Keeping them apart is what stops the auth layer
 * from growing into a second user store.
 */
export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  /** Attached sign-in methods. Never empty — § 1.1 rule 2. */
  methods: AuthMethodKind[];
  createdAt: number;
}

export interface AuthSession {
  user: AuthUser;
  /** Epoch ms. Absent when the backend does not expose one. */
  expiresAt?: number;
}

/**
 * Why an auth call failed, as a code the UI can branch on.
 *
 * A closed set rather than a message string: copy is the screen's job, and a
 * screen that switches on `error.message` breaks the first time the backend
 * rewords something.
 */
export type AuthErrorCode =
  /** Wrong password, or no such account. Deliberately indistinguishable — § 13.2. */
  | 'invalid_credentials'
  /** Sign-up hit an identifier that already has an account — § 17 routes to Log In. */
  | 'identity_exists'
  /**
   * The account exists but its identifier was never confirmed, and the backend
   * insists on it. A configuration mismatch rather than a user error: this flow
   * has no confirmation step to send them to.
   */
  | 'identity_unconfirmed'
  /** The door is closed at the backend — the provider is switched off. */
  | 'provider_disabled'
  | 'signup_disabled'
  /** Too many attempts. `retryAfterSeconds` carries the countdown when known. */
  | 'rate_limited'
  | 'weak_password'
  /** The identifier is not a shape the backend accepts. */
  | 'invalid_identifier'
  | 'offline'
  /** The user abandoned an OAuth consent screen. Not an error to shout about. */
  | 'cancelled'
  | 'unknown';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /** Present on `rate_limited`, so the UI can show a real countdown — § 13.2. */
  readonly retryAfterSeconds?: number;

  constructor(code: AuthErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * A door opened with an identifier and a password.
 *
 * Email and phone differ only in what the identifier *is*, so they share one
 * interface. That is not a shortcut — it is why `CreatePasswordScreen` and
 * `LoginPasswordScreen` each exist once instead of twice, and why adding a
 * third identifier type would need no new screens at all.
 */
export interface PasswordAuth {
  /**
   * Creates the account and signs in.
   *
   * @throws `AuthError` with `identity_exists` when the identifier is taken —
   * § 17 requires routing to Log In rather than creating a second account, which
   * is unrecoverable in a messaging product because the wrong account holds the
   * conversations.
   */
  signUp(identifier: string, password: string): Promise<AuthSession>;

  /** The returning-user path — § 13.2. */
  signIn(identifier: string, password: string): Promise<AuthSession>;
}

/**
 * A door opened by a third party.
 *
 * `start` hands off to the provider and **does not resolve with a session** —
 * the browser leaves the page. The session arrives through `onSessionChange`
 * when the provider redirects back, which is why nothing awaits a return value
 * here.
 */
export interface OAuthAuth {
  /** @param redirectTo absolute URL the provider returns to. */
  start(redirectTo: string): Promise<void>;
}

/** What the switcher shows. No tokens: those never leave the implementation. */
export interface SavedAccountSummary {
  userId: string;
  name: string;
  handle: string;
  avatarUrl?: string;
}

export interface AuthService {
  /**
   * Which doors this implementation can actually open.
   *
   * The Welcome and Log In screens render their method rows from this, so a
   * method that is off is absent rather than present-and-broken.
   */
  readonly supportedMethods: readonly AuthMethodKind[];

  readonly email: PasswordAuth;
  readonly phone: PasswordAuth;
  readonly google: OAuthAuth;

  /** Resolves `null` when signed out. Reads persisted state; may refresh a token. */
  getSession(): Promise<AuthSession | null>;

  /**
   * Push, not polling — a token refresh, a sign-out in another tab, or the
   * OAuth redirect landing all arrive here.
   */
  onSessionChange(listener: (session: AuthSession | null) => void): Unsubscribe;

  signOut(): Promise<void>;
  /**
   * Erases everything this device holds — cached chats, the outbox, and the
   * device keys that decrypt end-to-end encrypted messages.
   *
   * Separate from `signOut` on purpose. Signing out ends a session and is
   * routine; this destroys the key, and anything encrypted to it becomes
   * unreadable on this device afterwards. Two very different intentions that
   * used to share one button.
   */
  clearLocalData(): Promise<void>;

  // -- Account switching -----------------------------------------------------
  //
  // Several accounts may be signed in on one device, and switching between them
  // is a tap. The session for each is held locally; nothing here asks the
  // server to keep a list, because which accounts share a phone is exactly the
  // sort of thing a server has no business knowing.

  /** Accounts saved on this device, most recently used first. */
  listSavedAccounts(): SavedAccountSummary[];
  /**
   * Become a saved account.
   *
   * Reloads on success. Each account's E2EE identity is parked and restored
   * with it, so history encrypted before a switch is still readable after one.
   */
  switchTo(userId: string): Promise<void>;
  /** Take an account off this device without signing it out elsewhere. */
  forgetAccount(userId: string): void;
}
