/**
 * Bakes Pingo Flow's shape once, offline, into public/ai/pingo-flow.bin.
 *
 * The body is a signed-distance blob marched onto a sphere, smoothed, then
 * given baked cavity shading and thickness; the visor is a shell fitted to the
 * body's front. That is a few million distance evaluations: fine here, too slow
 * for a phone opening a chat. So the app only loads the result.
 *
 *   node apps/web/scripts/bake-pingo-flow.mjs
 *
 * Format: "PFB1", u32 JSON length, JSON header, then each array in header order,
 * each starting on a 4-byte boundary. Positions, normals and uvs are int16
 * scaled by header.scale[name]; the rest are uint16 over [0, header.max[name]].
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';

  /* ---------- shape: the visor is a rounded superellipsoid dome ---------- */
  const VA = 0.93, VB = 0.75; // half width, half height of the visor outline
  // the smooth, gently curved front face the visor is set into
  const FZ = 0.5, FKX = 0.2, FKY = 0.16;
  const zBase = (x, y) => FZ - FKX * x * x - FKY * y * y;
  // squareness changes round the outline: a touch narrower over the top, fuller at the bottom, like a pebble
  const vN = (x, y) => 1.97 - 0.2 * (y / VB) / (Math.hypot(x / VA, y / VB) || 1);
  const vS = (x, y) => { const n = vN(x, y); return Math.pow(Math.pow(Math.abs(x / VA), n) + Math.pow(Math.abs(y / VB), n), 1 / n); };

  /* ---------- body: soft lobes melted together (a signed-distance blob) ---------- */
  // core: a flat-fronted rounded box the visor sits in; lobes: soft ellipsoids melted onto it
  const CORE = [0, -0.08, -0.22, 0.66, 0.64, 0.6, 2.0, 2.2]; // x, y, z, a, b, c, squareness xy, squareness z
  const LOBES = [
    // x, y, z, rx, ry, rz
    [-0.76, -0.15, -0.14, 0.56, 0.58, 0.62], // left
    [0.76, -0.15, -0.14, 0.56, 0.58, 0.62], // right
    [0, 0.66, -0.5, 0.46, 0.52, 0.57], // top, leaning back
    [0, -0.74, -0.2, 0.64, 0.5, 0.54], // bottom
    [0, -0.24, -0.72, 0.5, 0.58, 0.48], // back
  ];
  function sdEll(x, y, z, l) {
    const px = (x - l[0]) / l[3], py = (y - l[1]) / l[4], pz = (z - l[2]) / l[5];
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const k1 = Math.sqrt((px / l[3]) ** 2 + (py / l[4]) ** 2 + (pz / l[5]) ** 2) || 1e-6;
    return k0 * (k0 - 1) / k1;
  }
  function sdCore(x, y, z) {
    const c = CORE, px = Math.abs((x - c[0]) / c[3]), py = Math.abs((y - c[1]) / c[4]), pz = Math.abs((z - c[2]) / c[5]);
    const F = Math.pow(Math.pow(px, c[6]) + Math.pow(py, c[6]), c[7] / c[6]) + Math.pow(pz, c[7]);
    return (Math.pow(F, 1 / c[7]) - 1) * 0.75;
  }
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => -smin(-a, -b, k);
  const softplus = (v, k) => k * Math.log(1 + Math.exp(v / k));
  // under the visor the body steps back a little, so the shell never touches it (hidden; it only keeps the two apart)
  const recess = (x, y) => { const k = Math.min(1, Math.max(0, (0.985 - vS(x, y)) / 0.16)); return 0.08 * k * k * (3 - 2 * k); };
  // The body is one smooth plus-shaped cushion. Seen from the front or back its outline is PLUS_R (radius by angle,
  // traced from the reference turnaround); seen from the side, SIDE gives its front and back edge at each height.
  // Every slice is rounded like a pillow, so the four lobes have real depth and the back lobe is the same mass in both views.
  const BODY_H = 2.35, BODY_Y = 0.0, LENS_FRONT = 0.615;
  const PLUS_R = [0.55, 0.5382, 0.5204, 0.4979, 0.4723, 0.4465, 0.4241, 0.4087, 0.4014, 0.4017, 0.4089, 0.4215, 0.4372, 0.4537, 0.4686, 0.4809, 0.4902, 0.4963, 0.4984, 0.4963, 0.4902, 0.4809, 0.4686, 0.4537, 0.4372, 0.4215, 0.4089, 0.4017, 0.4014, 0.4087, 0.4241, 0.4465, 0.4723, 0.4979, 0.5204, 0.5382, 0.55, 0.5556, 0.5553, 0.5489, 0.5366, 0.5199, 0.5005, 0.4812, 0.4663, 0.4585, 0.458, 0.463, 0.4709, 0.4796, 0.4874, 0.4937, 0.4981, 0.5006, 0.5014, 0.5006, 0.4981, 0.4937, 0.4874, 0.4796, 0.4709, 0.463, 0.458, 0.4585, 0.4663, 0.4812, 0.5005, 0.5199, 0.5366, 0.5489, 0.5553, 0.5556];
  const SIDE = [[0.0, 0.4071, 0.5116], [0.025, 0.3653, 0.5326], [0.05, 0.3218, 0.5594], [0.075, 0.2844, 0.5759], [0.1, 0.2474, 0.5962], [0.125, 0.2095, 0.6055], [0.15, 0.1764, 0.6139], [0.175, 0.1528, 0.6189], [0.2, 0.1328, 0.6215], [0.225, 0.1108, 0.6225], [0.25, 0.0908, 0.6227], [0.275, 0.0738, 0.6229], [0.3, 0.0589, 0.6237], [0.325, 0.0466, 0.6261], [0.35, 0.037, 0.6308], [0.375, 0.0286, 0.6385], [0.4, 0.0209, 0.6495], [0.425, 0.0147, 0.6637], [0.45, 0.0103, 0.6803], [0.475, 0.0068, 0.698], [0.5, 0.0055, 0.7153], [0.525, 0.0056, 0.731], [0.55, 0.0043, 0.7442], [0.575, 0.0039, 0.7545], [0.6, 0.006, 0.7616], [0.625, 0.0083, 0.7654], [0.65, 0.0111, 0.766], [0.675, 0.0171, 0.7635], [0.7, 0.026, 0.7564], [0.725, 0.037, 0.7457], [0.75, 0.0496, 0.7309], [0.775, 0.065, 0.7145], [0.8, 0.0859, 0.69], [0.825, 0.1082, 0.6574], [0.85, 0.129, 0.6218], [0.875, 0.1576, 0.5898], [0.9, 0.1938, 0.5593], [0.925, 0.2278, 0.5304], [0.95, 0.2605, 0.5028], [0.975, 0.299, 0.477], [1.0, 0.3363, 0.4548]];
  const cr = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a))); // Catmull-Rom
  const plusR = (x, y) => { let a = Math.atan2(y - BODY_Y, x) / (Math.PI * 2); if (a < 0) a += 1; const n = PLUS_R.length, f = a * n, i = Math.floor(f), t = f - i, g = (k) => PLUS_R[((i + k) % n + n) % n]; return cr(g(-1), g(0), g(1), g(2), t) * BODY_H; };
  const sideAt = (y) => { const f = (BODY_Y + BODY_H / 2 - y) / BODY_H; if (f <= 0 || f >= 1) return null; const n = SIDE.length - 1, k = f * n, i = Math.floor(k), t = k - i, g = (q, j) => SIDE[Math.max(0, Math.min(n, i + q))][j]; const xl = cr(g(-1, 1), g(0, 1), g(1, 1), g(2, 1), t), xr = cr(g(-1, 2), g(0, 2), g(1, 2), g(2, 2), t); return [LENS_FRONT - xl * BODY_H, LENS_FRONT - xr * BODY_H]; };
  const R_TOP = PLUS_R[PLUS_R.length / 4] * BODY_H, R_BOT = PLUS_R[PLUS_R.length * 3 / 4] * BODY_H;
  function sdPlus(x, y, z) {
    const sa = sideAt(y), R = plusR(x, y), rho = Math.hypot(x, y - BODY_Y);
    if (!sa) return Math.max(rho - R, Math.abs(y - BODY_Y) - BODY_H / 2) + 0.02;
    const u0 = Math.min(0.93, Math.abs(y - BODY_Y) / (y > BODY_Y ? R_TOP : R_BOT));
    const zc = (sa[0] + sa[1]) / 2, D = Math.max(0.02, (sa[0] - sa[1]) / 2) / Math.pow(1 - Math.pow(u0, y > BODY_Y ? 2.6 + 0.9 * Math.min(1, Math.max(0, (u0 - 0.45) / 0.45)) : 2.6), 1 / (y > BODY_Y ? 2.6 + 0.9 * Math.min(1, Math.max(0, (u0 - 0.45) / 0.45)) : 2.6));
    const u = rho / R, v = (z - zc) / D;
    const q = y > BODY_Y ? 2.6 + 0.9 * Math.min(1, Math.max(0, (u0 - 0.45) / 0.45)) : 2.6; return (Math.pow(Math.pow(Math.abs(u), q) + Math.pow(Math.abs(v), q), 1 / q) - 1) * Math.min(R, D) * 0.8; // a slightly squared, pillow-like section
  }
  function sdBody(x, y, z) {
    let d = sdPlus(x, y, z);
    // a pad shaped like the visor outline, a size larger, so the front is full all round the visor (kept inside the outline)
    d = smin(d, smax(smax(smax((vS(x, y) - 1.13) * 0.7, z - 0.56, 0.12), -0.05 - z, 0.1), (rho_(x, y) - plusR(x, y) * 1.0), 0.05), 0.06);
    { const sa = sideAt(y); if (sa) d = smax(d, z - sa[0] - 0.06, 0.08); } // and never in front of the side outline
    // the front is shaped to one smooth curve so the visor sits in it cleanly; outside the visor it falls away a little
    return smax(d, z - zBase(x, y) + 0.28 * softplus(vS(x, y) - 1.03, 0.04) + recess(x, y), 0.18);
  }
  const rho_ = (x, y) => Math.hypot(x, y - BODY_Y);


  const SEG_W = 128, SEG_H = 96;
  const bodyGeo = new THREE.SphereGeometry(1, SEG_W, SEG_H);
  {
    const p = bodyGeo.attributes.position, n = bodyGeo.attributes.normal;
    const wob = new Float32Array(p.count), ao = new Float32Array(p.count);
    const O = [0, 0, -0.12], e = 0.03; // normals sampled a little wide, so tiny kinks in the blend never show as creases
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i), dy = p.getY(i), dz = p.getZ(i);
      let r = 2.2, inside = false;
      for (; r > 0.05; r -= 0.025) if (sdBody(O[0] + dx * r, O[1] + dy * r, O[2] + dz * r) < 0) { inside = true; break; }
      let lo = r, hi = r + 0.025;
      for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (sdBody(O[0] + dx * m, O[1] + dy * m, O[2] + dz * m) < 0) lo = m; else hi = m; }
      const x = O[0] + dx * lo, y = O[1] + dy * lo, z = O[2] + dz * lo;
      p.setXYZ(i, x, y, z);
      const gx = sdBody(x + e, y, z) - sdBody(x - e, y, z), gy = sdBody(x, y + e, z) - sdBody(x, y - e, z), gz = sdBody(x, y, z + e) - sdBody(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1; n.setXYZ(i, gx / gl, gy / gl, gz / gl);
      // no wobble near the visor, so the seam never opens
      // (fades smoothly from front to back: a hard switch here showed as small steps in the outline)
      const near = vS(x, y), front = Math.min(1, Math.max(0, (z + 0.1) / 0.35));
      wob[i] = 1 - front * (1 - Math.min(1, Math.max(0, (near - 1.08) / 0.35)));
      // a soft shadow in the groove where the body meets the visor
      const g = Math.min(1, Math.max(0, (near - 1.0) / 0.2));
      ao[i] = 1 - front * 0.1 * (1 - g * g * (3 - 2 * g));
    }
    bodyGeo.setAttribute('aWob', new THREE.BufferAttribute(wob, 1));
    bodyGeo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));

    // Relax the surface a little (Taubin smoothing: shrink, then grow back), so the lobes flow into each other
    // without the small kinks the blend leaves behind. The rim around the visor is held in place.
    const W1 = SEG_W + 1, P = p.array, tmp = new Float32Array(P.length);
    const pin = new Uint8Array(p.count);
    for (let i = 0; i < p.count; i++) pin[i] = (P[i * 3 + 2] > 0.1 && vS(P[i * 3], P[i * 3 + 1]) < 1.06) ? 1 : 0;
    const pass = (f) => {
      tmp.set(P);
      for (let r = 1; r < SEG_H; r++) for (let c = 0; c < SEG_W; c++) {
        const i = r * W1 + c; if (pin[i]) continue;
        const nb = [(r - 1) * W1 + c, (r + 1) * W1 + c, r * W1 + (c + SEG_W - 1) % SEG_W, r * W1 + (c + 1) % SEG_W];
        for (let k = 0; k < 3; k++) { let m = 0; nb.forEach((j) => { m += tmp[j * 3 + k]; }); P[i * 3 + k] = tmp[i * 3 + k] + f * (m / 4 - tmp[i * 3 + k]); }
      }
      for (let r = 0; r <= SEG_H; r++) for (let k = 0; k < 3; k++) P[(r * W1 + SEG_W) * 3 + k] = P[(r * W1) * 3 + k]; // close the seam
    };
    for (let it = 0; it < 12; it++) { pass(0.5); pass(-0.53); }
    bodyGeo.computeVertexNormals();
    // computed normals split along the seam and at the poles; join them
    const N = n.array;
    for (let r = 0; r <= SEG_H; r++) { const a = r * W1, b = r * W1 + SEG_W; for (let k = 0; k < 3; k++) { const m = (N[a * 3 + k] + N[b * 3 + k]) / 2; N[a * 3 + k] = N[b * 3 + k] = m; } }
    [0, SEG_H].forEach((r) => { const m = [0, 0, 0]; for (let c = 0; c <= SEG_W; c++) for (let k = 0; k < 3; k++) m[k] += N[(r * W1 + c) * 3 + k]; const l = Math.hypot(...m) || 1; for (let c = 0; c <= SEG_W; c++) for (let k = 0; k < 3; k++) N[(r * W1 + c) * 3 + k] = m[k] / l; });
    // Cavity shading, baked once: sample the shape a little way out along each normal; where the body crowds in
    // (notches, lobe roots) the point gets darker. The back half also settles a touch darker toward its centre.
    { const Pp = p.array, A = bodyGeo.attributes.aAO.array;
      for (let i = 0; i < p.count; i++) {
        const x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        let occ = 0; for (let k = 1; k <= 5; k++) { const h = 0.07 * k, d = sdPlus(x + nx * h, y + ny * h, z + nz * h); occ += Math.max(0, h * 0.8 - d) / (h * 0.8) / k; }
        const cav = 1 - 0.32 * Math.min(1, occ / 1.2) * (1 - Math.min(1, Math.max(0, (z - 0.05) / 0.3)));
        const bk = Math.max(0, 1 - Math.hypot(x, y - BODY_Y) / 1.7), back = Math.min(1, Math.max(0, -nz * 1.4)) * bk * bk * (3 - 2 * bk);
        A[i] *= cav * (1 - 0.36 * back);
      }
      for (let pass = 0; pass < 4; pass++) { const C = A.slice(); for (let r = 1; r < SEG_H; r++) for (let c = 0; c <= SEG_W; c++) { const i = r * W1 + c, l = r * W1 + (c + SEG_W - 1) % SEG_W, rr = r * W1 + (c + 1) % SEG_W; A[i] = (C[i] * 2 + C[l] + C[rr] + C[i - W1] + C[i + W1]) / 6; } }
      bodyGeo.attributes.aAO.needsUpdate = true;
      // thickness: march inward along the normal until we leave the body on the other side
      const T = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) {
        const x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        let t = 0.06; while (t < 2.6 && sdBody(x - nx * t, y - ny * t, z - nz * t) < 0) t += 0.05;
        let lo = t - 0.05, hi = t; for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (sdBody(x - nx * m, y - ny * m, z - nz * m) < 0) lo = m; else hi = m; }
        T[i] = Math.min(2.6, (lo + hi) / 2);
      }
      // blur it over the surface so the glow changes smoothly
      for (let pass = 0; pass < 6; pass++) { const C = T.slice(); for (let r = 1; r < SEG_H; r++) for (let c = 0; c <= SEG_W; c++) { const i = r * W1 + c, l = r * W1 + (c + SEG_W - 1) % SEG_W, rr = r * W1 + (c + 1) % SEG_W; T[i] = (C[i] * 2 + C[l] + C[rr] + C[i - W1] + C[i + W1]) / 6; } }
      bodyGeo.setAttribute('aThick', new THREE.BufferAttribute(T, 1)); }
  }

  // where the body's front surface is, looking straight at it
  const frontZ = (x, y) => { let z = 1.2; while (z > -1 && sdBody(x, y, z) > 0) z -= 0.015; let lo = z, hi = z + 0.015; for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (sdBody(x, y, m) < 0) lo = m; else hi = m; } return lo; };
  // the dome rises only a little above the body, with a rounded roll into the groove at its edge
  // the lens: a gentle dome on a low wall whose top edge is rounded over, like a moulded shell
  const EDGE = 0.975;
  const DOME = (t) => {
    const lens = 0.045 * Math.sqrt(Math.max(0, 1 - t * t)) + 0.07 * (1 - t * t); // only a gentle swell over the body's own curve
    const s = Math.max(0, (t - EDGE) / (1 - EDGE));
    return lens + 0.018 * Math.sqrt(Math.max(0, 1 - s * s));
  };
  // where the real body surface sits a little below the ideal front curve, the visor's edge settles down to it
  const seatDelta = (ox, oy) => Math.max(-0.08, Math.min(0, frontZ(ox * 1.03, oy * 1.03) - zBase(ox * 1.03, oy * 1.03)));
  const NS = 160, RINGS = [];
  for (let i = 0; i < 22; i++) RINGS.push(EDGE * Math.sin((i / 22) * Math.PI / 2)); // denser towards the edge
  for (let i = 0; i <= 10; i++) RINGS.push(EDGE + (1 - EDGE) * Math.sin((i / 10) * Math.PI / 2)); // the rounded lip
  const visorGeo = new THREE.BufferGeometry();
  const rimPts = [];
  {
    const pos = [], uvs = [], rim = [], idx = [], NR = RINGS.length + 1;
    for (let j = 0; j < NS; j++) {
      const ang = j / NS * Math.PI * 2, cx = Math.cos(ang) * VA, cy = Math.sin(ang) * VB, k0 = 1 / vS(cx, cy);
      const ox = cx * k0, oy = cy * k0, sd = seatDelta(ox, oy);
      RINGS.forEach((t) => { const x = ox * t, y = oy * t; pos.push(x, y, Math.max(zBase(x, y) + DOME(t) - 0.004 + sd * t ** 4, t > 0.8 ? frontZ(x, y) + 0.012 : -9)); /* never below the body */ uvs.push(x / (2 * VA) + 0.5, y / (2 * VB) + 0.5); rim.push(t); });
      const ez = zBase(ox, oy) + sd; pos.push(ox * 0.995, oy * 0.995, Math.min(ez, frontZ(ox, oy)) - 0.07); uvs.push(ox / (2 * VA) + 0.5, oy / (2 * VB) + 0.5); rim.push(1.1); // skirt down into the groove
      rimPts.push(new THREE.Vector3(ox * 1.0, oy * 1.0, frontZ(ox * 1.012, oy * 1.012) + 0.002));
    }
    for (let j = 0; j < NS; j++) { const j2 = (j + 1) % NS; for (let i = 0; i < NR - 1; i++) { const a = j * NR + i, b = j2 * NR + i; idx.push(a, a + 1, b, b, a + 1, b + 1); } }
    visorGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    visorGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    visorGeo.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
    visorGeo.setIndex(idx); visorGeo.computeVertexNormals();
  }

const out = {
  body: { seg: [SEG_W, SEG_H], position: bodyGeo.attributes.position.array, normal: bodyGeo.attributes.normal.array, aWob: bodyGeo.attributes.aWob.array, aAO: bodyGeo.attributes.aAO.array, aThick: bodyGeo.attributes.aThick.array, offsetZ: body_offsetZ() },
  visor: { position: visorGeo.attributes.position.array, normal: visorGeo.attributes.normal.array, uv: visorGeo.attributes.uv.array, aRim: visorGeo.attributes.aRim.array, index: visorGeo.index.array },
  rim: rimPts.flatMap((v) => [v.x, v.y, v.z]),
};
function body_offsetZ() { bodyGeo.computeBoundingBox(); return -(bodyGeo.boundingBox.min.z + bodyGeo.boundingBox.max.z) / 2; }

const parts = [];
const header = { seg: out.body.seg, offsetZ: out.body.offsetZ, arrays: [] };
const i16 = (name, arr, scale) => { const a = new Int16Array(arr.length); for (let i = 0; i < arr.length; i++) a[i] = Math.round(Math.max(-1, Math.min(1, arr[i] / scale)) * 32767); parts.push(a); header.arrays.push({ name, type: 'i16', length: arr.length, scale }); };
const u16 = (name, arr, max) => { const a = new Uint16Array(arr.length); for (let i = 0; i < arr.length; i++) a[i] = Math.round(Math.max(0, Math.min(1, arr[i] / max)) * 65535); parts.push(a); header.arrays.push({ name, type: 'u16', length: arr.length, max }); };
const f32 = (name, arr) => { parts.push(Float32Array.from(arr)); header.arrays.push({ name, type: 'f32', length: arr.length }); };
const u16i = (name, arr) => { parts.push(Uint16Array.from(arr)); header.arrays.push({ name, type: 'u16i', length: arr.length }); };
i16('body.position', out.body.position, 2.5); i16('body.normal', out.body.normal, 1);
u16('body.aWob', out.body.aWob, 1); u16('body.aAO', out.body.aAO, 1); u16('body.aThick', out.body.aThick, 2.6);
i16('visor.position', out.visor.position, 2.5); i16('visor.normal', out.visor.normal, 1); u16('visor.uv', out.visor.uv, 1); u16('visor.aRim', out.visor.aRim, 1.2); u16i('visor.index', out.visor.index);
f32('rim', out.rim);

const json = new TextEncoder().encode(JSON.stringify(header));
const pad = (n) => (4 - (n % 4)) % 4;
let size = 8 + json.length + pad(8 + json.length);
for (const p of parts) size += p.byteLength + pad(p.byteLength);
const buf = new Uint8Array(size); const dv = new DataView(buf.buffer);
buf.set(new TextEncoder().encode('PFB1'), 0); dv.setUint32(4, json.length, true); buf.set(json, 8);
let off = 8 + json.length + pad(8 + json.length);
for (const p of parts) { buf.set(new Uint8Array(p.buffer), off); off += p.byteLength + pad(p.byteLength); }
const file = new URL('../public/ai/pingo-flow.bin', import.meta.url);
writeFileSync(file, buf);
console.log('wrote', file.pathname, size, 'bytes');
