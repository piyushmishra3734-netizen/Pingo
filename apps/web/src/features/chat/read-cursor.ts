/**
 * Where you have read up to, when nobody else is being told.
 *
 * ## The problem this exists for
 *
 * One timestamp on the server does two jobs: it clears your own unread badge
 * and it tells the sender you saw their message. They are the same fact, so
 * they were the same column - and that means switching read receipts off, by
 * not writing it, would leave every conversation you have read looking unread
 * to you, for ever.
 *
 * So with receipts off the cursor is kept here instead: on this device, in the
 * open, doing the half of the job that is nobody else's business. The other
 * half is deferred, not cancelled.
 *
 * ## Until you reply
 *
 * Answering a message tells the sender you read it more plainly than any tick
 * does. So the moment a reply is sent, the held cursor is written to the server
 * and the receipt lands with it. That is the whole of the feature: not "never",
 * but "not before I say something".
 *
 * ## Per device, on purpose
 *
 * A cursor that syncs is a cursor that is published, which is the thing being
 * avoided. Reading on a phone therefore does not clear the badge on a laptop
 * while receipts are off - which is the honest price of not telling anybody,
 * and it corrects itself the moment either device replies.
 */

const KEY = 'pingo:local_read_cursor_v1';

type Cursors = Record<string, number>;

function read(): Cursors {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Cursors) : {};
  } catch {
    return {};
  }
}

function write(cursors: Cursors): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cursors));
  } catch {
    // Out of quota or private mode: the badge stays, which is a nuisance and
    // not a leak. Nothing here is worth failing a read for.
  }
}

/** Records that this conversation has been read up to now, locally. */
export function holdRead(conversationId: string): void {
  const cursors = read();
  cursors[conversationId] = Date.now();
  write(cursors);
}

/** How far this device has read, or 0 if it has never held one. */
export function heldRead(conversationId: string): number {
  return read()[conversationId] ?? 0;
}

/** True when there is a held cursor waiting to be published on a reply. */
export function hasHeldRead(conversationId: string): boolean {
  return heldRead(conversationId) > 0;
}

/** Forgets the held cursor, once the server has been told the real thing. */
export function releaseRead(conversationId: string): void {
  const cursors = read();
  if (cursors[conversationId] === undefined) return;
  delete cursors[conversationId];
  write(cursors);
}
