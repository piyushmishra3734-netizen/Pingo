import { DurableObject } from 'cloudflare:workers';

import { ROOM_ID, admit, allowedOrigin, newPlayerId, parseForward } from './room.js';

/**
 * PINGO Arcade signalling.
 *
 *   GET /room/<id>   WebSocket - join a room of up to six
 *   GET /ice         the ICE servers a client should use (STUN, plus TURN
 *                    when the TURN secrets are set)
 *
 * Every player links to every other (a mesh); this only introduces them.
 *
 * ## The protocol, server to client
 *
 *   { type: 'welcome', id, others, role, peers }
 *                              you are in as `id`; `others` are the ids
 *                              already here, who will each send you an offer
 *   { type: 'join', id }       `id` arrived - you send them the offer
 *   { type: 'peer-left', id }  `id` went
 *   { type: 'full' }           then close 4001: six are already here
 *   offer / answer / candidate relayed with `from`, to the player named in
 *                              `to` (or to everyone, for an old client)
 */

/** A socket that has sent no heartbeat in this long is a ghost (the client beats every 20 s). */
const GHOST_MS = 50_000;

export class ArcadeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime, without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"keepalive"}', '{"type":"keepalive-ok"}'));
  }

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    // A client names itself, so a phone whose socket blinked comes back as the
    // same player rather than a stranger; an old client doesn't, and gets one.
    const asked = new URL(request.url).searchParams.get('me');
    const own = asked && /^[a-z0-9]{4,12}$/.test(asked) ? asked : null;
    if (own) {
      for (const ws of this.#players()) {
        if (ws.deserializeAttachment().id !== own) continue;
        // Their old socket, still open here: it is them, coming back.
        this.#leave(ws);
        try {
          ws.close(4003, 'replaced');
        } catch {
          /* already gone */
        }
      }
    }

    // Hibernation-aware accept: an idle room costs nothing while two players
    // sit and wait, and the role survives in the socket's attachment.
    this.ctx.acceptWebSocket(server);

    /*
     * A phone that lost its network leaves its socket open here until the
     * runtime notices, which can be minutes - and while it sits there the room
     * looks full to that same player coming back. Silent ones are let go first.
     */
    const now = Date.now();
    for (const ws of this.#players()) {
      // Only a client that has beaten before can be judged by its silence;
      // an older one that never beats is left alone, as it always was.
      const heard = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime();
      if (heard && now - heard > GHOST_MS) {
        this.#leave(ws);
        try {
          ws.close(4002, 'silent');
        } catch {
          /* already gone */
        }
      }
    }

    const others = this.#players();
    const role = admit(others.map((ws) => ws.deserializeAttachment().role));

    if (!role) {
      server.send(JSON.stringify({ type: 'full' }));
      server.close(4001, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const ids = others.map((ws) => ws.deserializeAttachment().id);
    const id = own ?? newPlayerId(ids);
    server.serializeAttachment({ role, id });
    server.send(JSON.stringify({ type: 'welcome', id, others: ids, role, peers: others.length + 1 }));
    for (const ws of others) ws.send(JSON.stringify({ type: 'join', id }));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    const message = parseForward(raw);
    if (!message) return;
    const from = ws.deserializeAttachment()?.id;
    if (!from) return;
    const text = JSON.stringify({ ...message, from });
    for (const other of this.#players()) {
      if (other === ws) continue;
      if (message.to !== undefined && other.deserializeAttachment().id !== message.to) continue;
      other.send(text);
    }
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
    const gone = ws.deserializeAttachment();
    if (!gone?.role) return;
    ws.serializeAttachment({ role: null, id: gone.id });
    for (const other of this.#players()) {
      if (other === ws) continue;
      // An old two-player client expects to become the host when its friend goes.
      const stay = other.deserializeAttachment();
      if (this.#players().length <= 2) other.serializeAttachment({ ...stay, role: 'host' });
      other.send(JSON.stringify({ type: 'peer-left', id: gone.id }));
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
