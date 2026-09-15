/**
 * Room ids and invite links.
 *
 * `crypto.getRandomValues` rather than `randomUUID`: the latter needs a secure
 * context, and a phone testing against a laptop over Wi-Fi is on plain http.
 */

/** No 0/o, 1/l/i: an id somebody might read out loud stays unambiguous. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Must match the Worker's own rule (worker/src/room.js). */
const ROOM_ID = /^[a-z0-9]{6,32}$/;

/** Ten characters from 31: ~49 bits, far past anything guessable by walking ids. */
export function newRoomId(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/** The room in a URL's query, if it is a valid one. */
export function roomFromSearch(search) {
  const id = new URLSearchParams(search).get('room');
  return id && ROOM_ID.test(id) ? id : null;
}

/** The seat the link asks its opener to take: B unless the host sat at B. */
export function seatFromSearch(search) {
  return new URLSearchParams(search).get('seat') === 'A' ? 'A' : 'B';
}

/**
 * The link a host sends: the page, the room, and - only when the host sat at
 * seat B - which seat the guest should take instead.
 */
export function inviteUrl(pageUrl, roomId, hostSeat) {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomId);
  if (hostSeat === 'B') url.searchParams.set('seat', 'A');
  return url.toString();
}
