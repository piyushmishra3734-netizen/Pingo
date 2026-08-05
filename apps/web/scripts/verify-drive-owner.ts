/**
 * Whose backup is in this Google account.
 *
 * The question that prompted it: if connecting a Google account is all it
 * takes, what stops one account's data ending up in another? Reading across is
 * already impossible — each Google account has its own hidden folder — so the
 * direction that needed closing is the other one: signing in as one person,
 * connecting somebody else's Drive, and pressing Restore.
 *
 * Run with `pnpm verify:drive-owner`.
 */
import {
  assertOwner,
  claimOwner,
  readOwner,
  OwnerMismatchError,
  OWNER_FILE,
} from '../src/lib/backup/drive-owner.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** A Drive folder, as a map. Enough to be honest about find/upload/download. */
function folder(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    async find(name: string) {
      return files.has(name) ? { id: name } : undefined;
    },
    async upload(name: string, bytes: Uint8Array) {
      files.set(name, new TextDecoder().decode(bytes));
    },
    async download(id: string) {
      return new TextEncoder().encode(files.get(id) ?? '');
    },
  };
}

console.log('— an unclaimed folder —');

{
  const drive = folder();
  check((await readOwner(drive)) === undefined, 'nobody owns it yet');

  /*
   * Backups written before this existed have no marker. Refusing those would
   * strand exactly the people who have used the feature longest, so an
   * unclaimed folder passes and is claimed on the next backup.
   */
  let threw = false;
  try {
    await assertOwner(drive, 'user-a');
  } catch {
    threw = true;
  }
  check(!threw, 'and an old backup with no marker is still allowed to restore');

  await claimOwner(drive, 'user-a');
  check((await readOwner(drive)) === 'user-a', 'the first backup claims it');
  check(drive.files.has(OWNER_FILE), 'in one small file');
  check(!drive.files.get(OWNER_FILE)!.includes('@'), 'that names an id and not a person');
}

console.log('\n— somebody else’s folder —');

{
  const drive = folder();
  await claimOwner(drive, 'user-b');

  let refused: unknown;
  try {
    await assertOwner(drive, 'user-a');
  } catch (error) {
    refused = error;
  }
  check(refused instanceof OwnerMismatchError, 'restoring into the wrong account is refused');
  check(
    (refused as OwnerMismatchError).ownerId === 'user-b',
    'and the refusal knows whose it is, so the screen can say something true',
  );

  let claimRefused = false;
  try {
    await claimOwner(drive, 'user-a');
  } catch (error) {
    claimRefused = error instanceof OwnerMismatchError;
  }
  check(claimRefused, 'and backing up into it is refused too, before anything is uploaded');
  check(
    (await readOwner(drive)) === 'user-b',
    'the claim is never overwritten — stamping a new name would only make the next restore look legitimate',
  );
}

console.log('\n— the same account, again —');

{
  const drive = folder();
  await claimOwner(drive, 'user-a');
  await claimOwner(drive, 'user-a');
  check((await readOwner(drive)) === 'user-a', 'claiming twice is not an error');
  check(drive.files.size === 1, 'and writes nothing the second time');
}

console.log('\n— a corrupt marker —');

{
  const drive = folder({ [OWNER_FILE]: 'not json at all' });
  check((await readOwner(drive)) === undefined, 'unreadable reads as unclaimed');

  /*
   * Deliberately not a mismatch. The archive beside it is still theirs and
   * still opens with their key; a damaged marker must not lock somebody out of
   * their own history.
   */
  let threw = false;
  try {
    await assertOwner(drive, 'user-a');
  } catch {
    threw = true;
  }
  check(!threw, 'and does not lock the owner out of their own backup');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
