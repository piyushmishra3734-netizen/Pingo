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

  const lines = unpackInlineList(body)
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
/**
 * Puts an enumerated list that was written on one line onto its own lines.
 *
 * Seen live: `Ab kya? 1. Baat karna chahte ho? 2. Kuch aur puchhna?` - one
 * line, so the per-line strip below never saw it and the numbers shipped. A
 * model told not to number will still do it inline, because inline does not
 * look like a list to it.
 *
 * Requires two of them, which is what makes it a list rather than a date or a
 * price. "aaj 1. tarikh hai" has one and is left alone.
 */
function unpackInlineList(text: string): string {
  const marks = text.match(/(?:^|\s)\d{1,2}[.)]\s+\S/g) ?? [];
  if (marks.length < 2) return text;
  return text.replace(/\s+(\d{1,2}[.)]\s+)/g, '\n$1');
}

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

/**
 * Rescue the reply out of a JSON envelope the model never finished.
 *
 * ## The bug this exists for
 *
 * The models are asked to answer as `{"reply": "...", "ask": "..."}`, and the
 * parser found that object by taking everything between the first `{` and the
 * last `}`. A model that hits its token ceiling mid-sentence never writes the
 * closing brace, so there was no last `}`, so the parse returned nothing, so
 * the raw text was posted as the message. Four of these went into real threads:
 *
 *   {"reply":"Abhi tak koi complete mathematical proof nahi mila; Riemann…
 *
 * Every leaked one is cut off mid-string, which is the whole tell. It is not
 * the model misbehaving - it answered correctly and ran out of room, and the
 * envelope is the app's own scaffolding leaking through.
 *
 * ## What it does
 *
 * Takes the value of the first `reply`/`message` key and reads to the end of
 * the available text, honouring escapes so a quotation inside the answer does
 * not end it early. Truncation is expected here rather than guarded against -
 * the input is a sentence that stops mid-word, and half an answer is
 * enormously better than a brace and a key name.
 *
 * Returns undefined when the text is not an envelope at all, which is the
 * ordinary case: most replies are plain prose and must pass through untouched.
 */
export function salvageTruncatedEnvelope(text: string): string | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return undefined;

  const key = /"(?:reply|message)"\s*:\s*"/.exec(trimmed);
  if (!key) return undefined;

  let out = '';
  for (let i = key.index + key[0].length; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch === '\\') {
      const next = trimmed[i + 1];
      // The escapes a model actually emits. Anything else keeps its literal
      // character, which is closer to right than dropping it.
      out += next === 'n' ? '\n' : next === 't' ? '\t' : (next ?? '');
      i += 1;
      continue;
    }
    // An unescaped quote ends the string - the envelope was complete after all,
    // or at least this field was.
    if (ch === '"') break;
    out += ch;
  }

  const salvaged = out.trim();
  return salvaged.length > 0 ? salvaged : undefined;
}

/**
 * Strip the punctuation left behind when an envelope is peeled off badly.
 *
 * Replies were arriving with a stray tail - `Ab kya chahte hain? " ""` - which
 * is the closing quote of the JSON string plus the empty `ask` that followed
 * it, surviving because nothing looked at the end of the line. Five of those
 * went out.
 *
 * Only quotes, commas and braces, and only trailing: a reply that genuinely
 * ends in a quotation - "…and he said 'no'" - keeps its own punctuation because
 * the pattern needs a run of bare quote characters, not one closing a sentence.
 */
export function trimEnvelopeDebris(text: string): string {
  let out = text.trim();

  // A run of two or more quotes is never prose. This is the `" ""` tail that
  // was arriving: the envelope's closing quote followed by an empty `ask`.
  out = out.replace(/[s]*["'`]{2,}[s]*[,}]?[s]*$/g, '').trim();

  // Structural leftovers - a lone comma or brace - are never the end of a
  // sentence either.
  out = out.replace(/[s]*[,{}]+[s]*$/g, '').trim();

  /*
   * A single trailing quote only goes if nothing opened it.
   *
   * `usne kaha "nahi"` ends in a quote and must keep it; `Ab kya chahte hain? "`
   * ends in the envelope's. Counting is what tells them apart - an odd number
   * of quote characters means the last one has no partner - and the first
   * version of this stripped both, which quietly edited people's sentences.
   */
  if (/["`]$/.test(out)) {
    const quotes = (out.match(/["`]/g) ?? []).length;
    if (quotes % 2 === 1) out = out.replace(/[s]*["`]$/, '').trim();
  }

  return out;
}


/**
 * Cut the model's working-out off the front of its answer.
 *
 * ## What was reaching people
 *
 * These are real assistant messages, taken from the database:
 *
 *   Here's a thinking process:
 *   1. Analyze User Input: - User sent: `"theek hai bhai"` - This is the latest…
 *
 *   We need to interpret the latest user message: "4 mese kons aoption shi hai"…
 *
 *   We need to follow rules: answer the latest message. The user wrote "@pingoai…
 *
 * It reads as the assistant parroting whatever you just said, because the trace
 * quotes you inside it. It is not parroting - it is thinking out loud into the
 * thread. Same class as the JSON envelope: the app's own scaffolding, published.
 *
 * `'detailed thinking off'` is sent as a system message for exactly this and
 * plainly does not always take. A prompt is a request; this is the check.
 *
 * ## The rule
 *
 * Trace is a *prefix*. A model narrates its plan and then answers, so leading
 * lines that look like narration are dropped and whatever follows is kept.
 * Nothing is removed from the middle: a reply that happens to quote you in the
 * course of answering - "Ispe seedha try: 'ye mujhe hee bass reply kyu de rha
 * hai?' - main clear answer dena chahta hoon" - is a real answer and survives.
 *
 * Returns '' when the whole thing was trace, which is the truthful result and
 * lets the caller treat it as a failed generation rather than post the scraps.
 */

/** Openers that are the model addressing itself, never the person. */
const TRACE_LINE = [
  /^here'?s (a|my|the) (thinking|thought|reasoning) process/i,
  /^(okay|ok|alright|so|first)[,:]?\s+(let me|let's|i need to|we need to|i should|we should)\b/i,
  /^(we|i) (need|have) to\b/i,
  /^let me (analyze|think|break|consider|see|check|figure)/i,
  /^the user (sent|wrote|asks|asked|is asking|said|wants|means)/i,
  /^user (sent|wrote|asks|asked|said)/i,
  /^\d+\.\s*(analyze|understand|identify|consider|plan|check)\b/i,
  /^(thinking|analysis|reasoning|plan|thought process|step \d+)\s*:/i,
  /^(we|i) (must|should|can'?t|cannot|shouldn'?t|will|won'?t)\b/i,
  /^(note|important|remember|caveat)s*[:,]/i,
  /^(first|second|third|next|then|finally)s*[,:]/i,
  /^actually[,]?s+(after|the|it|we|i)\b/i,
  /^so (the|we|i)\b/i,
  /^(this|that) is the latest message/i,
  /^according to (the )?(rules|instructions|system)/i,
];

/**
 * The model talking *about* the conversation instead of taking part in it.
 *
 * Broadening the opener list one leaked message at a time is a losing game -
 * the openers are unbounded, and this arrived after the first pass shipped:
 *
 *   We must not repeat previous answer. The assistant previously responded:
 *   "Better: respond" to Baani's message? Actually after Baani's message…
 *
 * What every one of them has in common is not how it starts. It is that the
 * participants are referred to in the third person. A reply *to* somebody never
 * says "the assistant previously responded" or "the user hasn't yet" - only a
 * note written about the exchange does. That property is what is matched here,
 * anywhere in the text, and it holds for leaks that open in ways nobody has
 * seen yet.
 *
 * The phrases are kept narrow on purpose: each one pairs a participant with a
 * word about *responding*, so a genuine reply to "what is an AI assistant?"
 * does not trip it by containing the word "assistant".
 */
const TRACE_META = [
  /\bthe assistant (previously |already |then )?(responded|said|replied|answered|wrote|hasn'?t|has not|did not|didn'?t)\b/i,
  /\bthe user (said|wrote|asked|sent|hasn'?t|has not|wants|is asking|then said)\b/i,
  /\bwe (must|should|need to) not (repeat|say|answer|reply|mention)\b/i,
  /\bprevious (answer|response|reply|message) (was|is|said)\b/i,
  /\b(must not|should not) repeat (the )?previous\b/i,
  /\baccording to the (system|instructions|rules) (prompt|above|given)\b/i,
  /*
   * Reasoning about the *format* rather than the conversation.
   *
   * "We must not add extra text. So reply should be short chat lines... But
   * JSON string cannot contain newline?" - the model working out how to obey
   * the envelope instruction, out loud, into the thread. It arrives most on
   * questions about memory, because those add the largest block of
   * instructions to the prompt and the more rules there are the more likely
   * the model is to think about them instead of the person.
   */
  /\bwe (must|should|need to|can'?t|cannot) not? ?(add|include|output|write|use|exceed)\b/i,
  /\b(they|the prompt|the system) (said|says|wants|asked for|requires)\b/i,
  /\bjson (string|field|reply|object|format)\b/i,
  /\b(the )?(reply|response|answer) (field|format) (is|are|should|must|can|cannot|needs)\b/i,
  /\b(reply|response|answer) should be (a|an|the|short|one|single|plain|kept|separated)\b/i,
  /\b(safer|better) to keep (it )?as\b/i,
  /\b(single.line|multi.line) string\b/i,
];

/**
 * Deliberation, recognised by how much of it there is rather than by phrase.
 *
 * `TRACE_META` catches sentences that can only be a note about the exchange.
 * This catches the other half, which no list of phrases was ever going to:
 *
 *   So maybe "arre yaar, kya baat hai?" That's one line? Actually we can have
 *   multiple lines but each line separate thought. But must be short and match
 *   size. Their message length is moderate; we can answer with maybe 2 lines.
 *
 * Not one phrase there is damning on its own. "So maybe" is how anybody talks.
 * What gives it away is the pile: planning in the first person plural,
 * measuring the reply, weighing options aloud, all in English, in a chat that
 * is not conducted in English.
 *
 * So these are weighed rather than matched. One hit is a coincidence and is
 * ignored; two distinct ones is a model talking to itself. That threshold is
 * what lets the signals stay loose enough to catch shapes nobody has seen,
 * without a single innocent sentence tripping the whole reply.
 */
const DELIBERATION = [
  // Planning in the first person plural. PINGO speaks as "main", never "we".
  /\bwe (can|could|should|might|will|may) (have|answer|say|reply|use|do|give|keep|make|write|add)\b/i,
  // Measuring the reply instead of writing it.
  /\b(their|the user'?s|his|her) (message|reply|question) (length|is|was|seems)\b/i,
  /\b(must|should) be short and\b/i,
  /\bmatch (the )?size\b/i,
  /\b(one|two|three|d+) lines?\b.{0,40}\b(separate|each|maybe|about)\b/i,
  /\bseparate thought\b/i,
  // Weighing options aloud.
  /^(so )?maybe ["‘“]/im,
  /\bthat'?s (one|a) line\b/i,
  /^actually,? (we|i|it|that|the)\b/im,
  /^but (must|we|it should|that)\b/im,
  // Citing the instructions as a rule, which a reply to a person never does.
  /^(but |and |also )?rules*[:—-]/im,
  /\b(the )?(rule|instruction|system prompt) (says|said|is that)\b/i,
];

/** Two independent signals. One is a coincidence; two is a habit. */
const DELIBERATION_THRESHOLD = 2;

export function stripReasoning(text: string): string {
  /*
   * Tagged reasoning first, wherever it sits. An unterminated `<think>` is the
   * common shape - the model ran out of room inside it - so a missing closing
   * tag means everything after the opener goes.
   */
  let out = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/<\/think>/gi, '')
    .trim();

  const lines = out.split('\n');
  let start = 0;

  while (start < lines.length) {
    const line = lines[start]!.trim();
    // Blank lines between trace lines are part of the trace, but only once the
    // first one has been recognised - a reply may legitimately start blank.
    if (line === '' && start > 0) {
      start += 1;
      continue;
    }
    if (TRACE_LINE.some((re) => re.test(line))) {
      start += 1;
      continue;
    }
    break;
  }

  /*
   * Meta first, because it survives the prefix walk: "We must not repeat
   * previous answer." is not in the opener list and never will be reliably.
   *
   * Everything up to and including the last line that talks about the exchange
   * goes, and whatever is left is the reply. When nothing is left the whole
   * message was a note about the conversation, and '' is the truthful result -
   * the caller treats it as a failed generation rather than posting the scraps.
   */
  /*
   * Weighed before the line-by-line rules, because deliberation is a property
   * of the whole message rather than of any one line in it. Two signals and the
   * generation is the model talking to itself - there is no reply buried in it
   * to rescue, and '' sends it back for a second pass.
   */
  const signals = DELIBERATION.filter((re) => re.test(out)).length;
  if (signals >= DELIBERATION_THRESHOLD) return '';

  const metaAt = lines.reduce(
    (last, line, index) => (TRACE_META.some((re) => re.test(line)) ? index : last),
    -1,
  );
  if (metaAt >= 0) {
    const after = lines.slice(metaAt + 1).join('\n').trim();
    // A trailing fragment shorter than this is the tail of the note, not a
    // reply - "?" and "Then" and similar.
    return after.length > 12 ? after : '';
  }

  // Nothing was trace: the overwhelmingly common case, and it must cost nothing.
  if (start === 0) return out;

  out = lines.slice(start).join('\n').trim();

  /*
   * A numbered plan continues past its first line, and dropping only the
   * heading leaves "1. Analyze User Input: - User sent: …" as the message.
   * Once trace has been recognised, list items that are still narration go too.
   */
  const rest = out.split('\n');
  let from = 0;
  while (from < rest.length) {
    const line = rest[from]!.trim();
    if (line === '' || /^[-*\d.)\s]*(analyz|identif|understand|consider|check|the user|user )/i.test(line)) {
      from += 1;
      continue;
    }
    break;
  }

  return rest.slice(from).join('\n').trim();
}

/**
 * Lines the model copied out of its own instructions.
 *
 * ## Why this exists when there are already three other rules
 *
 * Because the other three are lists, and lists of phrases do not converge. Each
 * leak that got through arrived in a shape the previous list had no entry for -
 * an opener, then a third-person note, then deliberation with no quotable
 * phrase at all, and then this:
 *
 *   But rule: "A greeting or a one-word message gets one short
 *
 * That is the character prompt, quoted back. And a quotation is the one kind of
 * leak that can be recognised exactly rather than guessed at, because the text
 * it came from is sitting right there in the same function.
 *
 * So the reply is compared against the instructions that produced it. Anything
 * the model copied out of them is not a reply to anybody; it is the homework
 * showing through. No pattern to maintain, and it covers rules nobody has
 * written yet.
 *
 * ## Six words
 *
 * Short enough to catch a half-quoted rule, long enough that ordinary language
 * cannot collide with it by accident. Three words would flag "let me know if" in
 * a real reply; a whole sentence would miss every partial quotation, which is
 * what a truncated generation always produces.
 */
const SHINGLE = 6;

/** Comparison is on words alone: case, punctuation and quoting all vary. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= w.length; i += 1) {
    out.add(w.slice(i, i + SHINGLE).join(' '));
  }
  return out;
}

/**
 * Drop every line of `text` that quotes `instructions`.
 *
 * Line by line rather than all-or-nothing, because a generation often quotes one
 * rule and then answers properly underneath it - and throwing away a real answer
 * to remove a quotation would be trading one defect for a worse one.
 */
export function stripPromptEcho(text: string, instructions: string): string {
  if (!text.trim() || !instructions.trim()) return text;

  const known = shingles(instructions);
  if (known.size === 0) return text;

  const kept = text.split('\n').filter((line) => {
    // A short line cannot carry a six-word run, so it cannot be a quotation.
    if (words(line).length < SHINGLE) return true;
    for (const shingle of shingles(line)) {
      if (known.has(shingle)) return false;
    }
    return true;
  });

  return kept.join('\n').trim();
}
