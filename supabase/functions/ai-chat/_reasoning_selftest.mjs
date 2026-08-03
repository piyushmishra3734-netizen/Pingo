/**
 * Offline self-test for general reasoning helpers (no NVIDIA key required).
 * Mirrors logic in index.ts — run: node supabase/functions/ai-chat/_reasoning_selftest.mjs
 */

function normalizeChat(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulLen(text) {
  return normalizeChat(text).replace(/\s+/g, '').length;
}

function isVagueFiller(text) {
  return /hmm\s+samajh\s+gaya|thoda\s+open\s+karke|kya\s+feel\s+ho\s+raha|seedha\s+usi\s+pe\s+baat|main\s+sun\s+raha\s+hoon|aage\s+kya\??\s*$|serious\s+ya\s+joke|thoda\s+detail\s+de\s+to\s+better|continue\s+kar\s*✨?\s*$/i.test(
    text,
  );
}

function looksLikeClearRequest(text) {
  const t = text.trim();
  if (!t) return false;
  if (/[?？]/.test(t)) return true;
  return (
    /\b(kya|kaise|kyun|kab|kahan|kitna|konsa|kaun|mtlb|matlab|meaning|means|define|explain|samjha|samjhao|bata|batao|suna|sunao|help|how|what|why|when|where|who|which|tell|show|give|calculate|solve|joke|story|plan|suggest|recommend|translate|yaad|chahiye|need|want|please|plz)\b/i.test(
      t,
    ) || /\d\s*[\+\-\*\/x×]\s*\d/i.test(t)
  );
}

const STOP_WORDS = new Set([
  'a','an','the','is','are','am','was','were','be','to','of','in','on','for','and','or','but',
  'i','you','me','my','your','we','they','it','this','that','with','from','as','at','by',
  'hai','hain','ho','hu','hun','hota','hoti','tha','thi','the','ka','ke','ki','ko','se','me',
  'mein','mai','main','tum','tu','aap','ye','yeh','wo','woh','bhi','to','toh','na','nahi',
  'no','yes','haan','ji','ya','aur','kya','hi','ek','do','ab','phir','bas','sirf','only',
  'please','plz','yaar','bhai','bro','hey','hi','hello','hlo','ok','okay','acha','accha',
]);

function contentWords(text) {
  return normalizeChat(text)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function isLikelyOffTopic(reply, user) {
  if (!reply || isVagueFiller(reply)) return true;
  if (!looksLikeClearRequest(user)) return false;
  if (/\d/.test(reply) && /(\d|kitna|calculate|solve|\+|\-|hota)/i.test(user)) return false;
  if (/\bjoke\b|hasao|funny\s*(suna|bata)|suna\s*joke/i.test(user) && meaningfulLen(reply) >= 16) {
    return false;
  }
  const uw = contentWords(user);
  const rw = contentWords(reply);
  if (uw.length === 0) return false;
  const hit = uw.some(
    (w) =>
      rw.includes(w) ||
      rw.some((r) => r.includes(w) || w.includes(r)) ||
      normalizeChat(reply).includes(w),
  );
  if (hit) return false;
  if (meaningfulLen(reply) >= 40 && !isVagueFiller(reply)) return false;
  return true;
}

function shouldRetryAnswer(reply, user) {
  const trimmed = reply.trim();
  if (!trimmed || (meaningfulLen(trimmed) < 3 && !/\d/.test(trimmed))) return true;
  if (/bhai\s+full|kya\s+hua,?\s*koi\s+baat/i.test(reply)) return true;
  if (isVagueFiller(reply)) return true;
  if (isLikelyOffTopic(reply, user)) return true;
  return false;
}

function qualityScore(reply, user) {
  if (!reply) return 0;
  let s = Math.min(40, meaningfulLen(reply));
  if (isVagueFiller(reply)) s -= 30;
  if (isLikelyOffTopic(reply, user)) s -= 20;
  const uw = contentWords(user);
  const rn = normalizeChat(reply);
  for (const w of uw) if (rn.includes(w)) s += 6;
  if (looksLikeClearRequest(user) && meaningfulLen(reply) >= 20) s += 8;
  return s;
}

const cases = [
  // [user, badReply, goodReply]
  ['Joke suna', 'Hmm samajh gaya, aur thoda open karke bata?', 'Teacher late: period late tha 😂'],
  [
    'Lowkey ka kya mtlb hota hai?',
    'Lowkey interest hai, kya feel ho raha?',
    'Lowkey matlab quietly / thoda sa bina scene banaye.',
  ],
  ['Hlo', 'serious ya joke?', 'Heyyy ✨ kya scene hai aaj?'],
  ['2+2 kitna hota hai?', 'Interesting continue kar ✨', '2+2 = 4 😊'],
  [
    'Photosynthesis kya hota hai short me?',
    'Hmm samajh gaya open karke bata',
    'Photosynthesis me plants light se food banate hain — CO2 + water → sugar + oxygen.',
  ],
  [
    'Mujhe motivation chahiye exam ke liye',
    'Kya feel ho raha?',
    'Ek paper at a time — 25 min deep work, phir 5 min break. Tu kar sakta hai 💪',
  ],
  [
    'Translate: I miss you',
    'Okay seedha usi pe baat',
    'I miss you = Mujhe tumhari yaad aa rahi hai 💕',
  ],
  [
    'Situationship ka matlab?',
    'Bhai full drama hai!',
    'Situationship = relationship jaisa feel, official label nahi.',
  ],
  ['Aaj mood off hai', 'serious ya joke?', 'Arre kya hua yaar — thoda dump kar, sun raha hoon 🫂'],
  [
    'Crypto kya hoti hai simple language me?',
    'thoda open karke bata',
    'Crypto digital money hai jo bank ke bina blockchain pe chalti hai.',
  ],
];

let fail = 0;
console.log('=== Clear request detection ===');
for (const [user] of cases) {
  const clear = looksLikeClearRequest(user);
  // Pure greetings / pure vent — not "clear request"
  const expectClear = !/^(hlo|hi|hey)|mood off/i.test(user.trim());
  const ok = clear === expectClear || (expectClear && clear);
  // allow clear=true when expected; when not expected must be false
  const pass = expectClear ? clear : !clear;
  if (!pass) fail++;
  console.log(pass ? 'PASS' : 'FAIL', 'clear?', clear, 'expect', expectClear, '|', user.slice(0, 40));
}

console.log('\n=== Retry should fire on bad replies ===');
for (const [user, bad, good] of cases) {
  const retryBad = shouldRetryAnswer(bad, user);
  const retryGood = shouldRetryAnswer(good, user);
  const scoreOk = qualityScore(good, user) > qualityScore(bad, user);
  // casual mood: bad might still retry if vague
  const ok = retryBad && (!retryGood || qualityScore(good, user) >= 10) && scoreOk;
  if (!ok) fail++;
  console.log(
    ok ? 'PASS' : 'FAIL',
    { retryBad, retryGood, qBad: qualityScore(bad, user), qGood: qualityScore(good, user) },
    '|',
    user.slice(0, 35),
  );
}

console.log('\n=== Not only slang — random words ===');
const randomDefs = [
  'Ephemeral ka kya matlab hai?',
  'Ubiquitous means what?',
  'Algorithm samjhao simple',
  'Gravity kya hai?',
  'Inflation ka mtlb?',
];
for (const u of randomDefs) {
  const ok = looksLikeClearRequest(u) && shouldRetryAnswer('Hmm samajh gaya open karke bata', u);
  if (!ok) fail++;
  console.log(ok ? 'PASS' : 'FAIL', u);
}

console.log(fail === 0 ? '\nALL PASS ✅' : `\n${fail} FAIL ❌`);
process.exit(fail === 0 ? 0 : 1);
