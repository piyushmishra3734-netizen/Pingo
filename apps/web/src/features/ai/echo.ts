/**
 * Is this the microphone hearing PINGO, rather than a person?
 *
 * A speaker plays into the microphone. Browser echo cancellation removes most
 * of it and not all - on a phone held at arm's length, almost none - so the
 * detector hears a voice, calls it speech, and PINGO stops itself mid-sentence
 * while nobody has said a word. It then sits on "listening" waiting for a
 * person who is not talking, which is the failure people actually report.
 *
 * The only reliable difference between an echo and an interruption is *what the
 * words are*. An echo transcribes as PINGO's own sentence.
 *
 * Compared on words rather than characters, because a transcript of speech
 * played through a speaker is never character-exact - it drops punctuation,
 * mishears an ending, splits a compound. Half of a short phrase matching what
 * is currently being said is far more likely to be an echo than a coincidence.
 *
 * Biased towards treating things as echo. A missed interruption costs somebody
 * repeating themselves; a false one stops PINGO mid-sentence for no reason.
 *
 * Its own file so `verify:echo` can import it without dragging in the Supabase
 * client that the call screen loads at module scope - and because a matcher
 * that fails silently needs a test more than most things do.
 */
export function isEcho(heard: string, speaking: string): boolean {
  const words = (text: string) =>
    text
      .toLowerCase()
      /*
       * The backslashes matter, and they were missing.
       *
       * Without them this was the character class `p`, `{`, `L`, `}`, `N`, `s`
       * and a split on the letter s - so `mine` came out empty for almost every
       * sentence, every echo was judged not to be one, and PINGO stopped itself
       * the moment the microphone heard its own voice. The call died mid-answer
       * and sat on "listening" with nobody talking: exactly the bug this
       * function was written to prevent.
       */
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const mine = new Set(words(speaking));
  if (mine.size === 0) return false;

  const theirs = words(heard);
  if (theirs.length === 0) return true;

  const shared = theirs.filter((word) => mine.has(word)).length;
  return shared / theirs.length >= 0.5;
}
