import { DurableObject } from 'cloudflare:workers';

import { ROOM_ID, admit, allowedOrigin, parseForward } from './room.js';

/**
 * PINGO Arcade signalling.
 *
 *   GET /room/<id>   WebSocket - join a two-player room
 *   GET /ice         the ICE servers a client should use (STUN, plus TURN
 *                    when the TURN secrets are set)
 *
 * ## The protocol, server to client
 *
 *   { type: 'welcome', role, peers }   you are in; `peers` counts you
 *   { type: 'join' }                   somebody arrived - you send the offer
 *   { type: 'peer-left' }              they went; you are the host now
 *   { type: 'full' }                   then close 4001: two are already playing
 *   offer / answer / candidate         relayed verbatim from the other player
 */

export class ArcadeRoom extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());

    // Hibernation-aware accept: an idle room costs nothing while two players
    // sit and wait, and the role survives in the socket's attachment.
    this.ctx.acceptWebSocket(server);

    const present = this.#players().map((ws) => ws.deserializeAttachment().role);
    const role = admit(present);

    if (!role) {
      server.send(JSON.stringify({ type: 'full' }));
      server.close(4001, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const others = this.#players();
    server.serializeAttachment({ role });
    server.send(JSON.stringify({ type: 'welcome', role, peers: others.length + 1 }));
    for (const ws of others) ws.send(JSON.stringify({ type: 'join' }));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    const message = parseForward(raw);
    if (!message) return;
    const text = JSON.stringify(message);
    for (const other of this.#players()) if (other !== ws) other.send(text);
  }

  webSocketClose(ws, code) {
    this.#leave(ws);
    // Safe whether or not the runtime already answered the close frame.
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }

  webSocketError(ws) {
    this.#leave(ws);
  }

  /** Sockets that were admitted - a refused third one has no role. */
  #players() {
    return this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment()?.role);
  }

  #leave(ws) {
    // A refused socket closing is not a player leaving.
    if (!ws.deserializeAttachment()?.role) return;
    ws.serializeAttachment({ role: null });
    for (const other of this.#players()) {
      if (other === ws) continue;
      // Whoever stays becomes the host, so the next arrival gets an offer.
      other.serializeAttachment({ role: 'host' });
      other.send(JSON.stringify({ type: 'peer-left' }));
    }
  }
}

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * STUN always; Cloudflare TURN when configured.
 *
 * Direct connections fail behind carrier-grade NAT, which is common on Indian
 * mobile networks; TURN relays those. Credentials are minted per request with
 * a one-hour life, so nothing long-lived ever reaches a browser.
 */
async function iceServers(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN;
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
    if (!response.ok) return STUN;
    const { iceServers: servers } = await response.json();
    return [...STUN, ...(Array.isArray(servers) ? servers : [servers])];
  } catch {
    return STUN;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (url.pathname === '/ice') {
      if (!allowedOrigin(origin)) return new Response('forbidden', { status: 403 });
      return Response.json(
        { iceServers: await iceServers(env) },
        {
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Cache-Control': 'no-store',
            Vary: 'Origin',
          },
        },
      );
    }

    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!match || !ROOM_ID.test(match[1])) return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket', { status: 426 });
    }
    if (!allowedOrigin(origin)) return new Response('forbidden', { status: 403 });

    return env.ROOMS.getByName(`arcade:${match[1]}`).fetch(request);
  },
};
