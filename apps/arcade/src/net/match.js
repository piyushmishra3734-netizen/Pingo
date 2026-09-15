import { fetchIceServers } from './ice.js';
import { createPeer } from './peer.js';
import { connectSignaling } from './signaling.js';

/**
 * A match: signalling, the peer connection, and the session they drive.
 *
 * The session is told what the network did - `guestFound`, `paired`,
 * `dropped` - and never the other way round. Anything that arrives late or
 * twice (a `peer-left` after a channel already closed, a close after the
 * player stood up) is harmless, because the session ignores actions that do
 * not apply to its state.
 *
 *   host:  welcome -> join -> offer -> answer -> control open: PAIRED
 *   guest: welcome (a host is here) -> offer -> answer -> control open: PAIRED
 */

const PING_EVERY_MS = 2000;
const RECONNECT_AFTER_MS = 2000;

/**
 * @param {{
 *   session: ReturnType<import('../core/session.js').createSession>,
 *   signalUrl: string,
 *   onRtt?: (ms: number) => void,
 *   onRole?: (role: 'host' | 'guest') => void,
 *   onFull?: () => void,
 * }} options
 */
export function createMatch({ session, signalUrl, onRtt, onRole, onFull }) {
  let roomId;
  let signaling;
  let peer;
  let iceServers;
  let pingTimer;
  let reconnectTimer;
  let active = false;
  let role;
  /** The last few things that happened, oldest first - read by `debug()`. */
  const events = [];
  const note = (what) => {
    events.push(`${Math.round(performance.now())} ${what}`);
    if (events.length > 30) events.shift();
  };

  function stopPing() {
    clearInterval(pingTimer);
    pingTimer = undefined;
  }

  function dropPeer() {
    stopPing();
    peer?.close();
    peer = undefined;
  }

  /** The other player is gone, or never quite arrived: back to waiting. */
  function dropped() {
    dropPeer();
    session.dropped();
  }

  function newPeer(role) {
    dropPeer();
    note(`new peer as ${role}`);
    peer = createPeer({
      role,
      iceServers,
      signal: (message) => {
        note(`send ${message.type}`);
        signaling?.send(message);
      },
      onOpen() {
        note('control open');
        session.paired();
        stopPing();
        pingTimer = setInterval(() => peer?.sendControl({ type: 'ping', t: performance.now() }), PING_EVERY_MS);
        peer.sendControl({ type: 'ping', t: performance.now() });
      },
      onClose: dropped,
      onControl(message) {
        if (message.type === 'ping') peer?.sendControl({ type: 'pong', t: message.t });
        if (message.type === 'pong') onRtt?.(Math.round(performance.now() - message.t));
      },
    });
    return peer;
  }

  function onMessage(message) {
    note(`recv ${message.type}${message.role ? ` (${message.role})` : ''}`);
    switch (message.type) {
      case 'welcome':
        role = message.role;
        onRole?.(message.role);
        // A guest arrives to a host who is already waiting: connecting starts
        // now, and the host's offer is on its way.
        if (message.role === 'guest') {
          session.guestFound();
          newPeer('guest');
        }
        break;
      case 'join':
        session.guestFound();
        void newPeer('host').start();
        break;
      case 'offer':
      case 'answer':
      case 'candidate':
        void peer?.handle(message);
        break;
      case 'peer-left':
        // The Worker has made us the host; the next arrival gets our offer.
        role = 'host';
        onRole?.('host');
        dropped();
        break;
      case 'full':
        active = false;
        onFull?.();
        break;
      default:
    }
  }

  function connect() {
    signaling = connectSignaling(signalUrl, roomId, {
      onMessage,
      onClose() {
        signaling = undefined;
        if (!active) return;
        // The relay went away (a network change, a Worker restart). The
        // player is still in the chair: wait, then knock again.
        dropped();
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => active && connect(), RECONNECT_AFTER_MS);
      },
    });
  }

  return {
    /** Joins `id` - as host if nobody is there, as guest if somebody is. */
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
      dropPeer();
      signaling?.close();
      signaling = undefined;
    },

    /** For Phase 2's games: the unreliable channel. */
    sendInput(data) {
      peer?.sendInput(data);
    },

    /** Everything a stalled handshake needs explaining with. Dev probes only. */
    debug() {
      return {
        roomId,
        role,
        active,
        signaling: signaling ? 'connected' : 'none',
        iceServers: iceServers?.map((server) => server.urls),
        peer: peer?.state ?? null,
        events: [...events],
      };
    },
  };
}
