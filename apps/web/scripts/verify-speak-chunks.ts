/**
 * Where a spoken reply is allowed to be cut.
 *
 * The pipeline plays each chunk while fetching the next, so every boundary is a
 * pause somebody hears. A cut at a full stop is inaudible; a cut inside a word
 * is the one mistake nobody forgives, and it is the one a naive `slice` makes.
 *
 * Run with `pnpm verify:speak-chunks`.
 */
import { chunkForSpeech } from '../src/features/chat/speak.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const noWordSplit = (chunks: string[], original: string) => {
  // Rejoined, the chunks must be the original text again apart from where the
  // whitespace was.
  const flat = (s: string) => s.replace(/\s+/g, '');
  return flat(chunks.join('')) === flat(original);
};

console.log('\n--- nothing is lost, ever ---');
for (const text of [
  'Haan bhai, sab badhiya hai. Tum sunao kya chal raha hai? Kal milte hain phir.',
  'कोई बात नहीं। तुम बताओ क्या चल रहा है।',
  'quantum computing ke basic idea ko ek sikka uchalne se samjhte hain, ek normal bit sirf 0 ya 1 ho sakta hai jaise sikka niche ya upar, lekin qubit dono ek saath ho sakta hai jab tak tum dekh na lo, aur yahi superposition hai jo isse itna alag banata hai',
  'Ek lamba jumla bina kisi viraam chinh ke jo bahut door tak chalta rehta hai aur kahin bhi rukta nahi hai isliye ise kahin na kahin todna hi padega warna ek hi chunk mein poora aa jayega jo bahut lamba ho jayega',
]) {
  const chunks = chunkForSpeech(text);
  check(noWordSplit(chunks, text), `nothing dropped: "${text.slice(0, 42)}…"`);
  check(
    chunks.every((c) => c.length <= 900),
    `  every chunk within budget (longest ${Math.max(0, ...chunks.map((c) => c.length))})`,
  );
  check(
    chunks.every((c) => c.trim().length > 0),
    '  no empty chunks',
  );
}

console.log('\n--- cuts land where a person pauses ---');
check(
  chunkForSpeech('Haan bhai. Sab badhiya. Tum sunao.').length === 1,
  'three short sentences ride together rather than becoming three requests',
);
// Real words, because the point is that the cut lands between them. A single
// 210-character "word" has no legal cut and is not what a reply looks like.
const sentence = 'ek chhota jumla jo baar baar dohraya gaya hai taaki lamba ho jaye ';
const long = chunkForSpeech(sentence.repeat(20));
check(long.length >= 2, 'a long reply is split');
check(
  long.every((c) => c === c.trim() && c.length > 0),
  'every chunk is trimmed and non-empty',
);
check(
  // Each boundary falls on a space in the original, so no chunk starts or ends
  // with half a word.
  long.every((c) => !/[a-z]$/i.test(c) || sentence.repeat(20).includes(`${c} `)),
  'chunks end where a space was, not inside a word',
);

console.log('\n--- one reply, one request ---');
// The whole point of the budget. About ten Read alouds produced 57 provider
// requests when every sentence was its own; these are the shapes that did it.
for (const [text, why] of [
  ['Haan bhai. Sab badhiya. Tum sunao.', 'three short sentences'],
  ['koi baat nahi', 'one line'],
  [
    'log darr ke karte hain jhoot - ya to saza bachane ke liye ya fayda uthane ke liye. koi baar toh bas habit ho jaata hai, soch samajh bina bol dete hain.',
    'a real two-sentence reply',
  ],
] as const) {
  check(chunkForSpeech(text).length === 1, `one request: ${why} (${text.length} chars)`);
}

console.log('\n--- degenerate input ---');
check(chunkForSpeech('').length === 0, 'empty text gives no chunks');
check(chunkForSpeech('   \n  ').length === 0, 'whitespace gives no chunks');
check(chunkForSpeech('Haan').length === 1, 'one word is one chunk');

console.log(failures === 0 ? '\nAll speak-chunk checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
