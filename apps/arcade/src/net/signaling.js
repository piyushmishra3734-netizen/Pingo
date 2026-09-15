/**
 * The WebSocket to the signalling Worker, and nothing else: JSON in, JSON out.
 *
 * It only carries the handshake - a few messages per match - so it has no
 * queue: a message sent while the socket is not open is dropped, and the peer
 * layer's own timeouts deal with a handshake that never completed.
 *
 * @param {string} baseUrl - e.g. wss://pingo-arcade-signal.<account>.workers.dev
 * @param {string} roomId
 * @param {{ onMessage: (message: object) => void, onClose: (code: number) => void }} handlers
 */
export function connectSignaling(baseUrl, roomId, { onMessage, onClose }) {
  const socket = new WebSocket(`${baseUrl}/room/${roomId}`);
  let closedByUs = false;

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    onMessage(message);
  });

  socket.addEventListener('close', (event) => {
    if (!closedByUs) onClose(event.code);
  });

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    /** Leaves the room; `onClose` is not called for a close we asked for. */
    close() {
      closedByUs = true;
      socket.close(1000, 'left');
    },
  };
}
