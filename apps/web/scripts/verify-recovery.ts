/**
 * The recovery code and package, exercised as shipped.
 *
 * This imports `src/lib/crypto/recovery.ts` itself rather than reproducing it,
 * so a change that breaks recovery breaks this run. Node's Web Crypto is the
 * same API the browser and the Android WebView expose, so PBKDF2, AES-GCM and
 * P-256 here are the real primitives.
 *
 * Run with `pnpm verify:recovery`.
 */
import {
  KDF,
  RecoveryError,
  createRecoveryKey,
  generateRecoveryCode,
  isValidRecoveryCode,
  normaliseRecoveryCode,
  restoreRecoveryKey,
  unknownWords,
} from '../src/lib/crypto/recovery.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

async function throws(run: () => Promise<unknown>, code: string): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (cause) {
    return cause instanceof RecoveryError && cause.code === code;
  }
}

console.log('— the code —');

const code = generateRecoveryCode();
check(code.split(' ').length === 12, 'twelve words');
check(isValidRecoveryCode(code), 'a generated code validates');

// Two codes in a row must differ. A generator that repeats itself is the one
// bug here that would look like everything working.
const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
check(codes.size === 200, '200 generated codes are all distinct');

check(
  isValidRecoveryCode(`  ${code.toUpperCase()}\n`),
  'accepts a pasted code with capitals, padding and a newline',
);
check(
  normaliseRecoveryCode(`  ${code.toUpperCase()}\n`) === code,
  'normalisation is exact, not approximate',
);

/*
 * The checksum is the reason for using BIP-39 at all: a swapped word is caught
 * before the KDF runs, so a typo costs nothing and reports itself.
 *
 * It catches *almost* all of them, and the difference matters. A twelve-word
 * code carries a four-bit checksum, so a single wrong word has roughly a one in
 * sixteen chance of still validating — inherent to BIP-39, not a defect here.
 *
 * This was previously one swap asserted to fail, which is a coin that lands
 * wrong about six percent of the time. It failed a full run during the pipeline
 * wiring, sending me looking for a regression in code that had not been
 * touched; a test that cries wolf one run in sixteen teaches people to re-run
 * it, which is worse than not having it.
 *
 * So the rate is measured across many swaps and the bound is the one the maths
 * actually supports.
 */
const words = code.split(' ');

{
  const substitutes = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract'];

  let tried = 0;
  let rejected = 0;
  for (let position = 0; position < words.length; position += 1) {
    for (const substitute of substitutes) {
      if (words[position] === substitute) continue;
      const swapped = [...words];
      swapped[position] = substitute;
      tried += 1;
      if (!isValidRecoveryCode(swapped.join(' '))) rejected += 1;
    }
  }

  const caught = rejected / tried;
  check(tried > 80, `every position was tried with several wrong words (${tried} typos)`);
  check(
    caught > 0.8,
    `the checksum catches the great majority of single-word typos (${Math.round(caught * 100)}% of ${tried})`,
  );
  check(
    caught < 1,
    'and not all of them, which is the four-bit checksum being honest rather than a bug',
  );
}

check(
  unknownWords(`${words.slice(0, 11).join(' ')} notaword`)[0] === 11,
  'a word outside the list is reported by position',
);
check(unknownWords(code).length === 0, 'a valid code reports no unknown words');
check(!isValidRecoveryCode(words.slice(0, 11).join(' ')), 'eleven words is not a code');

console.log('\n— wrap and unwrap —');

const made = await createRecoveryKey(code);
check(made.package.kdf === KDF, `package names its KDF (${KDF})`);
check(made.package.version === 1, 'package carries a version');

// The guarantee this whole design rests on.
check(made.privateKey.extractable === false, 'the returned recovery key is NOT extractable');
check(made.privateKey.algorithm.name === 'ECDH', 'and it is an ECDH key');

const blob = JSON.stringify(made.package);
check(!blob.includes(code), 'the package does not contain the code');
check(!blob.includes(words[0]) || words[0].length < 4, 'no code word leaks into the package');

const restored = await restoreRecoveryKey(made.package, code);
check(restored.extractable === false, 'a restored key is NOT extractable either');

// Proves it is the *same* key, not merely a key: both sides derive the same
// secret against a third party's public key.
const other = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
  'deriveBits',
]);
const bitsFrom = async (priv: CryptoKey) =>
  Buffer.from(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: other.publicKey }, priv, 256),
  ).toString('base64');

check(
  (await bitsFrom(restored)) === (await bitsFrom(made.privateKey)),
  'the restored key is the same key, by ECDH agreement',
);

console.log('\n— refusals —');

check(
  await throws(() => restoreRecoveryKey(made.package, generateRecoveryCode()), 'bad-code'),
  'a wrong code is refused',
);

const tampered = { ...made.package };
const bytes = Buffer.from(tampered.package, 'base64');
bytes[8] ^= 0xff;
tampered.package = bytes.toString('base64');
check(
  await throws(() => restoreRecoveryKey(tampered, code), 'bad-code'),
  'a single flipped byte is refused by GCM',
);

check(
  await throws(() => restoreRecoveryKey({ ...made.package, iv: made.package.salt }, code), 'bad-code'),
  'a swapped IV is refused',
);

/*
 * Substitution: a malicious server serves a package it made itself. It cannot
 * know the user's code, so its package cannot open under it. This is the
 * attack the threat model says GCM handles for free — here it is, handled.
 */
const attacker = await createRecoveryKey(generateRecoveryCode());
check(
  await throws(() => restoreRecoveryKey(attacker.package, code), 'bad-code'),
  "a server-substituted package will not open under the user's code",
);

console.log('\n— rollback —');

const v2 = await createRecoveryKey(code, 2);
check((await restoreRecoveryKey(v2.package, code, 2)) !== undefined, 'the current version opens');
check(
  await throws(() => restoreRecoveryKey(made.package, code, 2), 'rolled-back'),
  'a replayed older version is refused (v1 offered, v2 already seen)',
);
check(
  (await restoreRecoveryKey(v2.package, code, 1)) !== undefined,
  'a newer version than last seen is accepted',
);
check(
  await throws(
    () => restoreRecoveryKey({ ...made.package, kdf: 'argon2id-future' }, code),
    'unsupported-kdf',
  ),
  'an unknown KDF is refused rather than guessed at',
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
