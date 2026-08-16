/**
 * The one test that decides whether a group message is encrypted.
 *
 * A group message is sealed like every other message in PINGO, with exactly one
 * exception: it @mentions PINGO AI, and PINGO AI is in that group. Then it is
 * sent in the clear, because something has to be able to read a question in
 * order to answer it.
 *
 * That makes this function the single most consequential regex in the app, and
 * it is out here on its own so it can be asserted from Node rather than living
 * halfway down a service that cannot be imported without a browser.
 *
 * Two ways it can be wrong, and they are not equally bad. Too strict and
 * somebody's `@pingoai` is sealed and never answered - annoying, visible,
 * fixed in a message. Too loose and a message somebody meant only for their
 * group is uploaded in plaintext, and nobody finds out.
 */

/** Fixed AI identity - same uuid as `public.pingo_ai_user_id()` and the Edge Function. */
export const PINGO_AI_USER_ID = 'a1000000-0000-4000-8000-0000000000a1';

/**
 * Whether this body is addressed to PINGO AI.
 *
 * Both product spellings of the handle, and `\b` so a longer handle that merely
 * starts the same way - `@pingoaibot` - is somebody else entirely and keeps its
 * encryption.
 */
export function mentionsPingoAi(text: string): boolean {
  // Accept both the autocomplete handle and the profile username form.
  return /@pingo_?ai\b/i.test(text);
}
