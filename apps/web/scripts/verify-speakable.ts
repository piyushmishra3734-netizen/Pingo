/**
 * Characters are the bill, so characters are what gets checked.
 *
 * Bulbul charges per character. Everything stripped here is a character that
 * was paid for and produced either silence or a noise nobody wanted - and the
 * failure in the other direction is worse: strip a real word and PINGO says
 * something other than what is on screen.
 *
 * Run with `pnpm verify:speakable`.
 */
import { speakableOnly } from '../../../supabase/functions/tts/speakable.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('\n--- billed characters that are not speech ---');

const drops: [string, string, string][] = [
  ['**haan bhai** sab badhiya', 'haan bhai sab badhiya', 'markdown emphasis'],
  ['dekho `code` yahan', 'dekho code yahan', 'code marks'],
  ['link yahan hai https://example.com/a/b?c=d ok', 'link yahan hai ok', 'bare URL'],
  ['[Sarvam docs](https://docs.sarvam.ai/pricing) padho', 'Sarvam docs padho', 'link keeps label'],
  ['badhiya hai 👍🏽 bhai', 'badhiya hai bhai', 'emoji with skin tone'],
  ['# Heading\n> quote', 'Heading quote', 'heading and quote marks'],
];

for (const [input, want, what] of drops) {
  const got = speakableOnly(input);
  check(got === want, `${what}: "${got}"${got === want ? '' : ` (wanted "${want}")`}`);
}

console.log('\n--- speech survives untouched ---');

const keeps = [
  'कोई बात नहीं, तुम बताओ क्या चल रहा है।',
  'Haan bhai, kal 5 baje milte hain. Theek hai?',
  'ye 2+2 = 4 hai, aur 50% off bhi hai!',
];

for (const text of keeps) {
  const got = speakableOnly(text);
  check(got === text, `unchanged: "${text.slice(0, 40)}…"`);
}

console.log('\n--- the saving is real ---');
const reply = '**Dekho** bhai 😄, poora detail yahan hai: https://example.com/very/long/path/1234567890';
const saved = reply.length - speakableOnly(reply).length;
check(saved > 40, `${saved} characters not billed on one reply`);

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
