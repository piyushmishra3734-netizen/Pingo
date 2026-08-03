/**
 * The immutable backup receipt, attacked.
 *
 * The receipt is the thing a restore trusts, so the interesting question is not
 * whether it round-trips — it is whether an edited one can be made to look
 * genuine. Google holds the file and can rewrite every byte of it, so every
 * field is either sealed or bound into the AEAD, and this suite edits each one
 * in turn to prove it.
 *
 * Run with `pnpm verify:receipt`.
 */
import {
  ReceiptError,
  canonicalJson,
  computeArchiveHash,
  computeManifestHash,
  formatReceipt,
  openReceipt,
  sealReceipt,
  sealedReceiptHash,
  verifyReceiptChain,
  verifyRestore,
  type BackupReceipt,
  type SealedReceipt,
} from '../src/lib/backup/receipt.js';
import {
  archiveBase64,
  archiveFromBase64,
  deriveArchiveKey,
  importArchivePublicKey,
  type ArchiveManifest,
} from '../src/lib/backup/drive/archive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** Did this throw a ReceiptError with the expected code? */
async function refuses(code: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (cause) {
    return cause instanceof ReceiptError && cause.code === code;
  }
}

const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveBits',
]);
const recoveryPublic = archiveBase64(
  new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
);

const MANIFEST: ArchiveManifest = {
  version: 1,
  generation: 7,
  epk: 'ZmFrZS1lcGs=',
  chunkCount: 3,
  totalBytes: 3_000_000,
  chunks: [
    { index: 0, iv: 'aXYw', digest: 'ZDA=', bytes: 1_000_016 },
    { index: 1, iv: 'aXYx', digest: 'ZDE=', bytes: 1_000_016 },
    { index: 2, iv: 'aXYy', digest: 'ZDI=', bytes: 1_000_016 },
  ],
  createdAt: 1_785_000_000_000,
};

const baseReceipt = async (over: Partial<BackupReceipt> = {}): Promise<BackupReceipt> => ({
  receiptVersion: 1,
  backupId: 'bk_01HZY',
  createdAt: 1_785_000_000_000,
  generation: 7,
  conversations: 412,
  messages: 38_204,
  mediaFiles: 2_544,
  archiveBytes: 3_000_048,
  manifestHash: await computeManifestHash(MANIFEST),
  archiveHash: await computeArchiveHash(MANIFEST.chunks),
  mode: 'private',
  keyVersion: 1,
  verification: 'verified',
  completeness: 'proven',
  ...over,
});

const clone = (s: SealedReceipt): SealedReceipt => JSON.parse(JSON.stringify(s));

console.log('— a receipt round-trips —');

{
  const receipt = await baseReceipt();
  const sealed = await sealReceipt(receipt, recoveryPublic);
  const opened = await openReceipt(sealed, recovery.privateKey);

  check(canonicalJson(opened) === canonicalJson(receipt), 'the receipt survives sealing exactly');
  check(opened.messages === 38_204 && opened.conversations === 412, 'the counts come back');
  check(opened.mode === 'private' && opened.keyVersion === 1, 'the mode and key version come back');
}

console.log('\n— Google holds the file and can read the envelope, not the record —');

{
  const sealed = await sealReceipt(await baseReceipt(), recoveryPublic);
  const asStored = JSON.stringify(sealed);

  check(!asStored.includes('38204') && !asStored.includes('412'), 'no count appears in the stored form');
  check(!asStored.includes('proven') && !asStored.includes('verified'), 'no status appears either');
  check(sealed.generation === 7 && sealed.mode === 'private', 'the envelope carries only what finds the key');
}

console.log('\n— modified metadata —');

{
  /*
   * Every plaintext envelope field is bound into the AEAD. Editing any of them
   * must break decryption, or a receipt could be relabelled as a different
   * generation, or as Private when it was made in Simple mode, while its body
   * still opened cleanly.
   */
  const receipt = await baseReceipt();
  for (const [field, value] of [
    ['generation', 8],
    ['mode', 'simple'],
    ['keyVersion', 2],
    ['backupId', 'bk_OTHER'],
  ] as const) {
    const sealed = clone(await sealReceipt(receipt, recoveryPublic));
    (sealed as Record<string, unknown>)[field] = value;
    check(await refuses('tampered', () => openReceipt(sealed, recovery.privateKey)), `editing ${field} is refused`);
  }
}

{
  const sealed = clone(await sealReceipt(await baseReceipt(), recoveryPublic));
  const body = archiveFromBase64(sealed.body);
  body[10] ^= 0xff;
  sealed.body = archiveBase64(body);
  check(await refuses('tampered', () => openReceipt(sealed, recovery.privateKey)), 'flipping a bit of the body is refused');
}

{
  // A wholesale replacement, sealed to a key the attacker controls, must not
  // open under ours — this is the "convincing forgery" case.
  const attacker = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const attackerPublic = archiveBase64(
    new Uint8Array(await crypto.subtle.exportKey('spki', attacker.publicKey)),
  );
  const forged = await sealReceipt(await baseReceipt({ messages: 1 }), attackerPublic);
  check(
    await refuses('tampered', () => openReceipt(forged, recovery.privateKey)),
    'a receipt forged under another key does not open',
  );
}

console.log('\n— the receipt key is not the archive key —');

{
  /*
   * Both derive from the same ECDH secret under different HKDF labels. If they
   * ever collapsed into one key, a receipt key would decrypt message chunks.
   * This performs that decryption and fails if it works.
   */
  const sealed = await sealReceipt(await baseReceipt(), recoveryPublic);
  const theirs = await importArchivePublicKey(sealed.epk);
  const chunkKey = await deriveArchiveKey(recovery.privateKey, theirs, ['decrypt']);

  let openedWithArchiveKey = false;
  try {
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: archiveFromBase64(sealed.iv) as unknown as ArrayBuffer },
      chunkKey,
      archiveFromBase64(sealed.body) as unknown as ArrayBuffer,
    );
    openedWithArchiveKey = true;
  } catch {
    /* expected */
  }
  check(!openedWithArchiveKey, 'the archive chunk key cannot open a receipt');
}

console.log('\n— corrupted manifest —');

{
  const original = await computeManifestHash(MANIFEST);

  for (const [what, mutate] of [
    ['a chunk digest', (m: ArchiveManifest) => (m.chunks[1]!.digest = 'ZFg=')],
    ['the chunk count', (m: ArchiveManifest) => (m.chunkCount = 2)],
    ['the generation', (m: ArchiveManifest) => (m.generation = 8)],
    ['the total size', (m: ArchiveManifest) => (m.totalBytes = 2_999_999)],
    ['the ephemeral key', (m: ArchiveManifest) => (m.epk = 'b3RoZXI=')],
  ] as const) {
    const tampered = JSON.parse(JSON.stringify(MANIFEST)) as ArchiveManifest;
    mutate(tampered);
    check((await computeManifestHash(tampered)) !== original, `changing ${what} moves the manifest hash`);
  }
}

{
  // Key order must not change the hash, or an honest restore raises a false
  // alarm the moment the manifest is rebuilt by a different code path.
  const reordered = JSON.parse(
    JSON.stringify({
      createdAt: MANIFEST.createdAt,
      chunks: MANIFEST.chunks,
      totalBytes: MANIFEST.totalBytes,
      chunkCount: MANIFEST.chunkCount,
      epk: MANIFEST.epk,
      generation: MANIFEST.generation,
      version: MANIFEST.version,
    }),
  ) as ArchiveManifest;
  check(
    (await computeManifestHash(reordered)) === (await computeManifestHash(MANIFEST)),
    'field order does not change the hash',
  );
}

console.log('\n— modified archive —');

{
  const original = await computeArchiveHash(MANIFEST.chunks);

  const edited = MANIFEST.chunks.map((c) => ({ ...c }));
  edited[2]!.digest = 'dGFtcGVyZWQ=';
  check((await computeArchiveHash(edited)) !== original, 'editing a chunk moves the archive hash');

  const truncated = MANIFEST.chunks.slice(0, 2).map((c) => ({ ...c }));
  check((await computeArchiveHash(truncated)) !== original, 'dropping the last chunk moves it');

  const reordered = [
    { index: 0, digest: 'ZDE=' },
    { index: 1, digest: 'ZDA=' },
    { index: 2, digest: 'ZDI=' },
  ];
  check((await computeArchiveHash(reordered)) !== original, 'swapping two chunks moves it');

  const shuffled = [...MANIFEST.chunks].reverse().map((c) => ({ ...c }));
  check(
    (await computeArchiveHash(shuffled)) === original,
    'but listing the same chunks in a different order does not',
  );
}

console.log('\n— restore verification —');

{
  const receipt = await baseReceipt();
  const result = verifyRestore(receipt, {
    conversations: receipt.conversations,
    messages: receipt.messages,
    manifestHash: receipt.manifestHash,
    archiveHash: receipt.archiveHash,
  });
  check(result.status === 'verified', 'a matching restore verifies');
  check(result.warnings.length === 0, 'with no warnings');
  check(/38,204 messages across 412 chats/.test(result.headline), `and says what came back: "${result.headline}"`);
}

{
  // Mismatched counts. The restore is not blocked, and is never called complete.
  const receipt = await baseReceipt();
  const result = verifyRestore(receipt, {
    conversations: 410,
    messages: 38_000,
    manifestHash: receipt.manifestHash,
    archiveHash: receipt.archiveHash,
  });
  check(result.status === 'warned', 'a count mismatch warns');
  check(result.warnings.some((w) => w.code === 'chats'), 'the chat shortfall is named');
  check(result.warnings.some((w) => w.code === 'messages'), 'the message shortfall is named');
  check(
    result.warnings.some((w) => w.expected === '38204' && w.actual === '38000'),
    'with both numbers, so a bug report writes itself',
  );
  check(/Some history is missing/.test(result.headline), `and the wording says so: "${result.headline}"`);
}

{
  // An incomplete restore — most of the account absent — must not read as success.
  const receipt = await baseReceipt();
  const result = verifyRestore(receipt, {
    conversations: 12,
    messages: 90,
    manifestHash: receipt.manifestHash,
    archiveHash: receipt.archiveHash,
  });
  check(result.status !== 'verified', 'a mostly-empty restore is never verified');
  check(/90 of 38,204/.test(result.headline), `and quantifies the loss: "${result.headline}"`);
}

{
  const receipt = await baseReceipt();
  const hashOnly = verifyRestore(receipt, {
    conversations: receipt.conversations,
    messages: receipt.messages,
    manifestHash: 'ZGlmZmVyZW50LW1hbmlmZXN0',
    archiveHash: 'ZGlmZmVyZW50LWFyY2hpdmU=',
  });
  check(hashOnly.status === 'warned', 'a hash mismatch warns even when the counts agree');
  check(hashOnly.warnings.some((w) => w.code === 'manifest-hash'), 'the manifest hash is named');
  check(hashOnly.warnings.some((w) => w.code === 'archive-hash'), 'the archive hash is named');
  check(!/complete/i.test(hashOnly.headline), 'and the headline never says complete');
}

{
  // No receipt at all: restoring anyway is right, calling it verified is not.
  const result = verifyRestore(undefined, {
    conversations: 412,
    messages: 38_204,
    manifestHash: 'x',
    archiveHash: 'y',
  });
  check(result.status === 'unverifiable', 'a missing receipt is unverifiable, not verified');
  check(/could not verify/.test(result.headline), `and says so: "${result.headline}"`);
}

{
  /*
   * There is no boolean anywhere in this result. A caller cannot write
   * `if (ok)` and have "restored with warnings" quietly become "restored".
   */
  const receipt = await baseReceipt();
  const warned = verifyRestore(receipt, {
    conversations: 1,
    messages: 1,
    manifestHash: receipt.manifestHash,
    archiveHash: receipt.archiveHash,
  });
  check(
    !Object.values(warned).some((v) => typeof v === 'boolean'),
    'the verification result exposes no boolean to misread',
  );
}

console.log('\n— the chain —');

{
  const first = await baseReceipt({ backupId: 'bk_1', generation: 1, messages: 100 });
  const sealed1 = await sealReceipt(first, recoveryPublic);

  const second = await baseReceipt({
    backupId: 'bk_2',
    generation: 2,
    messages: 200,
    previousHash: await sealedReceiptHash(sealed1),
  });
  const sealed2 = await sealReceipt(second, recoveryPublic);

  const third = await baseReceipt({
    backupId: 'bk_3',
    generation: 3,
    messages: 300,
    previousHash: await sealedReceiptHash(sealed2),
  });
  const sealed3 = await sealReceipt(third, recoveryPublic);

  const chain = [
    { sealed: sealed1, receipt: first },
    { sealed: sealed2, receipt: second },
    { sealed: sealed3, receipt: third },
  ];

  let ok = true;
  try {
    await verifyReceiptChain(chain);
  } catch {
    ok = false;
  }
  check(ok, 'an intact chain verifies');

  check(
    await refuses('chain-broken', () => verifyReceiptChain([chain[0]!, chain[2]!])),
    'removing a receipt from the middle breaks the chain',
  );

  const rolledBack = [chain[0]!, chain[1]!, { sealed: sealed1, receipt: first }];
  check(
    await refuses('chain-broken', () => verifyReceiptChain(rolledBack)),
    'replaying an old receipt as the newest is refused',
  );

  // The limit, asserted rather than assumed: truncating the newest end leaves a
  // chain that is internally perfect. Local pinning and the server generation
  // floor are what cover this, not the chain.
  let truncatedVerifies = true;
  try {
    await verifyReceiptChain([chain[0]!, chain[1]!]);
  } catch {
    truncatedVerifies = false;
  }
  check(truncatedVerifies, 'truncating the newest end is NOT caught here (covered by the generation floor)');
}

console.log('\n— the record, as a user would see it —');

{
  const receipt = await baseReceipt();
  const rendered = formatReceipt(receipt);
  check(/Generation +7/.test(rendered), 'the generation is shown');
  check(/Encryption mode +private/.test(rendered), 'the mode is shown');
  check(/Completeness +proven/.test(rendered), 'the completeness status is shown');
  console.log('\n' + rendered + '\n');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
