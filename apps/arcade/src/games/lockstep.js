/**
 * Two phones playing one game: lockstep with a small input delay.
 *
 * Both run the same deterministic simulation. A step only happens once both
 * players' inputs for it are known, so both always step with the same inputs
 * and never disagree. Your input is scheduled `delay` steps ahead - 4 steps
 * is 67 ms, which covers most connections - so usually the other phone's
 * input for the next step has already arrived and nothing waits.
 *
 * Inputs travel over the unreliable channel (late is worse than lost), each
 * packet repeating the last 20 steps, so a lost packet is covered by the next.
 * Every 60 steps each side sends a hash of its state over the reliable channel;
 * a mismatch is reported, never silently played through.
 *
 * Packet: [u32 first step][u8 count][count x u8 input bits].
 */

const WINDOW = 20;
const HASH_EVERY = 60;

/**
 * @param {{
 *   net: { sendInput: (data: ArrayBuffer) => void, onInput: (handler: (data: ArrayBuffer) => void) => () => void, send: (message: object) => void, on: (type: string, handler: (message: any) => void) => () => void },
 *   side: 0 | 1,
 *   delay?: number,
 *   step: (inputs: [number, number]) => void,
 *   hash?: () => number,
 *   onDesync?: (step: number) => void,
 * }} options
 */
export function createLockstep({ net, side, delay = 4, step, hash, onDesync }) {
  /** The next step to simulate. */
  let frame = 0;
  const local = new Map();
  const remote = new Map();
  const hashes = new Map();
  let remoteSeen = 0;
  let stalledSince = 0;

  for (let f = 0; f < delay; f += 1) {
    local.set(f, 0);
    remote.set(f, 0);
  }

  const offInput = net.onInput((data) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 5) return;
    const view = new DataView(data);
    const first = view.getUint32(0);
    const count = Math.min(view.getUint8(4), data.byteLength - 5);
    for (let i = 0; i < count; i += 1) {
      const f = first + i;
      if (f >= frame && !remote.has(f)) remote.set(f, view.getUint8(5 + i));
    }
    remoteSeen = performance.now();
  });

  const offHash = net.on('g-hash', ({ f, h }) => {
    const mine = hashes.get(f);
    if (mine !== undefined && mine !== h) onDesync?.(f);
  });

  function sendWindow() {
    const last = frame + delay - 1;
    const first = Math.max(0, last - WINDOW + 1);
    const count = last - first + 1;
    const buffer = new ArrayBuffer(5 + count);
    const view = new DataView(buffer);
    view.setUint32(0, first);
    view.setUint8(4, count);
    for (let i = 0; i < count; i += 1) view.setUint8(5 + i, local.get(first + i) ?? 0);
    net.sendInput(buffer);
  }

  return {
    get frame() {
      return frame;
    },

    /** Milliseconds the game has been waiting on the other phone (0 if not). */
    get waiting() {
      return stalledSince ? performance.now() - stalledSince : 0;
    },

    /**
     * Runs up to `steps` steps with `bits` as your input, as far as the other
     * phone's inputs allow. Returns how many ran.
     */
    advance(steps, bits) {
      let ran = 0;
      for (let i = 0; i < steps; i += 1) {
        const ahead = frame + delay;
        if (!local.has(ahead)) local.set(ahead, bits & 0xff);
        if (!remote.has(frame)) break;
        const mine = local.get(frame);
        const theirs = remote.get(frame);
        step(side === 0 ? [mine, theirs] : [theirs, mine]);
        local.delete(frame - WINDOW);
        remote.delete(frame);
        frame += 1;
        ran += 1;
        if (hash && frame % HASH_EVERY === 0) {
          const h = hash();
          hashes.set(frame, h);
          hashes.delete(frame - HASH_EVERY * 10);
          net.send({ type: 'g-hash', f: frame, h });
        }
      }
      if (steps > 0 && ran === 0) stalledSince ||= performance.now();
      else if (ran > 0) stalledSince = 0;
      sendWindow();
      return ran;
    },

    dispose() {
      offInput();
      offHash();
    },
  };
}

/** A cheap hash of plain numbers in a state, for the desync check. */
export function hashNumbers(values) {
  let h = 2166136261;
  for (const value of values) {
    const scaled = Math.round(value * 1000);
    h = Math.imul(h ^ (scaled & 0xffff), 16777619);
    h = Math.imul(h ^ ((scaled >>> 16) & 0xffff), 16777619);
  }
  return h >>> 0;
}
