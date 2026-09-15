/**
 * One match's lifecycle, as a state machine and nothing else.
 *
 * No imports, on purpose: no three, no WebRTC, no DOM. The lobby reads the
 * state to colour its dome light, the audio engine listens for the moment it
 * becomes PAIRED, and either can be replaced without touching this file -
 * which is what makes the light logic testable, and what will let this 3D
 * lobby be swapped for PINGO's own screens later.
 *
 * ## Why an action that does not apply is ignored rather than thrown
 *
 * Every action here is caused by the network, and the network does not take
 * turns: a `dropped` can arrive after the player has already stood up, an ICE
 * failure after a retry has begun. Throwing would take the lobby down over a
 * message that only says something already known. `send` reports whether the
 * state moved, so a caller that cares can still tell.
 */

/** @typedef {'IDLE'|'WAITING'|'CONNECTING'|'PAIRED'} SessionState */

export const State = {
  /** Nobody is sitting. Light off. */
  IDLE: 'IDLE',
  /** Seated, invite out, no guest yet. Light blinks orange. */
  WAITING: 'WAITING',
  /** A guest arrived; signalling and ICE are in flight. Still orange. */
  CONNECTING: 'CONNECTING',
  /** The data channel is open. Light turns green, and the coin drops. */
  PAIRED: 'PAIRED',
};

export const Light = {
  OFF: 'off',
  BLINK_ORANGE: 'blink-orange',
  GREEN: 'green',
};

/**
 * The light is a function of the state, never a second thing to keep in sync.
 *
 * WAITING and CONNECTING look identical on purpose: to the person in the chair
 * "invited" and "connecting" are the same wait, and a light that flickered
 * between two oranges would only look broken.
 */
const LIGHT_FOR = {
  [State.IDLE]: Light.OFF,
  [State.WAITING]: Light.BLINK_ORANGE,
  [State.CONNECTING]: Light.BLINK_ORANGE,
  [State.PAIRED]: Light.GREEN,
};

/**
 * Which action leads where. Anything absent is ignored - see the note above.
 *
 * `paired` is reachable from WAITING as well as CONNECTING: a data channel can
 * open before the app has finished processing the guest's arrival, and the
 * green light must not wait on bookkeeping.
 *
 * `dropped` returns to WAITING rather than IDLE: the player is still in the
 * chair, so the honest state is "waiting for someone", invite still live.
 */
const TRANSITIONS = {
  [State.IDLE]: { sit: State.WAITING },
  [State.WAITING]: { guestFound: State.CONNECTING, paired: State.PAIRED, leave: State.IDLE },
  [State.CONNECTING]: { paired: State.PAIRED, dropped: State.WAITING, leave: State.IDLE },
  [State.PAIRED]: { dropped: State.WAITING, leave: State.IDLE },
};

/**
 * @param {{ state?: SessionState }} [options] - starting state, for tests.
 */
export function createSession(options = {}) {
  let state = options.state ?? State.IDLE;
  const listeners = new Set();

  const emit = (change) => {
    // Copied first: a listener that subscribes or unsubscribes while the round
    // is running must not change who hears about this change.
    for (const listener of [...listeners]) listener(change);
  };

  return {
    get state() {
      return state;
    },

    /** What the dome light should be doing: off, blink-orange or green. */
    get light() {
      return LIGHT_FOR[state];
    },

    /**
     * Applies an action. Returns true when the state moved.
     *
     * @param {'sit'|'guestFound'|'paired'|'dropped'|'leave'} action
     */
    send(action) {
      const next = TRANSITIONS[state][action];
      if (!next) return false;

      const from = state;
      state = next;
      emit({ action, from, to: next, light: LIGHT_FOR[next] });
      return true;
    },

    /** The player sat down at a cabinet. */
    sit() {
      return this.send('sit');
    },
    /** A guest joined the room, so connecting starts. */
    guestFound() {
      return this.send('guestFound');
    },
    /** The data channel is open: green light, coin sound. */
    paired() {
      return this.send('paired');
    },
    /** Connection lost, or never established: back to waiting, still seated. */
    dropped() {
      return this.send('dropped');
    },
    /** The player stood up, or cancelled the invite. */
    leave() {
      return this.send('leave');
    },

    /**
     * Subscribes to state changes. Returns the unsubscribe function.
     *
     * @param {(change: {
     *   action: string, from: SessionState, to: SessionState, light: string,
     * }) => void} listener
     */
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
