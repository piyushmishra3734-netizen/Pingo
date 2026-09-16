/**
 * sin, cos, atan2 and hypot that give the same bits on every device.
 *
 * Two phones racing in lockstep each run the whole race from the same
 * inputs, and must never disagree by a single bit. `+ - * /`, `Math.sqrt`
 * and `Math.floor` are exact IEEE operations, the same everywhere; the
 * browser's `Math.sin` and friends are not - V8 and JavaScriptCore round
 * differently in the last digit, and a race amplifies that into a crash.
 * So these are built from the exact operations only: short Taylor series
 * on small angles, reached by symmetry. Accurate to about 1e-12.
 */

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);
const TAN_15 = 2 - SQRT3;

/** sin for |x| <= pi/4. */
function sinSmall(x) {
  const x2 = x * x;
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - x2 / 156))))));
}

/** cos for |x| <= pi/4. */
function cosSmall(x) {
  const x2 = x * x;
  return 1 - (x2 / 2) * (1 - (x2 / 12) * (1 - (x2 / 30) * (1 - (x2 / 56) * (1 - (x2 / 90) * (1 - x2 / 132)))));
}

export function dsin(angle) {
  const a = angle - Math.floor(angle / TAU) * TAU;
  const quarter = Math.floor(a / HALF_PI + 0.5);
  const r = a - quarter * HALF_PI;
  switch (quarter % 4) {
    case 0:
      return sinSmall(r);
    case 1:
      return cosSmall(r);
    case 2:
      return -sinSmall(r);
    default:
      return -cosSmall(r);
  }
}

export function dcos(angle) {
  const a = angle - Math.floor(angle / TAU) * TAU;
  const quarter = Math.floor(a / HALF_PI + 0.5);
  const r = a - quarter * HALF_PI;
  switch (quarter % 4) {
    case 0:
      return cosSmall(r);
    case 1:
      return -sinSmall(r);
    case 2:
      return -cosSmall(r);
    default:
      return sinSmall(r);
  }
}

/** atan for 0 <= x <= tan(15 degrees). */
function atanSmall(x) {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 3; n <= 23; n += 2) {
    term *= -x2;
    sum += term / n;
  }
  return sum;
}

function datanPositive(x) {
  if (x > 1) return HALF_PI - datanPositive(1 / x);
  if (x > TAN_15) return Math.PI / 6 + atanSmall((x * SQRT3 - 1) / (SQRT3 + x));
  return atanSmall(x);
}

export function datan2(y, x) {
  if (x === 0) return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  const base = datanPositive(Math.abs(y / x));
  if (x > 0) return y < 0 ? -base : base;
  return y < 0 ? base - Math.PI : Math.PI - base;
}

export function dhypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** The shortest signed turn equal to `a`, in (-pi, pi]. */
export function dwrap(a) {
  return datan2(dsin(a), dcos(a));
}
