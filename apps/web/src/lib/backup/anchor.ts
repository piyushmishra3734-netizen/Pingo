/**
 * The backup's anchor: the part of it Google is not allowed to move.
 *
 * ## Why this is not cryptography
 *
 * `docs/backup-security-review.md` proposed closing its two open gaps with a
 * MAC over the HEAD pointer and a replay floor derived from the archive
 * keypair. Neither survives contact with Simple mode, where `archive-key.ts`
 * puts the archive's private key in the Drive folder in the clear - the
 * deliberate trade that makes restore automatic. An attacker who can write that
 * folder can read that key, so they can seal an archive that opens perfectly
 * and forge any MAC computed from it. A signature made with a key sitting next
 * to the thing it signs is decoration.
 *
 * What such an attacker does not have is the account's PINGO session. So the
 * anchor lives on our server: a generation counter and a hash of the manifest,
 * both meaningless to us, and both outside the folder under attack.
 *
 * ## The two things it stops
 *
 * **Rollback.** The counter only ever goes up (`set_backup_anchor` enforces it).
 * Putting HEAD back to last month's genuine, correctly-sealed generation now
 * fails a comparison the attacker cannot reach.
 *
 * **Substitution.** The manifest hash pins which archive that generation is. A
 * replacement sealed to the stolen key hashes differently and is refused before
 * a single chunk is decrypted, let alone applied.
 *
 * ## And the thing it does not
 *
 * It does not stop deletion. Whoever can write the folder can empty it, and no
 * amount of remembering makes the bytes come back. That is not a gap this can
 * close; it is why the backup exists rather than something the backup protects
 * against.
 */
import type { PingoSupabaseClient } from '../supabase/client.js';
import type { ArchiveManifest } from './drive/archive.js';
import { computeManifestHash } from './receipt.js';

/** What the server remembers about the current backup. */
export interface BackupAnchor {
  generation: number;
  manifestHash: string;
}

/**
 * Reading and advancing it. Injected so the decision below can be tested
 * without a network, and so a caller with no session degrades to `undefined`
 * rather than to a fabricated anchor.
 */
export interface AnchorStore {
  read(): Promise<BackupAnchor | undefined>;
  /** Throws if the generation is not strictly newer. That refusal is the point. */
  write(anchor: BackupAnchor): Promise<void>;
  clear(): Promise<void>;
}

export class AnchorError extends Error {
  constructor(
    message: string,
    readonly code: 'rolled-back' | 'substituted' | 'unanchored',
  ) {
    super(message);
    this.name = 'AnchorError';
  }
}

/**
 * The next generation to write.
 *
 * `max` of the two, not HEAD alone. A run that anchored and then died before
 * committing leaves the anchor one ahead of HEAD; taking HEAD + 1 would produce
 * a number the anchor has already refused, and every backup after it would fail
 * the same way. Stepping past both heals it on the next attempt.
 */
export function nextGeneration(head: number | undefined, anchor: BackupAnchor | undefined): number {
  return Math.max(head ?? 0, anchor?.generation ?? 0) + 1;
}

/**
 * Whether this manifest is the one the account actually backed up.
 *
 * Called before anything is decrypted or applied. An account with no anchor at
 * all is a backup made before this existed, and is allowed through - refusing
 * it would lock people out of their own history to defend against an attack
 * nobody has reported. One backup writes an anchor and that grace ends.
 */
export function checkAnchor(manifest: ArchiveManifest, anchor: BackupAnchor | undefined, manifestHash: string): void {
  if (!anchor) return;

  if (manifest.generation < anchor.generation) {
    throw new AnchorError(
      'This backup is older than the one PINGO recorded for your account. It may have been replaced.',
      'rolled-back',
    );
  }

  /*
   * Ahead of the anchor is not "newer", it is unaccounted for. The anchor is
   * written before HEAD is committed, so a generation a restore can see through
   * HEAD was anchored first - unless somebody wrote HEAD who could not write the
   * anchor, which is precisely the attacker.
   *
   * ponytail: a run that anchored and then failed to commit HEAD is heard as
   * this too, and heals when the next backup runs. Distinguishing them would
   * need the anchor to record attempts as well as commits, which is a second
   * write on every backup to improve a message nobody should ever see.
   */
  if (manifest.generation > anchor.generation) {
    throw new AnchorError(
      'This backup was not recorded by PINGO. Back up again from a device that still has your chats, then restore.',
      'unanchored',
    );
  }

  if (manifestHash !== anchor.manifestHash) {
    throw new AnchorError(
      'This backup does not match the one PINGO recorded for your account. Nothing was restored.',
      'substituted',
    );
  }
}

/** Hash a manifest the same way the anchor did. One definition, both sides. */
export const anchorHash = (manifest: ArchiveManifest): Promise<string> => computeManifestHash(manifest);

/** The real store, over the account's own session. */
export function liveAnchorStore(client: PingoSupabaseClient): AnchorStore {
  return {
    async read() {
      const { data, error } = await client.from('backup_anchor').select('generation, manifest_hash').maybeSingle();
      if (error || !data) return undefined;
      return { generation: data.generation, manifestHash: data.manifest_hash };
    },
    async write(anchor) {
      const { error } = await client.rpc('set_backup_anchor', {
        p_generation: anchor.generation,
        p_manifest_hash: anchor.manifestHash,
      });
      if (error) throw new Error(`Backup could not be recorded - ${error.message}`);
    },
    async clear() {
      await client.rpc('clear_backup_anchor');
    },
  };
}
