/**
 * The rules of a room, as pure functions - no sockets, no runtime - so they
 * can be tested with plain node and the Durable Object only wires them up.
 */

/** A room holds exactly two players: the arcade is one versus machine. */
export const MAX_PEERS = 2;

/** Room ids are short, lowercase and URL-safe. Anything else is refused. */
export const ROOM_ID = /^[a-z0-9]{6,32}$/;

/** The only client messages worth relaying: the WebRTC handshake. */
export const FORWARDED = new Set(['offer', 'answer', 'candidate']);

/**
 * An SDP offer is a few kilobytes; a candidate a few hundred bytes. Anything
 * bigger is not a handshake, and relaying it would make this a free pipe.
 */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * The role a newcomer gets, given the roles already in the room - or null when
 * the room is full.
 *
 * The host is whoever is already waiting, and the host is the one who sends
 * the offer when somebody arrives. When a host leaves, the player who stays is
 * promoted (see the Durable Object), so a room that has emptied to one always
 * has a host, and every newcomer is a guest.
 *
 * @param {string[]} present
 * @returns {'host' | 'guest' | null}
 */
export function admit(present) {
  if (present.length >= MAX_PEERS) return null;
  return present.includes('host') ? 'guest' : 'host';
}

/**
 * A relayable message from a client, or null to drop it silently.
 *
 * @param {string | ArrayBuffer} raw
 * @returns {{ type: string } | null}
 */
export function parseForward(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null;
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object' || !FORWARDED.has(message.type)) return null;
  return message;
}

/*
 * Who may open a room: PINGO's own sites, and a developer's machine.
 *
 * A WebSocket is not subject to CORS, so without this any page anywhere could
 * use the relay. LAN addresses are allowed because the target device - a
 * budget Android - is tested against a laptop's dev server over Wi-Fi.
 */
const ALLOWED_ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^http:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)?pingochat\.pages\.dev$/,
  /^https:\/\/([a-z0-9-]+\.)?pingochat\.xyz$/,
];

/** @param {string | null} origin */
export function allowedOrigin(origin) {
  return Boolean(origin) && ALLOWED_ORIGINS.some((pattern) => pattern.test(origin));
}
