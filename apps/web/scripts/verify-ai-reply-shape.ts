/**
 * The formatter that was throwing PINGO AI's answers away.
 *
 * `shapeReply` trims a model reply to the length the user asked for. On the
 * default setting it kept the first *two lines* and 140 characters, and cut
 * mid-word past that. Ask a question with three numbers in it and the third was
 * simply deleted - the model answered correctly and the app published half of
 * it, which reads as an assistant that cannot reason rather than as a formatter
 * that amputated the reasoning.
 *
 * Measured, not guessed: asked live, PINGO AI replied "Chetan: 8 Aam / Bina: 4
 * Aam (Chetan se aadhe)" and stopped - exactly two lines, with Amit and the
 * total cut off.
 *
 * The function is pure and lives beside the Edge Function that uses it, so it
 * can be imported here directly - the module it used to live in pulls in Deno
 * globals that will not load under Node.
 *
 * Run with `pnpm verify:ai-reply-shape`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  replyBudget,
  shapeReply,
  splitIntoBubbles,
} from '../../../supabase/functions/ai-chat/reply-shape.js';

// -- A complete answer survives the default setting ------------------------

const answer = [
  'Chetan: 8 aam',
  'Bina: 4 aam (Chetan se aadhe)',
  'Amit: 6 aam (Bina se 2 zyada)',
  'Total: 18 aam',
].join('\n');

const short = shapeReply(answer, 'short');
assert.ok(short.includes('Amit'), 'the third person is not deleted');
assert.ok(short.includes('Total'), 'nor is the total');
assert.equal(short, answer, 'a reply that fits is left exactly alone');

// -- Nothing is ever cut inside a word -------------------------------------

const rambling = Array.from({ length: 40 }, (_, i) => `Line number ${i} of some reply`).join(
  '\n',
);
for (const length of ['short', 'balanced'] as const) {
  const out = shapeReply(rambling, length);
  assert.ok(out.length > 0, `${length} keeps something`);
  // Every line kept is a whole line from the original.
  for (const line of out.split('\n')) {
    assert.ok(
      rambling.split('\n').includes(line),
      `${length} keeps whole lines - "${line}" is a fragment`,
    );
  }
}

/*
 * One line longer than the entire budget is the only case with nothing whole to
 * keep. It stops at a sentence if there is one and at a space if there is not -
 * the old code cut at exactly 137 characters, wherever that landed.
 */
const oneLongLine = `${'alpha bravo charlie '.repeat(60)}end.`;
const cut = shapeReply(oneLongLine, 'short');

/*
 * The real property, rather than "does it end in an ellipsis": whatever is kept
 * has to be a prefix of what the model actually said, ending on a word it
 * finished. The old code cut at exactly 137 characters, which lands wherever it
 * lands - "charl…" is what that produces.
 */
const body = cut.replace(/…$/, '').trim();
assert.ok(oneLongLine.startsWith(body), 'what is kept is a prefix of the reply');
assert.ok(
  oneLongLine[body.length] === undefined || /\s|\./.test(oneLongLine[body.length]!),
  `the cut lands on a word boundary, not inside "${body.slice(-12)}"`,
);
assert.ok(cut.length <= 340, 'and still respects the budget');

// -- The budgets are short, and short is not two lines ---------------------

const four = ['one', 'two', 'three', 'four'].join('\n');
assert.equal(shapeReply(four, 'short'), four, 'four short lines fit the short setting');

// `detailed` is untouched: it was never the broken one.
const long = 'x'.repeat(5000);
assert.equal(shapeReply(long, 'detailed').length, 4000);

// -- A group keeps its people apart ----------------------------------------

/*
 * Every human in a group is `role: 'user'`, and `collapseHistory` merged
 * consecutive same-role turns. So Baani's line and Eddy's reply to it became
 * one message, and the model - shown a single speaker saying both - attributed
 * one person's words to the other. That is the mix-up as reported.
 *
 * Read out of the source and evaluated, because this one is not worth its own
 * module: it is nine lines and it lives next to what uses it.
 */
const source = await readFile(
  // Run from the repo root - see the `verify:ai-reply-shape` script.
  resolve(process.cwd(), 'supabase/functions/ai-chat/index.ts'),
  'utf8',
);

const start = source.indexOf('function collapseHistory(');
assert.notEqual(start, -1, 'collapseHistory still exists');
const collapseSrc = source
  .slice(start, source.indexOf('\n}', start) + 2)
  // Strip the TypeScript so `new Function` will take it.
  .replace(/: \{[^}]*\}\[\]/g, '')
  .replace(/\): \{[^}]*\}\[\] \{/, ') {')
  .replace(/const out\s*=/, 'const out =');

const collapseHistory = new Function(`${collapseSrc}; return collapseHistory;`)() as (
  h: { role: 'user' | 'assistant'; content: string; speaker?: string }[],
) => { role: string; content: string; speaker?: string }[];

const groupTurns = [
  { role: 'user' as const, content: 'Baani: kal chalein?', speaker: 'Baani' },
  { role: 'user' as const, content: 'Eddy: mujhe tution hai', speaker: 'Eddy' },
  { role: 'user' as const, content: 'Eddy: shaam ko free hoon', speaker: 'Eddy' },
];

const collapsed = collapseHistory(groupTurns);
assert.equal(collapsed.length, 2, 'two speakers stay two turns');
assert.ok(collapsed[0]!.content.includes('Baani'), 'the first turn is Baani alone');
assert.ok(!collapsed[0]!.content.includes('Eddy'), 'Eddy is not merged into Baani');
assert.ok(
  collapsed[1]!.content.includes('tution') && collapsed[1]!.content.includes('shaam'),
  "one person's consecutive lines still merge - that part was right",
);

// A direct chat has no speakers, and must behave exactly as before.
const direct = [
  { role: 'user' as const, content: 'hi' },
  { role: 'user' as const, content: 'you there?' },
];
assert.equal(collapseHistory(direct).length, 1, 'a one-to-one run still collapses');

// -- The format labels never reach the thread ------------------------------

/*
 * The reply/ask split is asked for as `<<<REPLY>>>`, and a model will sometimes
 * write the label plainly instead - "Reply" on its own line, the answer, then
 * "Ask". Only the angle-bracket form was recognised, so the word shipped as
 * part of the message: the chat list read `PINGO: Reply Chetan: 8 Aam…`, seen
 * live right after the model changed.
 */
const stripStart = source.indexOf('function stripMarkers(');
assert.notEqual(stripStart, -1, 'stripMarkers still exists');
const stripSrc = source
  .slice(stripStart, source.indexOf('\n}', stripStart) + 2)
  .replace(/\(text: string\): string/, '(text)');

const stripMarkers = new Function(`${stripSrc}; return stripMarkers;`)() as (
  t: string,
) => string;

assert.equal(stripMarkers('Reply\nChetan: 8 aam\nAsk').trim(), 'Chetan: 8 aam');
assert.equal(stripMarkers('<<<REPLY>>>\nhi\n<<<ASK>>>').trim(), 'hi');

/*
 * And a reply that genuinely starts with the word is left alone - the label is
 * only a label when it is the whole line.
 */
assert.ok(
  stripMarkers('Reply karo bhai, main wait kar raha hoon').includes('Reply karo'),
  'a real sentence beginning "Reply" survives',
);
assert.ok(
  stripMarkers('Ask me anything').includes('Ask me'),
  'and so does one beginning "Ask"',
);

// -- Chat arrives as a few short messages, not one block -------------------

/*
 * Somebody saying hello sends "hey", then "kaise ho", then "kya kar rahe ho" -
 * separate bubbles. The assistant wrote the same thoughts as one paragraph,
 * which is correct and joyless to read.
 */
assert.deepEqual(
  splitIntoBubbles('hey\nkaise ho\nkya kar rahe the', 'short'),
  ['hey', 'kaise ho', 'kya kar rahe the'],
  'three thoughts become three messages',
);

// One thought stays one message.
assert.deepEqual(splitIntoBubbles('haan bilkul', 'short'), ['haan bilkul']);

/*
 * The case that actually happens: the model ignores "one thought per line" and
 * writes one sentence-packed line. Asked "hello, kaisa hai, khana khaya?" it
 * replied with all three in a single line - so the break is made here, on
 * sentence ends, rather than waiting for formatting that does not arrive.
 */
const oneLine =
  'Hey bhai! Main theek hoon, tere questions solve kar raha tha. Khana abhi nahi khaya, tere saath chat mein busy tha!';
const asBubbles = splitIntoBubbles(oneLine, 'short');
assert.ok(asBubbles.length >= 2, 'a packed line becomes several messages');
assert.ok(asBubbles.length <= 3, 'and never more than three');
assert.equal(
  asBubbles.join(' ').replace(/\s+/g, ' '),
  oneLine.replace(/\s+/g, ' '),
  'nothing is added or lost in the split',
);
assert.ok(asBubbles[0]!.startsWith('Hey bhai!'), 'the first bubble is the greeting');

// A short one is one message however it is punctuated.
assert.deepEqual(splitIntoBubbles('haan. bilkul.', 'short'), ['haan. bilkul.']);

/*
 * Told "one thought per line", a model numbers them - and the old list test
 * counted a leading digit as evidence of a list, so "1. hey / 2. kaise ho" was
 * kept as one block with the numbering still on it. Nobody chats in an
 * enumerated list.
 */
assert.deepEqual(
  splitIntoBubbles('1. hey\n2. kaise ho\n3. khana khaya?', 'short'),
  ['hey', 'kaise ho', 'khana khaya?'],
  'numbered chat lines become plain messages',
);
assert.deepEqual(
  splitIntoBubbles('- hey\n- kaise ho', 'short'),
  ['hey', 'kaise ho'],
  'and so do bulleted ones',
);

// A real list - a label and a value - keeps its shape and its formatting.
assert.deepEqual(
  splitIntoBubbles('Chetan: 8 aam\nBina: 4 aam\nAmit: 6 aam', 'short'),
  ['Chetan: 8 aam\nBina: 4 aam\nAmit: 6 aam'],
  'a labelled list stays one message',
);

/*
 * A list is not chatting. Four bubbles of arithmetic is its own kind of
 * unpleasant, so lines that look like list items stay together.
 */
assert.deepEqual(
  splitIntoBubbles(answer, 'short'),
  [answer],
  'a list of facts stays as one message',
);

// Past three thoughts the tail rides along, so the thread is not flooded.
const many = ['one', 'two', 'three', 'four', 'five'].join('\n');
const split = splitIntoBubbles(many, 'short');
assert.equal(split.length, 3, 'never more than three bubbles');
assert.equal(split.join('\n'), many, 'and nothing is dropped');

// `detailed` is a written answer, not a conversation.
assert.deepEqual(splitIntoBubbles('a\nb\nc', 'detailed'), ['a\nb\nc']);

// -- The reply is sized by the message it answers --------------------------

/*
 * The splitter broke up whatever the model wrote, so "ok" got three bubbles the
 * same as a real question did. A person does not answer "haan?" with a
 * paragraph, and three bubbles for a one-word message is what makes an
 * assistant exhausting instead of useful.
 */
const chatty = 'Hey there! Main bilkul theek hoon. Aaj kaafi busy tha kaam mein. Tum sunao kya chal raha hai?';

assert.deepEqual(
  splitIntoBubbles(chatty, 'short', 'ok').length,
  1,
  'a one-word message gets one bubble back',
);
assert.deepEqual(
  splitIntoBubbles(chatty, 'short', 'hmm').length,
  1,
  'and so does a grunt',
);

assert.ok(
  splitIntoBubbles(chatty, 'short', 'tu kaisa hai? kya kar raha tha?').length > 1,
  'a real question gets room to answer',
);

// The budget itself, stated plainly.
assert.deepEqual(replyBudget('ok'), { bubbles: 1, chars: 120 });
assert.equal(replyBudget('tu kya kar raha hai?').bubbles, 3, 'a question earns the most room');
assert.equal(
  replyBudget('aaj bahut acha din tha yaar sab kuch theek raha').bubbles,
  2,
  'a statement earns some, not all',
);

// Without a message the old behaviour is unchanged - nothing else had to move.
assert.deepEqual(splitIntoBubbles('hey\nkaise ho\nkya kar rahe the', 'short').length, 3);

// -- No follow-up question nobody asked for --------------------------------

/*
 * When the model produced no question, the app invented one - "Aur bata? 😊" -
 * so every reply ended with a second bubble asking something nobody wanted
 * answered. A message a person did not send and does not read, appended to
 * every message the assistant ever sent.
 */
assert.ok(
  !source.includes("shapeAsk('Aur bata?"),
  'the default follow-up is not invented any more',
);
assert.match(
  source,
  /\n\s*ask: '',/,
  'no question means no second bubble',
);

// -- There is a character, and it is shown rather than described -----------

/*
 * The prompt had one line about voice - "Voice: friendly, still actually
 * answer" - and nothing about feeling. Rules about length and none about mood
 * is how an assistant ends up answering like a form.
 *
 * The character is elizaOS's shape (bio, adjectives, style, messageExamples)
 * without elizaOS - the runtime is an agent framework with a database, a
 * plugin system and node built-ins, 14 MB unpacked; the character file is data
 * and is the part that decides whether it reads as a person.
 */
const character = await readFile(
  resolve(process.cwd(), 'supabase/functions/ai-chat/character.ts'),
  'utf8',
);

for (const field of ['bio', 'adjectives', 'style', 'moods', 'messageExamples']) {
  assert.match(character, new RegExp(`\\b${field}\\b`), `the character has ${field}`);
}

/*
 * The whole range, not just the pleasant end. A character that can only be warm
 * is a customer service voice, and people can tell instantly - somebody who
 * cannot be annoyed, cannot disagree and cannot be bored has nothing at stake.
 */
for (const feeling of ['Annoyed', 'Frustrated', 'Bored', 'Firm', 'Sarcastic']) {
  assert.match(character, new RegExp(feeling), `it can be ${feeling.toLowerCase()}`);
}

/*
 * And the line that keeps the range usable. An assistant that insults its user
 * is not spirited, it is a product nobody opens twice - so the range is aimed
 * at the situation and never at the person. This is a safety property, not a
 * style note, which is why it is asserted rather than left in a comment.
 */
assert.match(
  character,
  /never turn on them/i,
  'the hard line is stated: annoyed at the situation, never at the person',
);
assert.match(character, /No insults, no contempt/i, 'and spelled out');
assert.match(
  character,
  /## What you feel/,
  'the moods reach the prompt text, not just the data',
);

/*
 * The examples are the part a model copies, so there have to be enough of them
 * to cover the cases it kept getting wrong - a greeting answered at length, a
 * vent answered with advice, a one-word message answered with a paragraph.
 */
const exampleTurns = (character.match(/from: 'them'/g) ?? []).length;
assert.ok(exampleTurns >= 8, `tone is shown, not described - found ${exampleTurns} turns`);

/*
 * And they are whole exchanges, which is elizaOS's own shape
 * (`MessageExample[][]`). A single pair only teaches how the character opens;
 * a three-turn exchange teaches what it does when the first answer was not
 * enough, which is exactly where an assistant reverts to being an assistant.
 */
const multiTurn = (character.match(/from: 'them'[\s\S]{0,400}?from: 'you'[\s\S]{0,400}?from: 'them'/g) ?? [])
  .length;
assert.ok(multiTurn >= 2, `some examples run past the first reply - found ${multiTurn}`);

// And it is actually in the prompt, before the mechanics.
assert.match(source, /characterPrompt\(\)/, 'the character is folded into the system prompt');
const charAt = source.indexOf('characterPrompt(),');
const rulesAt = source.indexOf('## GENERAL REASONING');
assert.ok(charAt !== -1 && charAt < rulesAt, 'who you are comes before how you operate');

// -- The request outranks the persona --------------------------------------

/*
 * The directive was a stack of tone rules with the actual request somewhere
 * inside it, and the model answered the vibe rather than the question. What
 * somebody asked for is not one input among many.
 */
const directive = source.slice(source.indexOf('function buildFocusDirective('));
const rule0 = directive.indexOf('RULE 0 — DO WHAT THEY ASKED.');
const toneRules = directive.indexOf('HOW TO WRITE IT');
assert.notEqual(rule0, -1, 'the directive leads with the request');
assert.ok(rule0 < toneRules, 'and it comes before anything about tone');

console.log('ai reply shape: ok');
