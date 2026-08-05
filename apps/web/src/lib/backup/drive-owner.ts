/**
 * Which PINGO account a Drive backup belongs to.
 *
 * Reported as a question and it is the right one: if connecting a Google
 * account is all it takes, what stops one account's history landing in another
 * account's app?
 *
 * Each Google account has its own hidden app folder, so two people cannot see
 * each other's files. The dangerous direction is the other one: sign in to
 * PINGO as A, connect a Google account belonging to B, and press Restore. The
 * archive there was written by B, it opens with B's key — and without this file
 * it would be applied straight into A's device.
 *
 * So the first backup writes down who it is for, and restore refuses anything
 * that says somebody else. The check costs one small file and one comparison,
 * and it is the difference between "this is my backup" and "this is a backup".
 *
 * ## It records an id, not a person
 *
 * The PINGO user id and nothing else — no email, no name, no handle. It sits in
 * the user's own Drive, and a file that named them would be one more copy of
 * their identity in a place this feature has no reason to put it.
 */

/** The minimum of a Drive client this needs. Same shape `archive-key` uses. */
export interface OwnerStore {
  find(name: string): Promise<{ id: string } | undefined>;
  upload(name: string, bytes: Uint8Array): Promise<unknown>;
  download(id: string): Promise<Uint8Array>;
}

export const OWNER_FILE = 'pingo.owner.json';

interface OwnerRecord {
  version: 1;
  userId: string;
  claimedAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class OwnerMismatchError extends Error {
  constructor(readonly ownerId: string) {
    super('This Google account holds a backup for a different PINGO account.');
    this.name = 'OwnerMismatchError';
  }
}

/** Who this Drive backup belongs to, or undefined if nothing has claimed it. */
export async function readOwner(drive: OwnerStore): Promise<string | undefined> {
  const file = await drive.find(OWNER_FILE);
  if (!file) return undefined;
  try {
    const record = JSON.parse(decoder.decode(await drive.download(file.id))) as OwnerRecord;
    return typeof record.userId === 'string' && record.userId ? record.userId : undefined;
  } catch {
    /*
     * Unreadable is treated as unclaimed rather than as a mismatch.
     *
     * A corrupt marker must not lock somebody out of their own backup — the
     * archive is still theirs and still opens with their key. The claim is
     * rewritten on the next backup.
     */
    return undefined;
  }
}

/**
 * Claims this Drive folder for a PINGO account, once.
 *
 * An existing claim by somebody else is an error rather than an overwrite: the
 * archive beside it belongs to them, and stamping a new name on the folder
 * would only make the next restore look legitimate.
 */
export async function claimOwner(drive: OwnerStore, userId: string): Promise<void> {
  const existing = await readOwner(drive);
  if (existing && existing !== userId) throw new OwnerMismatchError(existing);
  if (existing === userId) return;

  const record: OwnerRecord = { version: 1, userId, claimedAt: Date.now() };
  await drive.upload(OWNER_FILE, encoder.encode(JSON.stringify(record)));
}

/**
 * Throws unless this Drive account's backup belongs to the signed-in user.
 *
 * An unclaimed folder passes: backups written before this existed have no
 * marker, and refusing them would strand exactly the people who have been using
 * the feature longest. They are claimed on their next backup.
 */
export async function assertOwner(drive: OwnerStore, userId: string): Promise<void> {
  const owner = await readOwner(drive);
  if (owner && owner !== userId) throw new OwnerMismatchError(owner);
}
