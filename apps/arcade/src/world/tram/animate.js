/**
 * Tram motion: wheels, body sway, doors and steps, lantern flicker, and the
 * workshop's crane-style part swap.
 *
 * Nothing here owns a clock. Everything moves only when `update(dt)` is called,
 * so it pauses with the game. Smoothing uses the exact solution of a critically
 * damped spring, so one long step and many short ones land in the same place.
 */

/** Wheel radius when a wheel carries no userData.radius. */
export const WHEEL_RADIUS = 0.35;
/** Largest body roll, in radians (about 4 degrees). */
export const MAX_ROLL = (4 * Math.PI) / 180;
/** Door slide when a door carries no userData.openOffset. */
export const DOOR_OFFSET = 0.9;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** One critically damped spring step towards `target`; exact for any dt. */
function spring(s, target, omega, dt) {
  const delta = s.x - target;
  const temp = (s.v + omega * delta) * dt;
  const decay = Math.exp(-omega * dt);
  s.x = target + (delta + temp) * decay;
  s.v = (s.v - omega * temp) * decay;
}

/** True when `obj` sits somewhere below one of `roots`. */
function under(obj, roots) {
  for (let p = obj.parent; p; p = p.parent) if (roots.includes(p)) return true;
  return false;
}

function prepareCar(car) {
  // Parts that sway with the body. Only the top-most ones are moved, about the
  // car's origin, so a roof or door parented to the body is not rolled twice.
  const candidates = [car.body, car.roofMount, ...(car.doors || []), ...(car.steps || [])].filter(Boolean);
  const sway = candidates
    .filter((o, i) => candidates.indexOf(o) === i && !under(o, candidates))
    .map((o) => ({ o, x: o.position.x, y: o.position.y, rz: o.rotation.z }));

  const doors = (car.doors || []).map((o, i) => ({
    o,
    z: o.position.z,
    offset: o.userData.openOffset ?? (i % 2 ? DOOR_OFFSET : -DOOR_OFFSET),
  }));
  const steps = (car.steps || []).map((o) => ({ o, rx: o.rotation.x, angle: o.userData.openAngle ?? Math.PI / 2 }));

  const flicker = [];
  const seen = new Set();
  car.group.traverse((o) => {
    if (!o.userData.flicker) return;
    const mats = o.isLight ? [o] : [].concat(o.material || []);
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      const key = m.isLight ? 'intensity' : 'emissiveIntensity';
      if (typeof m[key] === 'number') flicker.push({ m, key, base: m[key], seed: flicker.length * 1.7 + 0.3 });
    }
  });

  return {
    car,
    sway,
    doors,
    steps,
    flicker,
    phase: Math.random() * 10,
    wheelRadii: (car.wheels || []).map((w) => w.userData.radius ?? WHEEL_RADIUS),
    roll: { x: 0, v: 0 },
    open: { x: 0, v: 0 },
    moving: { x: 0, v: 0 },
    glow: { x: 0, v: 0 },
  };
}

/**
 * Drives every car of a tram. Call `update(dt, state)` once a frame with:
 * - speed: metres per second along the line (wheels roll exactly this far),
 * - lean: -1..1, curve or wind push; rolls the body up to MAX_ROLL,
 * - doorsOpen: 0 shut ... 1 open; steps fold out before the doors slide and
 *   fold away after they shut,
 * - glow: 0 day ... 1 night; scales every userData.flicker lantern.
 *
 * `swapPart(options)` starts a crane swap that this same update drives.
 */
export function createTramAnimator(cars) {
  const states = cars.map(prepareCar);
  const swaps = new Set();
  let time = 0;

  return {
    update(dt, { speed = 0, lean = 0, doorsOpen = 0, glow = 0 } = {}) {
      if (!(dt > 0)) return;
      time += dt;
      const roll = Math.max(-1, Math.min(1, lean)) * MAX_ROLL;

      for (const s of states) {
        const { car } = s;
        const distance = speed * dt;
        car.wheels?.forEach((w, i) => {
          w.rotation.x = (w.rotation.x + distance / s.wheelRadii[i]) % (Math.PI * 2);
        });

        spring(s.roll, roll, 3, dt);
        spring(s.moving, clamp01(Math.abs(speed) / 6), 2, dt);
        spring(s.open, clamp01(doorsOpen), 3.5, dt);
        spring(s.glow, clamp01(glow), 2, dt);

        // A small rail-joint bob and shimmy that fades in with speed.
        const m = s.moving.x;
        const bob = 0.012 * m * Math.sin(time * 7.3 + s.phase) * Math.sin(time * 1.9 + s.phase);
        const r = s.roll.x + 0.004 * m * Math.sin(time * 2.3 + s.phase);
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        for (const p of s.sway) {
          p.o.position.x = p.x * cos - p.y * sin;
          p.o.position.y = p.x * sin + p.y * cos + bob;
          p.o.rotation.z = p.rz + r;
        }

        // One smoothed value, two overlapping windows: steps take the first
        // 60 percent, doors the last 65, so steps lead on open and trail on close.
        const stepsOut = clamp01(s.open.x / 0.6);
        const doorsOut = clamp01((s.open.x - 0.35) / 0.65);
        for (const d of s.doors) d.o.position.z = d.z + d.offset * doorsOut;
        for (const st of s.steps) st.o.rotation.x = st.rx + st.angle * stepsOut;

        for (const f of s.flicker) {
          const n = Math.sin(time * 11 + f.seed * 5) * 0.5 + Math.sin(time * 23.7 + f.seed * 13) * 0.3;
          f.m[f.key] = f.base * s.glow.x * (0.93 + 0.07 * n);
        }
      }

      for (const swap of swaps) swap.update(dt);
    },

    /** A crane swap driven by this animator's update; resolves when done. */
    swapPart(options) {
      const swap = swapPart(options);
      swaps.add(swap);
      swap.then(() => swaps.delete(swap));
      return swap;
    },
  };
}

export const SWAP_STATUSES = ['Lifting the old part', 'Securing the mounts', 'Ready to ride'];

const easeInOut = (t) => t * t * (3 - 2 * t);
/** Ends at 1 after dipping about 4 percent past it. */
const easeOutBack = (t) => {
  const c = 0.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/**
 * The workshop crane: `oldPart` (optional) rises `lift` metres and swings
 * away, then `newPart` is lowered from `lift` metres above its own current
 * position (its mount point, usually the origin of `parent`) and settles with
 * a small overshoot. `onStatus(text, progress)` hears every update, the text
 * following SWAP_STATUSES in order.
 *
 * Returns a Promise with an `update(dt)` method; nothing moves until that (or
 * the animator's update) is called.
 */
export function swapPart({ parent, oldPart = null, newPart, lift = 6, duration = 3.2, onStatus = () => {} }) {
  const target = newPart.position.clone();
  const oldStart = oldPart ? oldPart.position.clone() : null;
  const liftEnd = oldPart ? 0.45 : 0.1; // with nothing to remove, the hook just comes over
  const secureEnd = 0.95;
  let elapsed = 0;
  let phase = -1;
  let finished = false;
  let resolve;

  const promise = new Promise((r) => {
    resolve = r;
  });

  if (newPart.parent) newPart.parent.remove(newPart);

  const status = (index, progress) => {
    while (phase < index) {
      phase += 1;
      if (phase < index) onStatus(SWAP_STATUSES[phase], progress);
    }
    onStatus(SWAP_STATUSES[index], progress);
  };

  promise.update = (dt) => {
    if (finished || !(dt >= 0)) return;
    elapsed += dt;
    const t = clamp01(elapsed / duration);

    if (oldPart && oldPart.parent) {
      const k = clamp01(t / liftEnd);
      oldPart.position.y = oldStart.y + lift * easeInOut(clamp01(k / 0.6));
      oldPart.position.x = oldStart.x + lift * 1.5 * easeInOut(clamp01((k - 0.6) / 0.4));
      if (k >= 1) parent.remove(oldPart);
    }

    if (t < liftEnd) {
      status(0, t);
      return;
    }

    if (!newPart.parent) parent.add(newPart);
    const k = clamp01((t - liftEnd) / (secureEnd - liftEnd));
    newPart.position.set(target.x, target.y + lift * (1 - easeOutBack(k)), target.z);

    if (t < 1) {
      status(1, t);
      return;
    }
    newPart.position.copy(target);
    finished = true;
    status(2, 1);
    resolve(newPart);
  };

  return promise;
}
