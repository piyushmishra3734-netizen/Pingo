/**
 * What you had typed but not sent.
 *
 * ## Why this was the easiest thing in the app to lose
 *
 * The composer's text was React state and nothing else. Switching to another
 * conversation unmounted it, and the half-written message went with it - as did
 * a reload, a crash, and on a phone simply answering a call, because the system
 * is free to discard a backgrounded tab whenever it wants the memory. The one
 * message in the app that only exists on the device was also the only one with
 * nowhere to be.
 *
 * ## Sealed, like everything else here
 *
 * A draft is plaintext by definition - it has not been encrypted for anybody
 * yet, because the recipient list is read at send time. That is the same
 * position the outbox is in, and it gets the same answer: the database key is
 * what stands between an unsent message and whoever picks the device up.
 *
 * ## Per conversation, and deleted rather than emptied
 *
 * An empty draft is not a draft. Storing one would leave a record per
 * conversation ever opened, which is a list of who you have talked to written
 * in the clear as keys - the keys are not sealed, only the values, and the same
 * reasoning that makes `message-rows` keys safe (the server already knows them)
 * does not apply to a thing the server never sees.
 */
import { openRecord, sealRecord } from '../../lib/crypto/session.js';
import { STORE, localDelete, localGet, localSet } from '../../lib/local/db.js';

export async function readDraft(conversationId: string): Promise<string> {
  const stored = await openRecord<string>(await localGet<unknown>(STORE.drafts, conversationId));
  return typeof stored === 'string' ? stored : '';
}

export async function saveDraft(conversationId: string, text: string): Promise<void> {
  if (text.trim().length === 0) {
    await localDelete(STORE.drafts, conversationId);
    return;
  }
  await localSet(STORE.drafts, conversationId, await sealRecord(text));
}
