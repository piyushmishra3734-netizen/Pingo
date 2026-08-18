/**
 * Telling PINGO's own voice from a person interrupting it.
 *
 * This is the single judgement a call cannot get wrong. Say yes too often and
 * a real interruption is ignored; say no too often and the microphone hearing
 * the speaker counts as somebody talking, PINGO stops itself mid-answer, and
 * the screen sits on "listening" with nobody in the room. The second is what
 * shipped: the regex inside had lost its backslashes, so `\p{L}` was the
 * letters p, L and N, every sentence reduced to nothing, and every echo was
 * judged to be a person.
 *
 * It fails silently - a broken matcher still returns a boolean - which is
 * exactly the kind of thing that needs a test rather than a reading.
 *
 * Run with `pnpm verify:echo`.
 */
import { isEcho } from '../src/features/ai/echo.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('\n--- the microphone hearing PINGO ---');

/** [what PINGO is saying, what came back from the transcriber] */
const echoes: [string, string][] = [
  ['Haan bolo, kya chal raha hai dimaag mein?', 'haan bolo kya chal raha hai dimaag mein'],
  // Transcripts of played-back speech are never exact - endings drop, commas
  // vanish, a word is misheard. Half the words matching is still an echo.
  ['Haan bolo, kya chal raha hai dimaag mein?', 'haan bolo kya chal raha tha'],
  ['कोई बात नहीं, तुम बताओ क्या चल रहा है।', 'कोई बात नहीं तुम बताओ'],
];

for (const [speaking, heard] of echoes) {
  check(isEcho(heard, speaking), `echo: "${heard.slice(0, 38)}…"`);
}

console.log('\n--- a person actually interrupting ---');

const interruptions: [string, string][] = [
  ['Haan bolo, kya chal raha hai dimaag mein?', 'ruko ruko yaar'],
  ['Haan bolo, kya chal raha hai dimaag mein?', 'nahi mujhe kuch aur poochna tha'],
  ['कोई बात नहीं, तुम बताओ क्या चल रहा है।', 'ek minute suno'],
];

for (const [speaking, heard] of interruptions) {
  check(!isEcho(heard, speaking), `interruption: "${heard}"`);
}

console.log('\n--- the edges ---');
check(!isEcho('anything', ''), 'nothing being said cannot be echoed');
check(isEcho('', 'PINGO is talking'), 'an empty transcript is not a person');

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
