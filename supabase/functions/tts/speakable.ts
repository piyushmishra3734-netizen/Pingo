/**
 * What is worth paying to say.
 *
 * Bulbul bills per *character* - v3 at ₹30 per 10,000, v2 at half of that - so
 * an asterisk, an emoji and a URL all cost the same as a word, and none of them
 * is a sound anybody wants. A forty character link is fifteen paise spent on
 * "aitch tee tee pee colon slash slash".
 *
 * This is the only lever on the bill that costs no quality, because everything
 * it removes was never speech.
 *
 * Its own file so `verify:speakable` can import it - `index.ts` calls
 * `Deno.serve` on load and starts a server if you so much as import it.
 */
export function speakableOnly(text: string): string {
  return (
    text
      // [label](url) keeps the label; a bare URL is not read at all.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      // Emphasis and code marks are punctuation no voice can pronounce.
      .replace(/[*_~`>#]/g, ' ')
      /*
       * Emoji, with any skin-tone or variation selector attached.
       *
       * Bulbul either skips them or says the name out loud - "thumbs up" in the
       * middle of a sentence - and both are worse than the silence they cost.
       */
      .replace(/\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}\u{FE0F}]?/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
