/**
 * The one decision in image generation that has a right answer.
 *
 * Everything downstream - the provider call, the upload, the message - either
 * works or throws where you can see it. Whether "draw a conclusion" is a
 * request for a picture is the part that fails silently and in both directions,
 * so it is the part with a test.
 *
 * Run with `pnpm verify:image-intent`.
 */
import { imagePrompt } from '../../../supabase/functions/ai-chat/image-intent.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const wants = (body: string, expected: string) => {
  const got = imagePrompt(body);
  check(got === expected, `"${body}" -> "${expected}"${got === expected ? '' : ` (got ${got})`}`);
};

const ignores = (body: string) => {
  const got = imagePrompt(body);
  check(got === undefined, `"${body}" is not an image request${got === undefined ? '' : ` (got "${got}")`}`);
};

console.log('\n--- slash commands ---');
wants('/imagine a red bicycle in the rain', 'red bicycle in the rain');
wants('/draw sunset over Mumbai', 'sunset over Mumbai');
wants('/img a cat wearing sunglasses', 'cat wearing sunglasses');

console.log('\n--- english ---');
wants('draw me a picture of a horse', 'horse');
wants('can you generate an image of a snowy mountain', 'snowy mountain');
wants('make a wallpaper of deep space', 'deep space');
wants('please create some artwork showing a lighthouse', 'lighthouse');

console.log('\n--- hinglish ---');
wants('ek cat ka photo banao', 'cat');
wants('mujhe sunset ki tasveer bana do', 'sunset');
wants('lion ka image bana', 'lion');
wants('pahado ka wallpaper banade yaar', 'pahado');

console.log('\n--- hinglish, as actually typed ---');
// Real messages from the thread that used to fall through to the chat model.
// "genrate ker" is not a typo worth correcting, it is how it gets typed.
wants('ek random image genrate ker', 'random');
wants('cat ka photo generate karo', 'cat');
wants('sunset ka image bana kar do', 'sunset');
wants('dog ki picture nikal do', 'dog');

// A clause after the verb describes the picture too, and used to be dropped.
wants('ek red bicycle ka photo banao jo baarish mein deewar se tiki ho',
  'red bicycle jo baarish mein deewar se tiki ho');
wants('cat ka photo banao jo hass raha ho', 'cat jo hass raha ho');

console.log('\n--- must not fire ---');
// The making verbs without a picture word. These are the false positives that
// would replace an answer with an oil painting.
ignores('draw a conclusion from this data');
ignores('make a list of my meetings');
ignores('create an account for me');
ignores('can you generate some ideas');
// Ordinary conversation that happens to contain the nouns.
ignores('did you see the photo I sent');
ignores('send me that picture again');
ignores('mera photo kahan gaya');
ignores('hey how are you');
ignores('');
// Too short to be worth a provider call.
ignores('/imagine');
ignores('/draw a');

console.log(failures === 0 ? '\nAll image-intent checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
