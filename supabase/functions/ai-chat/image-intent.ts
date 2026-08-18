/**
 * "Did they ask for a picture, and of what?"
 *
 * Pure and separate from `index.ts` so it can be asserted outside Deno - see
 * `pnpm verify:image-intent`. It is the whole decision: everything downstream
 * costs money and takes seconds, so being wrong here is expensive in both
 * directions. A missed request reads as the assistant ignoring you; a false
 * positive answers "send me a photo of your ID" with an oil painting.
 *
 * ## Why a regex and not the model
 *
 * Asking the model "is this an image request?" is a second round trip before
 * the first one starts, on every message, to answer a question that the words
 * "draw", "banao" and "/imagine" already answer. The model is the fallback
 * anyway: anything that does not match here goes down the ordinary reply path
 * and PINGO can simply say what it can do.
 *
 * ## Hinglish is the first language here, not a localisation
 *
 * "photo banao", "ek tasveer bana do", "image bana" are how this gets asked in
 * practice, so they are matched as directly as the English forms rather than
 * through some translation step.
 */

/** Openers that mean "make me one", with the subject following. */
const COMMAND = /^\s*\/(?:imagine|image|img|draw|art)\b[:,]?\s*/i;

/**
 * English: a making verb, then a picture word, then the subject.
 *
 * The picture word is required. "draw a conclusion" and "make a list" are not
 * requests for art, and the difference between them and "draw a cat" is
 * exactly the missing noun.
 */
const ENGLISH =
  /^\s*(?:can\s+you\s+|could\s+you\s+|please\s+|pls\s+)?(?:draw|generate|create|make|paint|render|design|sketch)\s+(?:me\s+)?(?:an?\s+|some\s+)?(?:images|image|pictures|picture|photographs|photograph|photos|photo|pics|pic|artworks|artwork|art|drawings|drawing|paintings|painting|illustrations|illustration|wallpapers|wallpaper|logos|logo)\s*(?:of|for|showing|with)?\s*/i;

/**
 * Hinglish: the subject comes *first*, then the picture word, then the verb.
 *
 * "ek cat ka photo banao" - the prompt is everything before the picture word,
 * which is the mirror image of the English shape and why this cannot be one
 * pattern with alternation.
 */
const HINGLISH =
  /^\s*(.*?)\s*(?:ka|ki|ke)?\s*(?:images|image|pictures|picture|photos|photo|photu|tasveer|tasvir|pic|artwork|art|drawing|wallpaper)\s+(?:bana\s*do|bana\s*de|banade|banaao|banao|bana|nikal\s*do|nikalo|de\s*do|do)\b(?:\s+(?:please|pls|plz|na|naa|yaar|yr|bhai|bro|dost))*\s*[.!?]*\s*$/i;

/** Leading filler the subject never actually starts with. */
const LEADING_FILLER = /^(?:me|mujhe|mereko|hume|humein|ek|एक|a|an|the|of|for)\s+/i;

/** Trailing politeness that is not part of what to draw. */
const TRAILING_FILLER = /\s*(?:please|pls|plz|na|naa|yaar|bhai|bro|thanks|thx)\s*[.!?]*\s*$/i;

/** Nothing useful is drawn from three characters, and the API still charges. */
const MIN_PROMPT = 3;

/** Long enough for a detailed scene, short enough not to be a pasted essay. */
const MAX_PROMPT = 900;

function tidy(subject: string): string | undefined {
  let out = subject.trim();

  // Repeated because "me a picture of a ..." strips one word per pass, and a
  // single pass would leave "a" glued to the front of every prompt.
  for (let i = 0; i < 4; i += 1) {
    const shorter = out.replace(LEADING_FILLER, '').replace(TRAILING_FILLER, '');
    if (shorter === out) break;
    out = shorter;
  }

  out = out.replace(/^["'`]|["'`]$/g, '').trim();
  if (out.length < MIN_PROMPT) return undefined;
  return out.slice(0, MAX_PROMPT);
}

/**
 * The subject to draw, or undefined for "this is an ordinary message".
 *
 * Undefined is the safe answer and the common one: the caller falls through to
 * the normal reply path, which is what every non-request must do.
 */
export function imagePrompt(body: string): string | undefined {
  if (!body) return undefined;

  // A slash command is unambiguous, so it is tried first and its subject is
  // whatever follows - no picture word needed, the command *is* the picture
  // word.
  const command = COMMAND.exec(body);
  if (command) return tidy(body.slice(command[0].length));

  const english = ENGLISH.exec(body);
  if (english) return tidy(body.slice(english[0].length));

  const hinglish = HINGLISH.exec(body);
  if (hinglish) return tidy(hinglish[1] ?? '');

  return undefined;
}
