/**
 * The PINGO server as a backup target.
 *
 * It holds the sealed package and the public half senders wrap to. It cannot
 * read the package: the migration revokes `select` on the table and grants it
 * back for `user_id`, `public_key` and `version` only, so `package` is not
 * reachable through this client at all.
 *
 * That asymmetry is deliberate and shapes this file. Writing is ordinary;
 * reading the package back is not something a signed-in device may simply do,
 * because "hand me the blob that opens all history" is exactly the request the
 * recovery request flow exists to slow down. `get()` therefore returns
 * undefined rather than pretending.
 */
import type { RecoveryPackage } from '../crypto/recovery.js';
import type { PingoSupabaseClient } from '../supabase/client.js';
import type { BackupTarget, StoredPackage, TargetStatus } from './target.js';

export class ServerBackupTarget implements BackupTarget {
  readonly id = 'server' as const;
  readonly label = 'PINGO server';

  constructor(private readonly client: PingoSupabaseClient) {}

  async #userId(): Promise<string> {
    const { data } = await this.client.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new Error('Not signed in.');
    return id;
  }

  /**
   * Upsert, because enrolling twice is a rotation rather than an error.
   *
   * The insert policy additionally requires a published device key, so a
   * session that has never registered a device cannot install a recovery key
   * of its own choosing.
   */
  async put(stored: StoredPackage): Promise<void> {
    /*
     * Through a function, not the table.
     *
     * `package` is not selectable by any client role, on purpose, and the
     * column-level grants that achieve that also deny the table-level
     * privileges PostgREST's upsert wants - measured, the first time this ran
     * against the real database: 403, 42501, permission denied. Granting them
     * back would expose the blob that opens an account's history, so the write
     * goes through a definer function that re-states the same checks.
     */
    const { error } = await this.client.rpc('upsert_recovery_package', {
      new_kdf: stored.package.kdf,
      new_salt: stored.package.salt,
      new_iv: stored.package.iv,
      new_package: stored.package.package,
      new_public_key: stored.publicKey,
      new_version: stored.package.version,
    });

    if (error) throw error;
  }

  /**
   * Not readable from here, and that is the design rather than a gap.
   *
   * Claiming a package goes through `request_recovery`, which imposes the delay
   * or the approval. A device that could simply select it would make both
   * pointless.
   */
  async get(): Promise<StoredPackage | undefined> {
    return undefined;
  }

  async remove(): Promise<void> {
    // Same reason as `put`: no table privileges, so a definer function does it.
    const { error } = await this.client.rpc('delete_recovery_package');
    if (error) throw error;
  }

  async status(): Promise<TargetStatus> {
    try {
      const userId = await this.#userId();
      const { data, error } = await this.client
        .from('recovery_packages')
        .select('user_id,public_key,version')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) return { present: false, error: error.message };
      if (!data) return { present: false };
      return { present: true, version: data.version };
    } catch (cause) {
      return { present: false, error: cause instanceof Error ? cause.message : 'unknown' };
    }
  }
}
