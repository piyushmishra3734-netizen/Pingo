/**
 * Backup verification, against a store that lies about having stored things.
 *
 * The checks that matter are the ones a blob store can fail silently: an upload
 * it reported as fine and dropped, a body it truncated, a byte that rotted at
 * rest. Each is simulated directly, and every failure is required to move HEAD
 * back to the previous generation — because a failed verification that leaves a
 * bad pointer live is worse than no verification at all.
 *
 * Run with `pnpm verify:verification`.
 */
import {
  digestSample,
  verificationHeadline,
  verifyBackup,
  type CompletenessBlock,
  type VerificationStore,
} from '../src/lib/backup/verification.js';
import type { ArchiveManifest } from '../src/lib/backup/drive/archive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const sha256 = async (bytes: Uint8Array) =>
  toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)));

const COMPLETENESS: CompletenessBlock = { conversations: 412, messages: 38_204, provenAt: 1_785_000_000_000 };

/**
 * A store holding real bytes with real digests, which can then be sabotaged.
 *
 * Built from actual hashes rather than fixtures so a digest failure means the
 * bytes genuinely disagree with the manifest, not that a constant was edited.
 */
async function store(options: { generations?: number[]; chunks?: number; live?: number } = {}) {
  const chunkCount = options.chunks ?? 4;
  const gens = options.generations ?? [6, 7];
  const live = options.live ?? gens[gens.length - 1]!;

  const chunks = new Map<string, Uint8Array>();
  const manifests = new Map<number, string>();

  for (const generation of gens) {
    const meta: ArchiveManifest['chunks'] = [];
    for (let i = 0; i < chunkCount; i += 1) {
      const bytes = new Uint8Array(64).fill((generation * 31 + i) % 251);
      chunks.set(`${generation}.${i}`, bytes);
      meta.push({ index: i, iv: `aXY${i}`, digest: await sha256(bytes), bytes: bytes.length });
    }
    manifests.set(
      generation,
      JSON.stringify({
        version: 1,
        generation,
        epk: 'ZXBr',
        chunkCount,
        totalBytes: chunkCount * 64,
        chunks: meta,
        createdAt: 1_785_000_000_000,
      } satisfies ArchiveManifest),
    );
  }

  let head: { generation: number } | undefined = { generation: live };
  const reads: number[] = [];

  const impl: VerificationStore = {
    async head() {
      return head;
    },
    async writeHead(generation) {
      head = { generation };
    },
    async removeHead() {
      head = undefined;
    },
    async generations() {
      return [...manifests.keys()];
    },
    async readManifest(generation) {
      return manifests.get(generation);
    },
    async chunkSize(generation, index) {
      return chunks.get(`${generation}.${index}`)?.length;
    },
    async readChunk(generation, index) {
      reads.push(index);
      return chunks.get(`${generation}.${index}`);
    },
  };

  return {
    impl,
    chunks,
    manifests,
    reads,
    live,
    headNow: () => head,
    setHead: (g: number | undefined) => {
      head = g === undefined ? undefined : { generation: g };
    },
    patchManifest(generation: number, mutate: (m: ArchiveManifest) => void) {
      const m = JSON.parse(manifests.get(generation)!) as ArchiveManifest;
      mutate(m);
      manifests.set(generation, JSON.stringify(m));
    },
  };
}

const goodHeader = async () => ({ completeness: COMPLETENESS });

console.log('— all checks pass —');

{
  const s = await store();
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });

  check(result.status === 'verified', 'a good backup verifies');
  check(result.failures.length === 0, 'with no failures');
  check(result.checks.every((c) => c.status === 'passed'), 'and every check ran and passed');
  check(result.digests.checked === 4 && !result.digests.sampled, 'all four chunks were read');
  check(s.headNow()?.generation === 7, 'HEAD is left where it was');
  check(
    verificationHeadline(result) === 'Backup complete and fully verified.',
    `and the headline is unqualified: "${verificationHeadline(result)}"`,
  );
}

console.log('\n— a missing chunk —');

{
  const s = await store();
  s.chunks.delete('7.2');
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });

  check(result.status === 'failed', 'a dropped upload fails verification');
  check(result.failures.some((f) => /Missing chunks: 2/.test(f)), 'the missing chunk is named');
  check(result.rolledBackTo === 6, 'and HEAD rolls back to the previous generation');
  check(s.headNow()?.generation === 6, 'the pointer really moved');
  check(
    /previous backup from generation 6 is still in place/.test(verificationHeadline(result)),
    `the user is told the old backup survives: "${verificationHeadline(result)}"`,
  );
}

console.log('\n— a truncated body —');

{
  const s = await store();
  s.chunks.set('7.1', s.chunks.get('7.1')!.slice(0, 40));
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });

  check(result.status === 'failed', 'a wrong size fails');
  check(result.failures.some((f) => /1 is 40 bytes, expected 64/.test(f)), 'with both numbers');
  check(result.rolledBackTo === 6, 'and rolls back');
}

console.log('\n— a byte that rotted at rest —');

{
  const s = await store();
  // Same length, different content: only the digest can catch this.
  const rotted = new Uint8Array(s.chunks.get('7.3')!);
  rotted[10] ^= 0xff;
  s.chunks.set('7.3', rotted);

  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });

  check(result.status === 'failed', 'corruption at rest fails');
  check(result.checks.find((c) => c.name === 'chunk-sizes')?.status === 'passed', 'the size check could not see it');
  check(result.failures.some((f) => /Corrupt chunks: 3/.test(f)), 'but the digest did');
  check(result.rolledBackTo === 6, 'and rolls back');
}

console.log('\n— the wrong generation —');

{
  const s = await store();
  s.setHead(6);
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.status === 'failed', 'a HEAD that never moved fails');
  check(result.failures.some((f) => /HEAD points at generation 6, not the 7/.test(f)), 'and says so exactly');
}

{
  const s = await store();
  s.patchManifest(7, (m) => {
    m.generation = 9;
  });
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.status === 'failed', 'a manifest for a different generation fails');
  check(result.failures.some((f) => /manifest says generation 9/.test(f)), 'and is named');
}

console.log('\n— a half-committed generation —');

{
  const s = await store();
  s.manifests.delete(7);
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.status === 'failed', 'a missing manifest fails');
  check(result.rolledBackTo === 6, 'and rolls back to the generation that has one');
}

{
  const s = await store();
  s.manifests.set(7, '{not json');
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.status === 'failed', 'a manifest that will not parse fails');
  check(result.failures.some((f) => /could not be read/.test(f)), 'rather than throwing');
}

{
  const s = await store();
  s.patchManifest(7, (m) => {
    m.chunkCount = 9;
  });
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.status === 'failed', 'a chunk count that disagrees with the list fails');
  check(result.failures.some((f) => /lists 4 chunks but claims 9/.test(f)), 'with both numbers');
}

console.log('\n— an archive that is not sealed —');

{
  const s = await store();
  s.patchManifest(7, (m) => {
    m.epk = '';
  });
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.status === 'failed', 'a manifest with no ephemeral key fails');
  check(result.failures.some((f) => /not sealed/.test(f)), 'and says the archive is not sealed');
}

{
  const s = await store();
  s.patchManifest(7, (m) => {
    m.chunks[2]!.iv = '';
  });
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.status === 'failed', 'a chunk with no IV fails');
  check(result.failures.some((f) => /Chunks 2 have no IV/.test(f)), 'and is named');
}

console.log('\n— the header records the wrong account state —');

{
  const s = await store();
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: async () => ({ completeness: { ...COMPLETENESS, messages: 38_000 } }),
  });
  check(result.status === 'failed', 'a header that disagrees with the proof fails');
  check(
    result.failures.some((f) => /records 38000 messages.*38204.*were proven/.test(f)),
    'with both figures',
  );
  check(result.rolledBackTo === 6, 'and rolls back');
}

{
  const s = await store();
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: async () => ({}),
  });
  check(result.status === 'failed', 'a header with no completeness block fails');
}

{
  // A caller that cannot decrypt gets an honest "not checked", never a pass.
  const s = await store();
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS });
  const header = result.checks.find((c) => c.name === 'header')!;

  check(header.status === 'skipped', 'without a header reader the check is skipped');
  check(header.status !== 'passed', 'and never silently passed');
  check(result.status === 'verified', 'the rest of the backup still verifies');
  check(
    verificationHeadline(result) === 'Backup complete, completeness not confirmed.',
    `the headline names what was not confirmed: "${verificationHeadline(result)}"`,
  );
  check(
    !/spot-checked/.test(verificationHeadline(result)),
    'and does not claim it sampled when it read every chunk',
  );
}

console.log('\n— rollback —');

{
  // The first backup: nothing older to fall back to.
  const s = await store({ generations: [1], live: 1 });
  s.chunks.delete('1.0');
  const result = await verifyBackup(s.impl, { generation: 1, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });

  check(result.status === 'failed', 'a failed first backup fails');
  check(result.headCleared === true, 'HEAD is cleared rather than left on the bad generation');
  check(result.rolledBackTo === undefined, 'there is nothing to roll back to');
  check(s.headNow() === undefined, 'so no backup is claimed at all');
  check(
    verificationHeadline(result) === 'Backup failed to verify and was not kept.',
    `and the wording matches: "${verificationHeadline(result)}"`,
  );
}

{
  // Rollback skips a generation whose manifest is also gone.
  const s = await store({ generations: [5, 6, 7] });
  s.chunks.delete('7.0');
  s.manifests.delete(6);
  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.rolledBackTo === 5, `rollback skips a generation with no manifest (${result.rolledBackTo})`);
}

{
  // A dry run reports without touching the pointer.
  const s = await store();
  s.chunks.delete('7.0');
  const result = await verifyBackup(
    s.impl,
    { generation: 7, completeness: COMPLETENESS },
    { readHeader: goodHeader, rollback: false },
  );
  check(result.status === 'failed', 'a dry run still reports the failure');
  check(result.rolledBackTo === undefined && s.headNow()?.generation === 7, 'and leaves HEAD alone');
}

console.log('\n— sampling never overstates itself —');

{
  const picks = digestSample(1_000, 64, 16);
  check(picks.length <= 16, `a large archive samples (${picks.length} of 1000)`);
  check(picks[0] === 0, 'the first chunk is always read');
  check(picks[picks.length - 1] === 999, 'and so is the last, where truncation shows');
  check(
    JSON.stringify(picks) === JSON.stringify(digestSample(1_000, 64, 16)),
    'the sample is reproducible, so a bug report can be re-run',
  );
  check(digestSample(10, 64, 16).length === 10, 'a small archive is read in full');
}

{
  const s = await store({ chunks: 200 });
  const result = await verifyBackup(
    s.impl,
    { generation: 7, completeness: COMPLETENESS },
    { readHeader: goodHeader, fullDigestLimit: 64, digestSampleSize: 16 },
  );

  check(result.status === 'verified', 'a large archive verifies');
  check(result.digests.sampled, 'and records that it sampled');
  check(result.digests.checked === 16 && result.digests.total === 200, `16 of 200 read (${result.digests.checked})`);
  check(s.reads.length === 16, 'only the sampled chunks were downloaded');
  check(
    /spot-checked \(16 of 200 parts read\)/.test(verificationHeadline(result)),
    `the headline says what was actually done: "${verificationHeadline(result)}"`,
  );
  check(
    !/fully verified/.test(verificationHeadline(result)),
    'and never claims a full verification',
  );
}

{
  // Structural checks are never sampled: every chunk's presence and size is
  // read even when digests are not.
  const s = await store({ chunks: 200 });
  s.chunks.delete('7.150');
  const result = await verifyBackup(
    s.impl,
    { generation: 7, completeness: COMPLETENESS },
    { readHeader: goodHeader, fullDigestLimit: 64, digestSampleSize: 16 },
  );
  check(result.status === 'failed', 'a chunk missing outside the digest sample is still caught');
  check(result.failures.some((f) => /Missing chunks: 150/.test(f)), 'because presence is checked in full');
}

console.log('\n— every failure is reported, not just the first —');

{
  const s = await store();
  s.chunks.delete('7.0');
  const rotted = new Uint8Array(s.chunks.get('7.2')!);
  rotted[0] ^= 0xff;
  s.chunks.set('7.2', rotted);
  s.patchManifest(7, (m) => {
    m.chunks[1]!.iv = '';
  });

  const result = await verifyBackup(s.impl, { generation: 7, completeness: COMPLETENESS }, {
    readHeader: goodHeader,
  });
  check(result.failures.length >= 3, `all three problems are listed (${result.failures.length})`);
  check(
    result.checks.filter((c) => c.status === 'failed').length >= 3,
    'and each is a named check, so the report says which',
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
