/**
 * The encrypted archive format, exercised with real crypto.
 *
 * No Drive and no network: this is the layer that decides whether a damaged,
 * truncated, reordered or replayed backup is caught or silently restored, and
 * all of those are reproducible offline. What cannot be tested here is Google's
 * behaviour, which is the next file's problem.
 *
 * Run with `pnpm verify:archive`.
 */
import {
  ArchiveError,
  openArchive,
  sealArchive,
  type ArchiveChunk,
} from '../src/lib/backup/drive/archive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

async function failsWith(run: () => Promise<unknown>, code: string): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (cause) {
    return cause instanceof ArchiveError && cause.code === code;
  }
}

/** An account's recovery keypair, as `createRecoveryKey` would produce it. */
const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveKey',
  'deriveBits',
]);
const recoveryPublic = Buffer.from(
  new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
).toString('base64');

/** A believable archive: 10 MiB of chat, which is several chunks. */
const plaintext = new Uint8Array(10 * 1024 * 1024);
crypto.getRandomValues(plaintext.subarray(0, 65536));
for (let i = 65536; i < plaintext.length; i += 1) plaintext[i] = i & 0xff;

const CHUNK = 4 * 1024 * 1024;

console.log('— first backup —');

const first = await sealArchive(plaintext, recoveryPublic, 1, CHUNK);
check(first.manifest.generation === 1, 'generation 1');
check(first.chunks.length === 3, `split into ${first.chunks.length} chunks`);
check(first.manifest.chunkCount === first.chunks.length, 'manifest agrees with the chunk count');
check(first.manifest.totalBytes === plaintext.length, 'plaintext length recorded');

/*
 * The bytes handed to Drive must not be the bytes handed to us.
 */
const firstChunkIsCipher =
  Buffer.compare(
    Buffer.from(first.chunks[0]!.bytes.subarray(0, 4096)),
    Buffer.from(plaintext.subarray(0, 4096)),
  ) !== 0;
check(firstChunkIsCipher, 'chunks are ciphertext, not the plaintext');
check(
  first.chunks[0]!.bytes.length === CHUNK + 16,
  'each chunk carries its GCM tag (+16 bytes)',
);

const restored = await openArchive(first.manifest, first.chunks, recovery.privateKey);
check(restored.length === plaintext.length, 'restore returns the original length');
check(Buffer.compare(Buffer.from(restored), Buffer.from(plaintext)) === 0, 'restore is byte-identical');

console.log('\n— repeated backup —');

const second = await sealArchive(plaintext, recoveryPublic, 2, CHUNK);
check(second.manifest.generation === 2, 'generation increments');
check(second.manifest.epk !== first.manifest.epk, 'a fresh ephemeral key per archive');
check(
  Buffer.compare(Buffer.from(second.chunks[0]!.bytes), Buffer.from(first.chunks[0]!.bytes)) !== 0,
  'same plaintext seals differently each time',
);
const restoredAgain = await openArchive(second.manifest, second.chunks, recovery.privateKey, 1);
check(
  Buffer.compare(Buffer.from(restoredAgain), Buffer.from(plaintext)) === 0,
  'the newer archive restores correctly',
);

console.log('\n— replay is refused —');

check(
  await failsWith(() => openArchive(first.manifest, first.chunks, recovery.privateKey, 2), 'rolled-back'),
  'an older generation is refused once a newer one has been seen',
);

console.log('\n— corrupted backup —');

const damaged: ArchiveChunk[] = second.chunks.map((chunk) =>
  chunk.index === 1 ? { index: 1, bytes: new Uint8Array(chunk.bytes) } : chunk,
);
damaged[1]!.bytes[1234] ^= 0xff;
check(
  await failsWith(() => openArchive(second.manifest, damaged, recovery.privateKey), 'chunk-corrupt'),
  'a single flipped bit is caught',
);

console.log('\n— interrupted upload —');

const truncated = second.chunks.slice(0, 2);
check(
  await failsWith(() => openArchive(second.manifest, truncated, recovery.privateKey), 'chunk-count'),
  'a missing final chunk is caught before anything is restored',
);

const holed = [second.chunks[0]!, second.chunks[2]!, { index: 99, bytes: new Uint8Array(16) }];
check(
  await failsWith(() => openArchive(second.manifest, holed, recovery.privateKey), 'chunk-missing'),
  'a chunk present in count but absent by index is caught',
);

console.log('\n— tampering with order and provenance —');

const swapped: ArchiveChunk[] = [
  { index: 0, bytes: second.chunks[1]!.bytes },
  { index: 1, bytes: second.chunks[0]!.bytes },
  second.chunks[2]!,
];
check(
  await failsWith(() => openArchive(second.manifest, swapped, recovery.privateKey), 'chunk-corrupt'),
  'two chunks swapped by index are rejected, not silently reordered',
);

/*
 * A chunk lifted from generation 1 into generation 2's manifest. Same key
 * material, same position — only the generation in the AAD differs, which is
 * exactly what the binding is for.
 */
const crossGeneration: ArchiveChunk[] = [
  { index: 0, bytes: first.chunks[0]!.bytes },
  second.chunks[1]!,
  second.chunks[2]!,
];
check(
  await failsWith(
    () => openArchive(second.manifest, crossGeneration, recovery.privateKey),
    'chunk-corrupt',
  ),
  "a chunk from an older archive cannot be spliced into a newer one",
);

console.log('\n— the wrong key opens nothing —');

const stranger = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveKey',
  'deriveBits',
]);
check(
  await failsWith(() => openArchive(second.manifest, second.chunks, stranger.privateKey), 'chunk-corrupt'),
  'a different recovery key cannot open the archive',
);

console.log('\n— edges —');

const empty = await sealArchive(new Uint8Array(0), recoveryPublic, 1, CHUNK);
check(empty.chunks.length === 1, 'an empty archive is still one chunk');
const emptyBack = await openArchive(empty.manifest, empty.chunks, recovery.privateKey);
check(emptyBack.length === 0, 'and restores to nothing');

const exact = await sealArchive(plaintext.subarray(0, CHUNK), recoveryPublic, 1, CHUNK);
check(exact.chunks.length === 1, 'an exact multiple does not produce a trailing empty chunk');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
