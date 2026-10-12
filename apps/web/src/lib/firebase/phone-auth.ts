import { AuthError, type AuthSession, type PhoneOtpAuth } from '@pingo/core';
import type { Session } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import type { PingoSupabaseClient } from '../supabase/client.js';
import { CONFIG } from './web-push.js';

/**
 * Login codes sent by Firebase, signed in to Supabase.
 *
 * Indian SMS needs a DLT-registered sender. Firebase sends from Google's, so
 * codes arrive without PINGO registering one. Firebase only proves the number:
 * the `firebase-phone-login` function checks its ID token and hands back a
 * session for the Supabase account on that number (made if there is none), so
 * every account, row and policy stays keyed to the Supabase user it always was.
 *
 * SMS only - Firebase has no voice codes - so "call me instead" sends a text too.
 *
 * In the Android app the native SDK sends it, so the SMS names the app rather
 * than the website, and Android's own check replaces the web reCAPTCHA.
 */
export class FirebasePhoneOtpAuth implements PhoneOtpAuth {
  /** The number a code went to, and how a code for it becomes a Firebase ID token. */
  #pending?: { phone: string; confirm(code: string): Promise<string> };
  #verifier?: { clear(): void };

  constructor(
    private readonly client: PingoSupabaseClient,
    private readonly toDigits: (phone: string) => string,
    private readonly toSession: (session: Session | null) => AuthSession | null,
    /** False for recovery: only an account already on the number signs in. */
    private readonly create = true,
  ) {}

  async start(phone: string): Promise<void> {
    const digits = this.toDigits(phone);
    if (Capacitor.isNativePlatform()) return this.#startNative(digits);
    const [{ initializeApp, getApps }, { getAuth, RecaptchaVerifier, signInWithPhoneNumber }] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app = getApps()[0] ?? initializeApp(CONFIG as Record<string, string>);
    const auth = getAuth(app);
    /*
     * Invisible: Firebase asks for a challenge only when it suspects a bot.
     * reCAPTCHA renders once per element, so every send (a resend too) gets a
     * fresh element and the previous widget is cleared away.
     */
    this.#verifier?.clear();
    document.getElementById('pingo-recaptcha')?.remove();
    const holder = document.createElement('div');
    holder.id = 'pingo-recaptcha';
    document.body.append(holder);
    const verifier = new RecaptchaVerifier(auth, holder, { size: 'invisible' });
    this.#verifier = verifier;
    try {
      const confirmation = await signInWithPhoneNumber(auth, `+${digits}`, verifier);
      this.#pending = {
        phone: digits,
        confirm: async (code) => (await confirmation.confirm(code)).user.getIdToken(),
      };
    } catch (cause) {
      throw firebaseError(cause);
    }
  }

  async #startNative(digits: string): Promise<void> {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    await FirebaseAuthentication.removeAllListeners();
    // Android can read the SMS itself and finish without the code being typed.
    let autoToken: string | undefined;
    const sent = new Promise<string | undefined>((resolve, reject) => {
      void FirebaseAuthentication.addListener('phoneCodeSent', (e) => resolve(e.verificationId));
      void FirebaseAuthentication.addListener('phoneVerificationCompleted', async () => {
        autoToken = (await FirebaseAuthentication.getIdToken()).token;
        resolve(undefined);
      });
      void FirebaseAuthentication.addListener('phoneVerificationFailed', (e) => reject({ code: e.message }));
    });
    try {
      await FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: `+${digits}` });
      const verificationId = await sent;
      this.#pending = {
        phone: digits,
        confirm: async (code) => {
          if (autoToken) return autoToken;
          await FirebaseAuthentication.confirmVerificationCode({ verificationId: verificationId!, verificationCode: code });
          return (await FirebaseAuthentication.getIdToken()).token;
        },
      };
    } catch (cause) {
      throw firebaseError(cause);
    }
  }

  async verify(phone: string, code: string): Promise<AuthSession> {
    const pending = this.#pending;
    if (!pending || pending.phone !== this.toDigits(phone)) {
      throw new AuthError('invalid_credentials', 'Ask for a new code.');
    }
    let idToken: string;
    try {
      idToken = await pending.confirm(code.trim());
    } catch (cause) {
      throw firebaseError(cause);
    }

    const { data, error } = await this.client.functions.invoke<{ access_token?: string; refresh_token?: string }>(
      'firebase-phone-login',
      { body: { idToken, create: this.create } },
    );
    if (error || !data?.access_token || !data.refresh_token) {
      throw new AuthError('invalid_credentials', 'That code did not work.');
    }
    const { data: signedIn, error: sessionError } = await this.client.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    const session = sessionError ? null : this.toSession(signedIn.session);
    if (!session) throw new AuthError('invalid_credentials', 'That code did not work.');
    this.#pending = undefined;
    // Firebase was only the proof; the Supabase session is the sign-in.
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor-firebase/authentication').then(({ FirebaseAuthentication }) => FirebaseAuthentication.signOut().catch(() => {}));
    } else {
      void import('firebase/auth').then(({ getAuth, signOut }) => signOut(getAuth()).catch(() => {}));
    }
    return session;
  }

  async setPassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error && error.code !== 'same_password') throw new AuthError('weak_password', error.message);
  }
}

function firebaseError(cause: unknown): AuthError {
  const code = (cause as { code?: string })?.code ?? '';
  if (code === 'auth/invalid-verification-code' || code === 'auth/code-expired') {
    return new AuthError('invalid_credentials', 'That code did not work.');
  }
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
    return new AuthError('rate_limited', 'Too many codes. Try again later.');
  }
  if (code === 'auth/invalid-phone-number') {
    return new AuthError('invalid_identifier', 'That does not look like a phone number.');
  }
  console.warn('[firebase-phone]', code || cause);
  return new AuthError('provider_disabled', 'Could not send a code right now.');
}
