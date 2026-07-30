/**
 * Google Drive as a second `BackupTarget`, plus the chat archive.
 *
 * The interface it implements is unchanged and only ever concerns the recovery
 * package. The archive is a separate pair of methods on this class rather than
 * a widening of `BackupTarget`, because the server target cannot hold an
 * archive and never will — forcing it into the shared interface would give
 * every target a method one of them has to refuse.
 *
 * ## Never overwrite blindly
 *
 * A generation is written as new files and only becomes real when the pointer
 * flips:
 *
 *   1. chunks    `pingo.g<N>.<i>`
 *   2. manifest  `pingo.manifest.g<N>.json`
 *   3. HEAD      `pingo.head.json`   ← the commit point
 *   4. older generations deleted
 *
 * An upload that dies at any point before step 3 leaves the previous backup
 * exactly as it was, because nothing that existed was touched. A restore reads
 * HEAD, so it either sees the old generation or the new one and never a
 * half-written mixture. Steps 1–2 are idempotent by name, so a retry overwrites
 * its own partial work rather than someone else's finished work.
 */
import type { RecoveryPackage } from '../../crypto/recovery.js';
import type { BackupTarget, StoredPackage, TargetStatus } from '../target.js';
import { openArchive, sealArchive, type ArchiveChunk, type ArchiveManifest } from './archive.js';
import { DriveClient, DriveError, type Http } from './client.js';
import type { DriveAuth } from './auth.js';

const PACKAGE_FILE = 'pingo.recovery.json';
const HEAD_FILE = 'pingo.head.json';
const chunkName = (generation: number, index: number) => `pingo.g${generation}.${index}`;
const manifestName = (generation: number) => `pingo.manifest.g${generation}.json`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Head {
  generation: number;
  updatedAt: number;
}

export interface ArchiveProgress {
  phase: 'sealing' | 'uploading' | 'committing' | 'cleaning' | 'downloading' | 'opening';
  sent?: number;
  total?: number;
}

export class GoogleDriveBackupTarget implements BackupTarget {
  readonly id = 'drive' as const;
  readonly label = 'Google Drive';

  private readonly drive: DriveClient;

  constructor(
    private readonly auth: DriveAuth,
    http?: Http,
  ) {
    this.drive = new DriveClient(auth, http);
  }

  // -- BackupTarget: the recovery package ------------------------------------

  async put(stored: StoredPackage): Promise<void> {
    const existing = await this.drive.find(PACKAGE_FILE);
    const body = encoder.encode(JSON.stringify(stored));

    /*
     * Upload first, delete second. The reverse would leave a window in which
     * the user has no package anywhere if the upload then failed.
     */
    await this.drive.upload(PACKAGE_FILE, body);
    if (existing) await this.drive.remove(existing.id);
  }

  async get(): Promise<StoredPackage | undefined> {
    const file = await this.drive.find(PACKAGE_FILE);
    if (!file) return undefined;
    const bytes = await this.drive.download(file.id);
    return JSON.parse(decoder.decode(bytes)) as StoredPackage;
  }

  async remove(): Promise<void> {
    for (const file of await this.drive.list('pingo.')) {
      await this.drive.remove(file.id);
    }
  }

  async status(): Promise<TargetStatus> {
    try {
      const file = await this.drive.find(PACKAGE_FILE);
      if (!file) return { present: false };

      const bytes = await this.drive.download(file.id);
      const stored = JSON.parse(decoder.decode(bytes)) as { package?: RecoveryPackage };
      return {
        present: true,
        version: stored.package?.version,
        updatedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : undefined,
      };
    } catch (cause) {
      return { present: false, error: cause instanceof Error ? cause.message : 'unknown' };
    }
  }

  // -- the chat archive ------------------------------------------------------

  async head(): Promise<Head | undefined> {
    const file = await this.drive.find(HEAD_FILE);
    if (!file) return undefined;
    try {
      return JSON.parse(decoder.decode(await this.drive.download(file.id))) as Head;
    } catch {
      // A HEAD that will not parse is treated as no backup rather than as a
      // reason to fail: the next backup will write a valid one.
      return undefined;
    }
  }

  /**
   * Seal, upload, then commit.
   *
   * The generation is one past whatever HEAD says, so two devices backing up
   * cannot silently land on the same number, and a restore can always tell
   * which is newer.
   */
  async backupArchive(
    plaintext: Uint8Array,
    recoveryPublicKey: string,
    onProgress?: (progress: ArchiveProgress) => void,
  ): Promise<{ generation: number; bytes: number }> {
    const current = await this.head();
    const generation = (current?.generation ?? 0) + 1;

    onProgress?.({ phase: 'sealing' });
    const { manifest, chunks } = await sealArchive(plaintext, recoveryPublicKey, generation);

    const total = chunks.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
    let sent = 0;

    onProgress?.({ phase: 'uploading', sent, total });
    for (const chunk of chunks) {
      await this.drive.upload(chunkName(generation, chunk.index), chunk.bytes, (chunkSent) => {
        onProgress?.({ phase: 'uploading', sent: sent + chunkSent, total });
      });
      sent += chunk.bytes.length;
    }

    await this.drive.upload(manifestName(generation), encoder.encode(JSON.stringify(manifest)));

    /*
     * The commit. Everything above is invisible to a restore until this lands,
     * so a failure before here leaves the previous backup intact and a failure
     * after here leaves only orphaned files, which the next clean removes.
     */
    onProgress?.({ phase: 'committing' });
    const previousHead = await this.drive.find(HEAD_FILE);
    await this.drive.upload(HEAD_FILE, encoder.encode(JSON.stringify({ generation, updatedAt: Date.now() })));
    if (previousHead) await this.drive.remove(previousHead.id);

    onProgress?.({ phase: 'cleaning' });
    await this.#removeGenerationsBefore(generation);

    return { generation, bytes: total };
  }

  async restoreArchive(
    recoveryPrivateKey: CryptoKey,
    seenGeneration = 0,
    onProgress?: (progress: ArchiveProgress) => void,
  ): Promise<{ plaintext: Uint8Array; generation: number }> {
    const current = await this.head();
    if (!current) throw new DriveError('There is no backup in Drive to restore.', 'not-found');

    onProgress?.({ phase: 'downloading' });
    const manifestFile = await this.drive.find(manifestName(current.generation));
    if (!manifestFile) {
      throw new DriveError('The backup index is missing from Drive.', 'not-found');
    }

    const manifest = JSON.parse(
      decoder.decode(await this.drive.download(manifestFile.id)),
    ) as ArchiveManifest;

    const chunks: ArchiveChunk[] = [];
    for (const entry of manifest.chunks) {
      const file = await this.drive.find(chunkName(current.generation, entry.index));
      if (!file) continue; // openArchive reports precisely which part is missing.
      chunks.push({ index: entry.index, bytes: await this.drive.download(file.id) });
      onProgress?.({ phase: 'downloading', sent: chunks.length, total: manifest.chunkCount });
    }

    onProgress?.({ phase: 'opening' });
    const plaintext = await openArchive(manifest, chunks, recoveryPrivateKey, seenGeneration);
    return { plaintext, generation: manifest.generation };
  }

  /**
   * Remove everything belonging to an older generation.
   *
   * Only after the pointer has moved, and only for generations strictly older
   * than the live one, so a concurrent restore reading the previous HEAD still
   * finds what it was promised until it finishes.
   */
  async #removeGenerationsBefore(generation: number): Promise<void> {
    for (const file of await this.drive.list('pingo.')) {
      const match = /^pingo\.(?:manifest\.)?g(\d+)[.\d]*(?:\.json)?$/.exec(file.name);
      const found = match ? Number(match[1]) : undefined;
      if (found !== undefined && found < generation) await this.drive.remove(file.id);
    }
  }

  async disconnect(): Promise<void> {
    await this.auth.disconnect();
  }
}
