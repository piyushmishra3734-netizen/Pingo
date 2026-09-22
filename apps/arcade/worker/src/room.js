/**
 * The rules of a room, as pure functions - no sockets, no runtime - so they
 * can be tested with plain node and the Durable Object only wires them up.
 */

/**
 * A room holds up to six: you and five friends in the same world. Every pair
 * gets its own peer-to-peer link (a mesh), so the machines stay one versus
 * one - whoever sits across from you - while everyone walks, talks and chats.
 */
export const MAX_PEERS = 6;

/** A short id for a player, unique within their room; handshakes are addressed with it. */
export function newPlayerId(taken) {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8);
    if (!taken.includes(id)) return id;
  }
}

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
 * With a mesh, "host" only means "first in": in every pair it is the player
 * who was already there that sends the offer, so the newcomer is a guest to
 * each of them. The role is kept for clients that still speak the two-player
 * protocol, where it meant the same thing.
 *
 * @param {string[]} present
 * @returns {'host' | 'guest' | null}
 */
export function admit(present) {
  if (present.length >= MAX_PEERS) return null;
  return present.length === 0 ? 'host' : 'guest';
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
  // `to` addresses one player; anything else is a client of the old protocol.
  if (message.to !== undefined && typeof message.to !== 'string') return null;
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
  // The arcade's own site (Cloudflare Pages project `pingo-arcade`), and its
  // preview deploys.
  /^https:\/\/([a-z0-9-]+\.)?pingo-arcade\.pages\.dev$/,
];

/** @param {string | null} origin */
export function allowedOrigin(origin) {
  return Boolean(origin) && ALLOWED_ORIGINS.some((pattern) => pattern.test(origin));
}
