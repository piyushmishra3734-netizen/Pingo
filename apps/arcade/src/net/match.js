import { fetchIceServers } from './ice.js';
import { createPeer } from './peer.js';
import { connectSignaling } from './signaling.js';

/**
 * A room of up to six: signalling, one peer link to each other player (a
 * mesh), and the session they drive.
 *
 * Every pair has its own link (net/peer.js), and in every pair it is the
 * player who was there first that sends the offer: a newcomer is told who is
 * already in (`welcome.others`) and waits; everyone already in is told of the
 * newcomer (`join`) and offers. Handshake messages are addressed with `to`
 * and arrive with `from`.
 *
 * The session only cares whether anyone is here: `paired` when the first
 * link opens, `dropped` when the last one closes.
 *
 * A player keeps the same id across a relay blink (it is theirs, sent with
 * the connect), so a phone whose socket dropped for a second is not mistaken
 * for a stranger: a `join` from an id whose link is still up is checked with
 * a ping, and only rebuilt if that link is really dead.
 */

const PING_EVERY_MS = 2000;
const RECONNECT_AFTER_MS = 2000;
/** A `join` while still linked: if the old link has not answered in this long, it is dead. */
const STALE_LINK_MS = 3000;

/** This page's own id in its room, kept for the life of the page. */
const MY_ID = Math.random().toString(36).slice(2, 10);

/**
 * @param {{
 *   session: ReturnType<import('../core/session.js').createSession>,
 *   signalUrl: string,
 *   onRtt?: (ms: number) => void,
 *   onFull?: () => void,
 *   onJoin?: (id: string) => void,
 *   onLeave?: (id: string) => void,
 * }} options
 */
export function createMatch({ session, signalUrl, onRtt, onFull, onJoin, onLeave }) {
  let roomId;
  let signaling;
  let iceServers;
  let reconnectTimer;
  let active = false;
  /**
   * One entry per other player.
   * @type {Map<string, { peer: ReturnType<typeof createPeer>, linked: boolean, lastPong: number, rtt?: number, ping?: ReturnType<typeof setInterval>, stale?: ReturnType<typeof setTimeout> }>}
   */
  const links = new Map();
  /** Handlers for control messages by type, and for raw input packets. */
  const handlers = new Map();
  const inputHandlers = new Set();
  let micTrack = null;
  let onVoice;
  const events = [];
  const note = (what) => {
    events.push(`${Math.round(performance.now())} ${what}`);
    if (events.length > 40) events.shift();
  };

  const anyLinked = () => [...links.values()].some((link) => link.linked);

  /** Closes one player's link; says so if it had been open. */
  function drop(id) {
    const link = links.get(id);
    if (!link) return;
    clearInterval(link.ping);
    clearTimeout(link.stale);
    link.peer.close();
    links.delete(id);
    note(`drop ${id}`);
    if (link.linked) onLeave?.(id);
    if (!anyLinked()) session.dropped();
  }

  function newLink(id, role) {
    drop(id);
    note(`link ${id} as ${role}`);
    const link = { linked: false, lastPong: 0 };
    link.peer = createPeer({
      role,
      iceServers,
      signal: (message) => signaling?.send({ ...message, to: id }),
      onOpen() {
        note(`open ${id}`);
        link.linked = true;
        if (micTrack) void link.peer.setMic(micTrack);
        session.paired();
        clearInterval(link.ping);
        const ping = () => link.peer.sendControl({ type: 'ping', t: performance.now() });
        link.ping = setInterval(ping, PING_EVERY_MS);
        ping();
        onJoin?.(id);
      },
      onClose: () => drop(id),
      onControl(message) {
        if (message.type === 'ping') link.peer.sendControl({ type: 'pong', t: message.t });
        if (message.type === 'pong') {
          link.lastPong = performance.now();
          link.rtt = Math.round(link.lastPong - message.t);
          // The bar shows the worst line in the room: that is the one lagging the game.
          onRtt?.(Math.max(...[...links.values()].map((l) => l.rtt ?? 0)));
        }
        for (const handler of handlers.get(message.type) ?? []) handler(message, id);
      },
      onInput(data) {
        for (const handler of inputHandlers) handler(data, id);
      },
      onAudio(stream) {
        onVoice?.(stream, id);
      },
    });
    links.set(id, link);
    return link;
  }

  function onMessage(message) {
    note(`recv ${message.type}${message.id ? ` ${message.id}` : ''}${message.from ? ` from ${message.from}` : ''}`);
    switch (message.type) {
      case 'welcome':
        // Everyone already here offers to us; get ready for each.
        for (const id of message.others ?? []) {
          if (links.get(id)?.linked) continue;
          session.guestFound();
          newLink(id, 'guest');
        }
        break;
      case 'join': {
        const { id } = message;
        if (!id || id === MY_ID) break;
        const link = links.get(id);
        if (!link?.linked) {
          session.guestFound();
          void newLink(id, 'host').peer.start();
          break;
        }
        // Linked already: their relay socket blinked, or they reloaded. A ping tells which.
        const asked = performance.now();
        link.peer.sendControl({ type: 'ping', t: asked });
        clearTimeout(link.stale);
        link.stale = setTimeout(() => {
          if (!active || link.lastPong >= asked) return;
          note(`stale ${id}, re-offering`);
          void newLink(id, 'host').peer.start();
        }, STALE_LINK_MS);
        break;
      }
      case 'offer': {
        // An offer from someone we have no link for yet: we are the newcomer to them.
        const from = message.from;
        if (!from) break;
        const link = links.get(from) ?? newLink(from, 'guest');
        void link.peer.handle(message);
        break;
      }
      case 'answer':
      case 'candidate':
        if (message.from) void links.get(message.from)?.peer.handle(message);
        break;
      case 'peer-left':
        // Their relay socket went, not necessarily them: the link itself says when they are gone.
        if (message.id && !links.get(message.id)?.linked) drop(message.id);
        break;
      case 'full':
        active = false;
        onFull?.();
        break;
      default:
    }
  }

  function connect() {
    signaling = connectSignaling(signalUrl, `${roomId}?me=${MY_ID}`, {
      onMessage,
      onClose() {
        signaling = undefined;
        if (!active) return;
        // Links that are up carry on without the relay; half-made ones are abandoned.
        for (const [id, link] of links) if (!link.linked) drop(id);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => active && connect(), RECONNECT_AFTER_MS);
      },
    });
  }

  function sendTo(id, message) {
    links.get(id)?.peer.sendControl(message);
  }

  function on(type, handler) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(handler);
    return () => handlers.get(type).delete(handler);
  }

  function onInput(handler) {
    inputHandlers.add(handler);
    return () => inputHandlers.delete(handler);
  }

  return {
    /** This page's id in the room. */
    get me() {
      return MY_ID;
    },

    /** Joins room `id`. */
    async begin(id) {
      roomId = id;
      active = true;
      iceServers ??= await fetchIceServers(signalUrl);
      if (active) connect();
    },

    /** Leaves the room and closes everything, quietly. */
    end() {
      active = false;
      clearTimeout(reconnectTimer);
      for (const id of [...links.keys()]) drop(id);
      signaling?.close();
      signaling = undefined;
    },

    /** To everyone in the room, reliably. */
    send(message) {
      for (const link of links.values()) if (link.linked) link.peer.sendControl(message);
    },

    /** To one player, reliably. */
    sendTo,

    /** Control messages of one type, from anyone: handler(message, fromId). Returns an unsubscribe. */
    on,

    /** Raw input packets, from anyone: handler(data, fromId). Returns an unsubscribe. */
    onInput,

    /**
     * A one-to-one line to a single player, shaped like the old two-player
     * match, for the games: they only ever see their opponent.
     */
    link(id) {
      return {
        send: (message) => sendTo(id, message),
        on: (type, handler) => on(type, (message, from) => from === id && handler(message)),
        sendInput: (data) => links.get(id)?.peer.sendInput(data),
        onInput: (handler) => onInput((data, from) => from === id && handler(data)),
      };
    },

    /** Whether anyone at all is linked. */
    get linked() {
      return anyLinked();
    },

    /** The ids of everyone linked. */
    get others() {
      return [...links].filter(([, link]) => link.linked).map(([id]) => id);
    },

    /** Milliseconds since the quietest linked player last answered, or null. */
    get silentFor() {
      const pongs = [...links.values()].filter((l) => l.linked && l.lastPong).map((l) => l.lastPong);
      return pongs.length ? performance.now() - Math.min(...pongs) : null;
    },

    /** Your microphone to everyone (null for off). Kept across reconnects and new arrivals. */
    setMic(track) {
      micTrack = track;
      for (const link of links.values()) void link.peer.setMic(track);
    },

    /** Called with each player's voice as it arrives: handler(stream, id). */
    onVoice(handler) {
      onVoice = handler;
    },

    /** Everything a stalled handshake needs explaining with. Dev probes only. */
    debug() {
      return {
        roomId,
        me: MY_ID,
        active,
        signaling: signaling ? 'connected' : 'none',
        iceServers: iceServers?.map((server) => server.urls),
        links: Object.fromEntries([...links].map(([id, link]) => [id, { linked: link.linked, rtt: link.rtt, peer: link.peer.state }])),
        events: [...events],
      };
    },
  };
}
