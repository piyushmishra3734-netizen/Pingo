/**
 * The model's working-out must not be the message.
 *
 * Every "leaks" case below is a real assistant message from the database. They
 * read as PINGO parroting whatever you just said, because the trace quotes you
 * inside it - it is not parroting, it is thinking out loud into the thread.
 *
 * The "survives" cases matter just as much: a reply that quotes you while
 * genuinely answering is a good reply, and an over-eager stripper would delete
 * it.
 *
 * Run with `pnpm verify:reasoning-leak`.
 */
import { stripReasoning } from '../../../supabase/functions/ai-chat/reply-shape.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const leaks = (input: string, label: string) => {
  const got = stripReasoning(input);
  const clean =
    !/here'?s a thinking process|we need to|the user (sent|wrote|asks)|analyze user input/i.test(got);
  check(clean, `strips: ${label}${clean ? '' : ` (left "${got.slice(0, 60)}…")`}`);
};

const survives = (input: string, label: string) => {
  const got = stripReasoning(input);
  check(got === input.trim(), `keeps: ${label}${got === input.trim() ? '' : ` (became "${got.slice(0, 60)}…")`}`);
};

console.log('\n--- real leaks from production ---');
leaks(
  'Here\'s a thinking process:\n1. Analyze User Input: - User sent: `"theek hai bhai"` - This is the latest message in the conversation.\n\nTheek hai bhai, batao aage kya karna hai',
  'thinking process + numbered plan',
);
leaks(
  'We need to interpret the latest user message: "4 mese kons aoption shi hai". They ask "Which option is good after 4 months".\n\nOption B sabse better hai.',
  'we need to interpret',
);
leaks(
  'We need to follow rules: answer the latest message. The user wrote "@pingoai tujhe kaise malum? " That\'s a question.\n\nMujhe tumhare messages se pata chala.',
  'we need to follow rules',
);
leaks(
  'We need to parse the user message: "@pingoai lekin ek user ko tumhare backend ki data ki need nhi hai"',
  'we need to parse (all trace, nothing after)',
);

console.log('\n--- answer is kept when there is one ---');
check(
  stripReasoning(
    'Here\'s a thinking process:\n1. Analyze User Input\n\nOption B sabse better hai bhai.',
  ) === 'Option B sabse better hai bhai.',
  'the answer after the trace survives intact',
);
check(
  stripReasoning('<think>hmm let me see</think>Haan bilkul, chalo karte hain.') ===
    'Haan bilkul, chalo karte hain.',
  'tagged reasoning is removed, answer kept',
);
check(
  stripReasoning('<think>ran out of room mid thought') === '',
  'an unterminated think block leaves nothing',
);

console.log('\n--- ordinary replies must be untouched ---');
survives(
  'Ispe seedha try: "ye mujhe hee bass reply kyu de rha hai?" — main clear answer dena chahta hoon. Ek line me thoda specific kar do?',
  'a reply that quotes the user while answering',
);
survives('Haan bhai, bilkul sahi!', 'plain reply');
survives('Plants use sunlight to turn carbon dioxide and water into glucose and oxygen.', 'a factual answer');
survives('We can do that tomorrow if you want.', 'starts with "We" but is not a trace');
survives('Let me know if that helps.', 'starts with "Let me" but is not a trace');
survives('', 'empty stays empty');

console.log(failures === 0 ? '\nAll reasoning-leak checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
