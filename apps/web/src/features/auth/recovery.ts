import { AuthError } from '@pingo/core';

import { toPhoneDigits } from '../../lib/supabase/auth-service.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { authErrorMessage } from './messages.js';

/**
 * A code instead of a password: getting back in, and the number that makes it
 * possible.
 *
 * ## Getting back in
 *
 * Forgot password is a phone-code sign-in followed by setting a new password on
 * the session it produces. From the number door the browser asks Supabase
 * directly - the person typed the number. From the @username door it goes
 * through `password-recovery`, which keeps the number behind a handle on the
 * server and hands back only its last two digits, so the screen can say which
 * phone is about to ring.
 *
 * ## The number that makes it possible
 *
 * An account made with Google has no number, and so no way back in except
 * Google. `addPhoneStart` / `addPhoneVerify` attach one with Supabase's own
 * phone change - a code to the new number, checked against the signed-in
 * account - after which that one account answers to Google, the number and the
 * handle alike.
 *
 * Every code arrives as a call, through the same Send SMS hook as sign-up.
 */

export interface RecoveryIdentity {
  kind: 'phone' | 'username';
  value: string;
}

export type RecoveryStart = { status: 'sent'; ending: string } | { status: 'no_phone' };
export type AddPhoneStart = { status: 'sent'; ending: string } | { status: 'taken' };

const CODE_REFUSED = 'That code did not work.';

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Supabase's auth errors, as the codes the screens already know how to word. */
function fromSupabase(
  error: { status?: number | undefined; code?: string | undefined },
  codeStep: boolean,
): AuthError {
  if (offline()) return new AuthError('offline', 'You are offline.');
  if (error.status === 429) return new AuthError('rate_limited', 'Too many attempts.');
  if (error.code === 'weak_password') return new AuthError('weak_password', 'Pick a stronger password.');
  if (codeStep) return new AuthError('invalid_credentials', CODE_REFUSED);
  return new AuthError('unknown', 'Something went wrong. Try again.');
}

/** What to tell somebody when a recovery step fails. A wrong code is a code, not a password. */
export function recoveryErrorMessage(cause: unknown): string {
  if (cause instanceof AuthError && cause.code === 'invalid_credentials') {
    return "That code didn't work. Check it and try again.";
  }
  return authErrorMessage(cause, 'signIn');
}

function handle(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

async function invoke(body: Record<string, string>): Promise<Record<string, unknown>> {
  if (offline()) throw new AuthError('offline', 'You are offline.');
  const { data, error } = await getSupabaseClient().functions.invoke<Record<string, unknown>>(
    'password-recovery',
    { body },
  );
  if (!error) return data ?? {};
  // A refusal carries its code in the body; read it rather than assume one.
  try {
    const payload: unknown = await (
      error as { context?: { json?: () => Promise<unknown> } }
    ).context?.json?.();
    return (payload as Record<string, unknown> | undefined) ?? { code: 'unknown' };
  } catch {
    return { code: 'unknown' };
  }
}

/** Sends a code to the number on this account. */
export async function startRecovery(identity: RecoveryIdentity): Promise<RecoveryStart> {
  if (identity.kind === 'username') {
    const reply = await invoke({ action: 'start', username: handle(identity.value) });
    if (reply.code === 'no_phone') return { status: 'no_phone' };
    if (reply.code === 'rate_limited') throw new AuthError('rate_limited', 'Too many attempts.');
    if (reply.ok === true && typeof reply.ending === 'string') {
      return { status: 'sent', ending: reply.ending };
    }
    throw new AuthError('unknown', 'Something went wrong. Try again.');
  }

  const phone = toPhoneDigits(identity.value);
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    phone,
    // Recovery never creates an account.
    options: { shouldCreateUser: false },
  });
  /*
   * A number with no account is refused here, and saying so would tell anybody
   * which numbers have PINGO. So it reads exactly as a send: no call comes, and
   * the screen - which only repeats the digits they typed - learns nothing.
   * Only a rate limit, which says nothing about the account, is named.
   */
  if (error && (error.status === 429 || offline())) throw fromSupabase(error, false);
  return { status: 'sent', ending: phone.slice(-2) };
}

/** Checks the code; a right one leaves this tab signed in to the account. */
export async function verifyRecovery(identity: RecoveryIdentity, code: string): Promise<void> {
  const token = code.trim();

  if (identity.kind === 'username') {
    const reply = await invoke({ action: 'verify', username: handle(identity.value), code: token });
    if (reply.code === 'rate_limited') throw new AuthError('rate_limited', 'Too many attempts.');
    if (typeof reply.access_token !== 'string' || typeof reply.refresh_token !== 'string') {
      throw new AuthError('invalid_credentials', CODE_REFUSED);
    }
    const { error } = await getSupabaseClient().auth.setSession({
      access_token: reply.access_token,
      refresh_token: reply.refresh_token,
    });
    if (error) throw fromSupabase(error, false);
    return;
  }

  const { data, error } = await getSupabaseClient().auth.verifyOtp({
    phone: toPhoneDigits(identity.value),
    token,
    type: 'sms',
  });
  if (error || !data.session) throw fromSupabase(error ?? {}, true);
}

/** The password this account signs in with from now on. */
export async function setNewPassword(password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.updateUser({ password });
  if (error) throw fromSupabase(error, false);
}

/**
 * Starts attaching a number to the signed-in account: a code is sent to it.
 *
 * "Taken" is the one refusal named. It does say a number has an account - but
 * only to somebody signed in and typing what is almost always their own
 * number, and Supabase refuses it either way; a silent failure would leave
 * them waiting for a call that never comes.
 */
export async function addPhoneStart(e164: string): Promise<AddPhoneStart> {
  const phone = toPhoneDigits(e164);
  const { error } = await getSupabaseClient().auth.updateUser({ phone });
  if (error) {
    if (error.code === 'phone_exists' || /already/i.test(error.message)) return { status: 'taken' };
    throw fromSupabase(error, false);
  }
  return { status: 'sent', ending: phone.slice(-2) };
}

/** Finishes attaching the number: the code proves the phone is theirs. */
export async function addPhoneVerify(e164: string, code: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.verifyOtp({
    phone: toPhoneDigits(e164),
    token: code.trim(),
    type: 'phone_change',
  });
  if (error) throw fromSupabase(error, true);
}
