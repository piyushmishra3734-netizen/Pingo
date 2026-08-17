/**
 * Trimming a reply to the requested length without amputating the answer.
 *
 * ## What this is fixing
 *
 * On the default setting this kept the first *two lines* and 140 characters,
 * and cut mid-word past that. Ask a question with three numbers in it and the
 * third was simply deleted - asked live, PINGO AI replied "Chetan: 8 aam /
 * Bina: 4 aam (Chetan se aadhe)" and stopped, with Amit and the total gone.
 *
 * The model had reasoned correctly. The formatter published half of it. Every
 * complaint about the assistant being shallow had this in front of it, whatever
 * the model behind it was doing.
 *
 * ## The rule
 *
 * Whole lines, up to a budget, and never a cut inside a word. A reply that fits
 * is returned untouched; one that does not keeps as many complete lines as fit,
 * so what arrives is a finished thought rather than half of one.
 *
 * The budgets are still short - six lines and 600 characters is a chat reply by
 * any measure. What it is not is two lines, which is not room to answer a
 * question with three numbers in it.
 *
 * ## Why it is its own file
 *
 * It is pure, it is the one piece of this function with a right answer that can
 * be stated, and the module it lived in cannot be imported outside Deno. Out
 * here it is asserted directly - see `verify:ai-reply-shape`.
 */
/**
 * Breaks a reply into the few short messages a person would actually send.
 *
 * Somebody saying hello sends "hi", then "kaise ho", then "kya kar rahe ho" -
 * four bubbles, not one paragraph with four clauses in it. The assistant wrote
 * the same content as a block, which is correct and joyless to read.
 *
 * The model already writes in lines when it is asked to, so this is only about
 * where they are posted. Three at most: past that a list turns into a wall of
 * bubbles, which is its own kind of unpleasant. And never on `detailed`, where
 * somebody has asked for something written rather than a conversation.
 *
 * A line that is really a list item - "Chetan: 8 aam" - is left joined to its
 * neighbours, because four bubbles of arithmetic is not how a person talks
 * either. The test is whether the lines look like a list: short, and most of
 * them carrying a colon or a bullet.
 */
/**
 * How much reply the message in front of us actually deserves.
 *
 * The splitter used to break up whatever the model wrote, so "ok" got three
 * bubbles the same as a real question did. A person does not answer "haan?"
 * with a paragraph, and reading three bubbles for a one-word message is the
 * thing that makes an assistant exhausting rather than useful.
 *
 * Judged from the message, because that is the only honest signal available
 * before the reply exists: how much was said, and whether anything was actually
 * asked. A greeting gets a greeting back. A question gets an answer. Nothing
 * gets a lecture.
 */
export function replyBudget(userMessage: string): { bubbles: number; chars: number } {
  const said = (userMessage ?? '').trim();
  const asked = /[?？]/.test(said) || /\b(kaise|kya|kyu|kyun|kab|kahan|kaun|how|what|why|when|where|who|explain|batao|bata|samjha)\b/i.test(said);

  // A few words and no question: chit-chat. One line back.
  if (said.length <= 30 && !asked) return { bubbles: 1, chars: 120 };

  // Something asked, or something substantial said: room to answer properly.
  if (asked || said.length > 120) return { bubbles: 3, chars: 320 };

  // In between - a statement worth acknowledging, not worth an essay.
  return { bubbles: 2, chars: 220 };
}

export function splitIntoBubbles(
  text: string,
  length: string,
  /** The message being answered. Absent means the old behaviour. */
  userMessage?: string,
): string[] {
  const body = text.trim();
  if (!body) return [];
  if (length === 'detailed') return [body];

  const budget = userMessage === undefined ? undefined : replyBudget(userMessage);
  if (budget?.bubbles === 1) return [shapeReply(body, 'short').slice(0, budget.chars).trim()];

  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  /*
   * One line with several sentences in it is the case that actually happens.
   *
   * The prompt asks for one thought per line and the model often ignores it -
   * asked "hello, kaisa hai, kya kar raha tha, khana khaya?" it answered with a
   * single sentence containing all three replies. Waiting for the model to
   * format itself is waiting for something that does not come, so the split is
   * done here where it is deterministic.
   *
   * Sentence ends only, and only when there is enough text to be worth
   * breaking - a short "haan bilkul." is one message however it is punctuated.
   */
  if (lines.length === 1) {
    const only = lines[0]!;

    /*
     * Splitting one line is rare, and it used to be constant.
     *
     * A newline is the model's own decision that two thoughts are separate,
     * and respecting it is honest. Cutting a single line on its full stops is
     * *our* guess, and at 80 characters and two sentences it fired on almost
     * every reply - so every message arrived as three bubbles whether or not
     * there were three things to say.
     *
     * The bar is now a reply long enough that reading it as one block is
     * genuinely worse: three sentences and past 180 characters. Below that it
     * is one message, which is what most replies should be. And it gives two
     * bubbles, never three - a wall broken in half, not scattered.
     */
    const sentences = only.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [];
    const parts = sentences.map((s) => s.trim()).filter(Boolean);
    if (only.length < 180 || parts.length < 3) return [only];

    const half = Math.ceil(parts.length / 2);
    return [parts.slice(0, half).join(' '), parts.slice(half).join(' ')];
  }

  if (lines.length < 2) return [body];

  /*
   * A list is decided by its shape, not by a leading digit.
   *
   * The test used to count lines starting with a number or a bullet, which is
   * exactly what a model produces when it is told "one thought per line" - it
   * numbers them. So "1. hey / 2. kaise ho / 3. khana khaya" was read as a
   * list, kept as one block, and shipped with the numbers still on it. Nobody
   * chats in an enumerated list.
   *
   * A real list is "Chetan: 8 aam" - a label and a value. That is what this
   * looks for now, and the numbering is stripped rather than respected.
   */
  /*
   * Numbering comes off first, before anything decides what this is.
   *
   * It used to be stripped only after the list test, so "1: hey / 2: kaise ho"
   * - numbered *and* colon'd - was read as a list, kept as one block, and
   * shipped with the numbers still on it. The enumerator is never content: it
   * is the model formatting a chat reply as a document, and nobody chats in a
   * numbered list. Take it off, then decide.
   */
  const spoken = lines.map(unnumber).filter(Boolean);

  const listish =
    spoken.filter((l) => /\S+\s*:\s*\S/.test(l)).length >= Math.ceil(spoken.length * 0.6);
  if (listish) return [spoken.join('\n')];
  if (spoken.length === 0) return [body];
  if (spoken.length === 1) return [spoken[0]!];

  const lineCap = budget?.bubbles ?? 3;
  if (spoken.length <= lineCap) return spoken;
  // Past the budget the tail rides along with the last bubble, so nothing is
  // lost and the thread is not flooded.
  return [...spoken.slice(0, lineCap - 1), spoken.slice(lineCap - 1).join('\n')];
}

/**
 * Takes the "1." or "-" off the front of a chat line.
 *
 * Only ever applied to lines that are about to become their own message, so a
 * genuine numbered list - which stays one block - keeps its numbering.
 */
function unnumber(line: string): string {
  /*
   * `1.` `1)` `1]` `1:` and the bullets. The colon matters: a model writing
   * "1: hey" was both numbered and colon'd, which used to read as a list.
   *
   * Anchored to a digit, so "Chetan: 8 aam" - a label, which is content - is
   * never touched.
   */
  return line.replace(/^\s*(?:\(?\d{1,2}[.):\]]|[-*•–])\s*/, '').trim();
}

export function shapeReply(text: string, length: string): string {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (length === 'detailed') return cleaned.slice(0, 4000);

  /*
   * Enough for a real answer, not enough for a lecture.
   *
   * This was two lines and 140 characters, which deleted the back half of any
   * multi-part answer. Then it was six and 600, which let genuine rambling
   * through - and a reply nobody finishes reading is a reply that failed. 320
   * still holds the four-line answer that started this (about ninety
   * characters) with room to spare, and stops the wall.
   *
   * The prompt is what asks for brevity; this is only the ceiling.
   */
  const maxLines = length === 'balanced' ? 8 : 6;
  const maxChars = length === 'balanced' ? 900 : 320;

  if (cleaned.length <= maxChars && cleaned.split('\n').length <= maxLines) return cleaned;

  const kept: string[] = [];
  let used = 0;
  for (const line of cleaned.split('\n').filter(Boolean)) {
    if (kept.length >= maxLines) break;
    // +1 for the newline this line will be joined with.
    if (used + line.length + 1 > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }

  /*
   * A first line longer than the whole budget is the one case with nothing
   * whole to keep. Stop at the last sentence end, and only at a space if there
   * is no sentence - anything rather than the middle of a word.
   */
  if (kept.length === 0) {
    const head = cleaned.slice(0, maxChars);
    const stop = Math.max(
      head.lastIndexOf('. '),
      head.lastIndexOf('! '),
      head.lastIndexOf('? '),
    );
    if (stop > maxChars * 0.4) return head.slice(0, stop + 1).trim();
    const space = head.lastIndexOf(' ');
    return `${(space > 0 ? head.slice(0, space) : head).trim()}…`;
  }

  return kept.join('\n').trim();
}
