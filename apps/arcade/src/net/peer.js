/**
 * One WebRTC connection to the other player, and its two data channels.
 *
 *   control  reliable, ordered   - handshakes, pings, anything that must arrive
 *   input    unordered, no resends (`maxRetransmits: 0`) - game inputs, where
 *            a late packet is worse than a lost one: the next frame's input
 *            supersedes it anyway
 *
 * The host creates both channels and the offer; the guest answers and
 * receives the channels. `control` opening is the one moment that means
 * "paired", and its closing - or the connection failing - means "dropped".
 *
 * ICE candidates can arrive before the description they belong to (the
 * network does not wait for our `await`s), so they are held until the remote
 * description is set, then applied in order.
 */

/**
 * @param {{
 *   role: 'host' | 'guest',
 *   iceServers: RTCIceServer[],
 *   signal: (message: object) => void,
 *   onOpen: () => void,
 *   onClose: () => void,
 *   onControl?: (message: object) => void,
 *   onInput?: (data: ArrayBuffer | string) => void,
 *   onAudio?: (stream: MediaStream) => void,
 * }} options
 */
export function createPeer({ role, iceServers, signal, onOpen, onClose, onControl, onInput, onAudio }) {
  const connection = new RTCPeerConnection({ iceServers });
  const heldCandidates = [];
  let control;
  let input;
  let finished = false;

  /** Ends the connection once, and says so once - whoever notices first. */
  const finish = (notify) => {
    if (finished) return;
    finished = true;
    connection.close();
    if (notify) onClose();
  };

  function wire(channel) {
    if (channel.label === 'control') {
      control = channel;
      channel.addEventListener('open', () => onOpen());
      channel.addEventListener('close', () => finish(true));
      channel.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        onControl?.(message);
      });
    } else if (channel.label === 'input') {
      input = channel;
      channel.binaryType = 'arraybuffer';
      channel.addEventListener('message', (event) => onInput?.(event.data));
    }
  }

  connection.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) signal({ type: 'candidate', candidate: candidate.toJSON() });
  });

  connection.addEventListener('connectionstatechange', () => {
    // `disconnected` is often a blip that recovers on its own; `failed` is not.
    if (connection.connectionState === 'failed') finish(true);
  });

  /*
   * Voice: one audio transceiver, made with the connection and sending
   * nothing until the mic is switched on. Turning the mic on later is then a
   * replaceTrack on the existing sender - no second offer and answer.
   */
  let voice;
  connection.addEventListener('track', ({ track, streams }) => {
    if (track.kind === 'audio') onAudio?.(streams[0] ?? new MediaStream([track]));
  });

  if (role === 'host') {
    voice = connection.addTransceiver('audio', { direction: 'sendrecv' });
    wire(connection.createDataChannel('control'));
    wire(connection.createDataChannel('input', { ordered: false, maxRetransmits: 0 }));
  } else {
    connection.addEventListener('datachannel', ({ channel }) => wire(channel));
  }

  async function applyHeldCandidates() {
    while (heldCandidates.length > 0) {
      await connection.addIceCandidate(heldCandidates.shift()).catch(() => {});
    }
  }

  return {
    /** Host only: makes and sends the offer. */
    async start() {
      if (role !== 'host') return;
      await connection.setLocalDescription(await connection.createOffer());
      signal({ type: 'offer', sdp: connection.localDescription.sdp });
    },

    /** A handshake message relayed from the other player. */
    async handle(message) {
      if (finished) return;
      if (message.type === 'offer' && role === 'guest') {
        await connection.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        // The host offered a voice line; answer that we can send on it too.
        voice = connection.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
        if (voice) voice.direction = 'sendrecv';
        await applyHeldCandidates();
        await connection.setLocalDescription(await connection.createAnswer());
        signal({ type: 'answer', sdp: connection.localDescription.sdp });
      } else if (message.type === 'answer' && role === 'host') {
        await connection.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        await applyHeldCandidates();
      } else if (message.type === 'candidate' && message.candidate) {
        if (connection.remoteDescription) {
          await connection.addIceCandidate(message.candidate).catch(() => {});
        } else {
          heldCandidates.push(message.candidate);
        }
      }
    },

    sendControl(message) {
      if (control?.readyState === 'open') control.send(JSON.stringify(message));
    },

    sendInput(data) {
      if (input?.readyState === 'open') input.send(data);
    },

    /** Puts a microphone track on the voice line, or takes it off (null). */
    async setMic(track) {
      await voice?.sender.replaceTrack(track);
    },

    /** Closes without calling `onClose`: the caller already knows. */
    close() {
      finish(false);
    },

    /** Every state the connection has, for diagnosing a handshake that stalls. */
    get state() {
      return {
        connection: connection.connectionState,
        ice: connection.iceConnectionState,
        gathering: connection.iceGatheringState,
        signaling: connection.signalingState,
        control: control?.readyState ?? 'none',
        heldCandidates: heldCandidates.length,
      };
    },
  };
}
