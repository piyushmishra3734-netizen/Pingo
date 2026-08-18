/**
 * The scaffolding must not reach the thread.
 *
 * PINGO asks its model to answer as `{"reply": "...", "ask": "..."}`. When the
 * model runs out of tokens mid-sentence there is no closing brace, the parser
 * gave up, and the raw envelope was posted as the message. These are the actual
 * strings that went into real conversations, taken from the database.
 *
 * Run with `pnpm verify:reply-envelope`.
 */
import {
  salvageTruncatedEnvelope,
  trimEnvelopeDebris,
} from '../../../supabase/functions/ai-chat/reply-shape.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const salvages = (input: string, startsWith: string) => {
  const got = salvageTruncatedEnvelope(input);
  check(
    got !== undefined && got.startsWith(startsWith),
    `salvages "${startsWith.slice(0, 40)}…"${got === undefined ? ' (got undefined)' : ''}`,
  );
  check(
    got === undefined || !got.includes('{"reply"') && !got.includes('"reply"'),
    '  …and no envelope survives in it',
  );
};

console.log('\n--- real truncated replies from production ---');
salvages(
  '{"reply":"Abhi tak koi complete mathematical proof nahi mila; Riemann Hypothesis ke non-trivial zeros ki real part 1/2 hone ki conjecture hai',
  'Abhi tak koi complete',
);
salvages('{ "reply":"Haan, a', 'Haan, a');
salvages('{"reply":"Main backend ka data share karta hoon taaki aapko poora context mil', 'Main backend');
salvages(
  '{ "reply":"do particle ko consider karo jo har waqt ek hi feeling share karte hain\nagar ek particle ki spin up ho jaye',
  'do particle ko consider',
);

console.log('\n--- escapes and embedded quotes ---');
check(
  salvageTruncatedEnvelope('{"reply":"line one\nline two') === 'line one\nline two',
  'newline escape becomes a newline',
);
check(
  salvageTruncatedEnvelope('{"reply":"usne kaha \\"nahi\\" aur chala gaya') ===
    'usne kaha "nahi" aur chala gaya',
  'an escaped quote does not end the string early',
);
check(
  salvageTruncatedEnvelope('{"reply":"complete answer","ask":"aur?"}') === 'complete answer',
  'a complete envelope stops at the closing quote',
);

console.log('\n--- must pass through untouched ---');
check(salvageTruncatedEnvelope('Haan bhai, bilkul!') === undefined, 'plain prose is not an envelope');
check(salvageTruncatedEnvelope('') === undefined, 'empty string');
check(
  salvageTruncatedEnvelope('{ this is not json at all') === undefined,
  'a brace with no reply key',
);

console.log('\n--- trailing debris, as it actually appeared ---');
check(
  trimEnvelopeDebris('Chat karna toh bahut aasan hai: Ab kya chahte hain? " ""') ===
    'Chat karna toh bahut aasan hai: Ab kya chahte hain?',
  'strips the stray closing quotes',
);
check(
  trimEnvelopeDebris('Total: 8 + 4 + 6 = 18 Aam ""') === 'Total: 8 + 4 + 6 = 18 Aam',
  'strips a bare double quote pair',
);
check(
  trimEnvelopeDebris('usne kaha "nahi"') === 'usne kaha "nahi"',
  'a real quotation at the end survives',
);
check(trimEnvelopeDebris('Haan bhai!') === 'Haan bhai!', 'ordinary text is untouched');

console.log(failures === 0 ? '\nAll envelope checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
