// Generates the sign-in art for PINGO: a painted panel, two aura friends, and a cloud ground.
// Everything is procedural (domain-warped noise, signed distances, a Kuwahara pass), so there is no third-party art in it.
// Usage: node make-art.cjs <outDir>
// sharp is not a dependency of apps/web; point NODE_PATH at any checkout that has it (e.g. the horror tools).
const sharp = require('sharp');
const path = require('path');
const OUT = process.argv[2];

// ---------- noise ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeSimplex(seed) {
  const r = rng(seed), p = new Uint8Array(512), perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const g = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return (x, y) => {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255; let n = 0;
    const c = (gi, xx, yy) => { let tt = 0.5 - xx * xx - yy * yy; if (tt < 0) return 0; tt *= tt; const gg = g[gi & 7]; return tt * tt * (gg[0] * xx + gg[1] * yy); };
    n += c(p[ii + p[jj]], x0, y0); n += c(p[ii + i1 + p[jj + j1]], x1, y1); n += c(p[ii + 1 + p[jj + 1]], x2, y2);
    return 70 * n;
  };
}
function makeFbm(seed, oct = 5) {
  const n = makeSimplex(seed);
  return (x, y) => { let a = 0.5, s = 0; for (let o = 0; o < oct; o++) { s += a * n(x, y); const nx = 1.6 * x + 1.2 * y, ny = -1.2 * x + 1.6 * y; x = nx + 17.3; y = ny - 4.1; a *= 0.5; } return s; };
}
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ramp(stops, t) { t = clamp(t); for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i]; return mix(c0, c1, (t - t0) / (t1 - t0)); } return stops[stops.length - 1][1]; }

// Kuwahara: each pixel takes the mean of its calmest quadrant. Turns noise into brush marks.
function kuwahara(buf, W, H, R) {
  const out = Buffer.alloc(buf.length);
  // integral images for sums and squared luminance
  const S = [0, 1, 2].map(() => new Float64Array((W + 1) * (H + 1))), Q = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { const rs = [0, 0, 0]; let rq = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; for (let c = 0; c < 3; c++) rs[c] += buf[i + c]; const l = (buf[i] + buf[i + 1] + buf[i + 2]) / 3; rq += l * l; const k = (y + 1) * (W + 1) + x + 1; for (let c = 0; c < 3; c++) S[c][k] = S[c][k - (W + 1)] + rs[c]; Q[k] = Q[k - (W + 1)] + rq; } }
  const L = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let rl = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; rl += (buf[i] + buf[i + 1] + buf[i + 2]) / 3; const k = (y + 1) * (W + 1) + x + 1; L[k] = L[k - (W + 1)] + rl; } }
  const rect = (A, x0, y0, x1, y1) => A[(y1 + 1) * (W + 1) + x1 + 1] - A[y0 * (W + 1) + x1 + 1] - A[(y1 + 1) * (W + 1) + x0] + A[y0 * (W + 1) + x0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = Infinity, col = null;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x0 = clamp(dx < 0 ? x - R : x, 0, W - 1), x1 = clamp(dx < 0 ? x : x + R, 0, W - 1), y0 = clamp(dy < 0 ? y - R : y, 0, H - 1), y1 = clamp(dy < 0 ? y : y + R, 0, H - 1);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1), m = rect(L, x0, y0, x1, y1) / n, v = rect(Q, x0, y0, x1, y1) / n - m * m;
      if (v < best) { best = v; col = [rect(S[0], x0, y0, x1, y1) / n, rect(S[1], x0, y0, x1, y1) / n, rect(S[2], x0, y0, x1, y1) / n]; }
    }
    const i = (y * W + x) * 3; out[i] = col[0]; out[i + 1] = col[1]; out[i + 2] = col[2];
  }
  return out;
}

// ---------- 1. the painted panel ----------
async function paintPanel() {
  const W = 1000, H = 1250, buf = Buffer.alloc(W * H * 3);
  const f1 = makeFbm(11, 3), f2 = makeFbm(23, 3), f3 = makeFbm(37, 4), f4 = makeFbm(51, 3), petal = makeSimplex(77);
  const deep = [[0, hex('#161b44')], [0.32, hex('#27336f')], [0.5, hex('#3f4f97')], [0.62, hex('#6a58a6')], [0.74, hex('#b8467f')], [0.86, hex('#f18fb3')], [1, hex('#ffe2cf')]];
  const blooms = [
    { x: 0.66, y: 0.46, r: 0.15, k: 5, rot: 0.3, hue: 'pink' },
    { x: 0.8, y: 0.33, r: 0.12, k: 5, rot: 1.1, hue: 'cream' },
    { x: 0.55, y: 0.3, r: 0.1, k: 6, rot: 2.0, hue: 'wine' },
    { x: 0.83, y: 0.56, r: 0.11, k: 5, rot: 0.7, hue: 'cream' },
    { x: 0.27, y: 0.86, r: 0.07, k: 6, rot: 0.2, hue: 'peach' },
  ];
  const petalCols = {
    pink: [[0, hex('#7a1446')], [0.25, hex('#d3326f')], [0.6, hex('#f58ab3')], [1, hex('#fde3ea')]],
    cream: [[0, hex('#c4385d')], [0.22, hex('#f7c45e')], [0.55, hex('#fbe7c6')], [1, hex('#b8dcf0')]],
    wine: [[0, hex('#3d0b2a')], [0.4, hex('#8c1a46')], [0.8, hex('#d2386c')], [1, hex('#f07ca0')]],
    peach: [[0, hex('#e0623d')], [0.5, hex('#ffbe8f')], [1, hex('#fff1d8')]],
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, px = x / 560, py = y / 520;
    const qx = f1(px, py), qy = f1(px + 5.2, py + 1.3);
    const rx = f2(px + 1.7 * qx + 1.7, py + 1.7 * qy + 9.2), ry = f2(px + 1.7 * qx + 8.3, py + 1.7 * qy + 2.8);
    const f = f3(px + 1.8 * rx, py + 1.8 * ry);
    let t = clamp(0.38 + 0.26 * f + 0.1 * Math.hypot(qx, qy) - 0.12 * v + 0.08 * rx + 0.1 * (1 - u) + 0.22 * sstep(0.5, 0.0, v) * sstep(0.3, 1.0, u));
    let col = ramp(deep, t);
    // a cold teal pool low on the left, a rose haze high on the right
    col = mix(col, hex('#1f5f6e'), clamp(0.55 * sstep(0.35, 0.8, v) * sstep(0.6, 0.0, u) * (0.6 + 0.6 * qy)));
    col = mix(col, hex('#e7a3c8'), clamp(0.45 * sstep(0.45, 0.0, v) * sstep(0.4, 1.0, u) * (0.5 + 0.8 * ry)));
    // light falling in from the top left, in two soft shafts
    for (const [ox, w, a] of [[0.12, 0.09, 0.85], [0.33, 0.05, 0.45]]) {
      const d = (u - ox) - (v * 0.42);
      const shaft = Math.exp(-(d * d) / (w * w)) * Math.pow(clamp(1 - v * 1.25), 1.6) * a;
      col = mix(col, mix(hex('#fff4ec'), hex('#f6b9d6'), clamp(v * 2)), clamp(shaft * (0.75 + 0.35 * f4(px * 2, py * 6))));
    }
    // a table to stand on, with a pale reflection
    const table = sstep(0.78, 0.83, v + 0.015 * f4(px * 0.5, 0));
    if (table > 0) {
      const streak = f4(px * 0.6, py * 3.5) + 0.3 * f1(px * 2, py * 2);
      const tc = mix(ramp([[0, hex('#5a5aa6')], [0.5, hex('#c9a0d6')], [1, hex('#f4d2e6')]], 0.55 + 0.6 * streak), col, 0.25);
      col = mix(col, tc, table);
    }
    // blooms
    for (const b of blooms) {
      const dx = (u - b.x), dy = (v - b.y) * (H / W), d = Math.hypot(dx, dy), th = Math.atan2(dy, dx) + b.rot;
      const wob = 0.13 * petal(Math.cos(th) * 2 + b.x * 9, Math.sin(th) * 2 + b.y * 9);
      const shape = b.r * (0.72 + 0.28 * Math.abs(Math.cos(b.k * th / 2)) + wob);
      if (d < shape * 1.05) {
        const rr = d / shape, e = sstep(1.02, 0.9, rr);
        const veins = 0.16 * petal(th * 14, rr * 1.2) + 0.08 * petal(th * 40, rr * 2);
        const pc = ramp(petalCols[b.hue], clamp(rr * 1.05 + veins + 0.12 * petal(dx * 30, dy * 30)));
        col = mix(col, pc, e);
        if (rr < 0.16) col = mix(col, hex('#5c0f33'), sstep(0.16, 0.06, rr) * 0.8);
      }
    }
    const i = (y * W + x) * 3; buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2];
  }
  // stems: thin painted strokes from each low bloom to the table
  const stroke = (x0, y0, x1, y1, w0, c0) => { const n = 900; for (let s = 0; s <= n; s++) { const t = s / n, cx = (x0 + (x1 - x0) * t + 0.01 * Math.sin(t * 5 + x0 * 9)) * W, cy = (y0 + (y1 - y0) * t) * H; const w = Math.max(1, Math.round(w0 * (0.6 + 0.6 * t))), c = mix(c0, hex('#2c4a3a'), 0.5 + 0.5 * Math.sin(t * 11 + y0 * 20)); for (let yy = -w; yy <= w; yy++) for (let xx = -w; xx <= w; xx++) { if (xx * xx + yy * yy > w * w) continue; const X = Math.round(cx + xx), Y = Math.round(cy + yy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const i = (Y * W + X) * 3; const m = mix([buf[i], buf[i + 1], buf[i + 2]], c, 0.55); buf[i] = m[0]; buf[i + 1] = m[1]; buf[i + 2] = m[2]; } } };
  stroke(0.66, 0.6, 0.62, 0.8, 4, hex('#4f8a5a')); stroke(0.83, 0.67, 0.86, 0.8, 3, hex('#5f9a62')); stroke(0.8, 0.44, 0.74, 0.62, 3, hex('#7db06c'));
  stroke(0.27, 0.9, 0.45, 0.84, 3, hex('#88b86a'));
  let out = kuwahara(buf, W, H, 6);
  out = kuwahara(out, W, H, 3);
  out = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).blur(1.1).raw().toBuffer();
  // dust in the light, then grain
  const r = rng(5);
  for (let k = 0; k < 520; k++) { const x = Math.floor(r() * W * 0.75), y = Math.floor(r() * H * 0.7), s = r() < 0.15 ? 2 : 1, a = 0.35 + r() * 0.5; for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) { const i = ((y + yy) * W + x + xx) * 3; for (let c = 0; c < 3; c++) out[i + c] = out[i + c] + (255 - out[i + c]) * a; } }
  const gr = rng(9);
  for (let i = 0; i < out.length; i += 3) { const n = (gr() + gr() - 1) * 16; for (let c = 0; c < 3; c++) out[i + c] = clamp(out[i + c] + n, 0, 255); }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 80, effort: 6 }).toFile(path.join(OUT, 'paint.webp'));
}

// ---------- 2. two friends, made of light, looking at one phone ----------
async function friends() {
  const W = 900, H = 900, buf = Buffer.alloc(W * H * 4);
  const sd = (px, py, f) => {
    const s = f.s, x = (px - f.x) / s, y = (py - f.y) / s; // figure space, head at y=0.27
    const head = Math.hypot(x, y - 0.27) - 0.088;
    const bx = Math.abs(x) - (0.19 - 0.1) + 0.03 * clamp((y - 0.5) / 0.5), by = Math.abs(y - 0.8) - (0.38 - 0.11), torso = Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0) - 0.11;
    const neck = (() => { const yy = clamp(y, 0.3, 0.46); return Math.hypot(x, y - yy) - 0.04; })();
    const k = 0.05, sm = (a, b) => { const h = clamp(0.5 + 0.5 * (b - a) / k); return b + (a - b) * h - k * h * (1 - h); };
    return sm(sm(head, neck), torso) * s;
  };
  const figs = [{ x: 0.355, y: 0.02, s: 0.92, warm: 1 }, { x: 0.645, y: 0.06, s: 0.86, warm: 0.7 }];
  const n = makeSimplex(4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H; let acc = [0, 0, 0], aAcc = 0;
    for (const f of figs) {
      const d = sd(u, v, f) + 0.006 * n(u * 14, v * 14);
      let a = d < 0 ? 1 : Math.exp(-d / 0.018) * 0.45;
      if (a < 0.002) continue;
      const depth = clamp(-d / 0.11);
      const rim = mix(hex('#a9d2ff'), hex('#d8b8ff'), clamp((v - 0.2) * 1.6));
      const core = mix(hex('#ffb07a'), hex('#ff7a3d'), clamp((v - 0.45) * 2.2 * f.warm));
      const fx = (u - f.x) / f.s, fy = (v - f.y) / f.s - 0.72, warmth = Math.exp(-(fx * fx) / (0.13 * 0.13) - (fy * fy) / (0.24 * 0.24));
      let c = mix(rim, core, clamp(warmth * 1.15) * sstep(0, 0.6, depth));
      c = mix(c, hex('#fff6ee'), clamp(1 - Math.abs(-d - 0.02) / 0.02) * 0.25 * (d < 0 ? 1 : 0));
      // the figures dissolve towards the bottom, like a long exposure
      a *= sstep(1.0, 0.84, v);
      // over-composite figure onto what is there
      acc = mix(acc, c, a * (1 - aAcc) / Math.max(1e-6, a * (1 - aAcc) + aAcc) );
      aAcc = aAcc + a * (1 - aAcc);
    }
    const i = (y * W + x) * 4; buf[i] = acc[0]; buf[i + 1] = acc[1]; buf[i + 2] = acc[2]; buf[i + 3] = aAcc * 255;
  }
  const soft = await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).blur(9).raw().toBuffer();
  // the phone they share: crisp-ish, with a fuzzy, grainy edge
  const r = rng(3), cx = 0.5, cy = 0.62, ang = -0.16, hw = 0.062, hh = 0.04;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W - cx, v = y / H - cy, X = u * Math.cos(-ang) - v * Math.sin(-ang), Y = u * Math.sin(-ang) + v * Math.cos(-ang);
    const q = Math.max(Math.abs(X) - hw, Math.abs(Y) - hh) + 0.004 * n(x / 6, y / 6);
    let a = sstep(0.003, -0.003, q + (r() - 0.5) * 0.007);
    if (a <= 0) continue;
    const i = (y * W + x) * 4, base = [soft[i], soft[i + 1], soft[i + 2]], ba = soft[i + 3] / 255;
    const glow = clamp(0.5 - Math.hypot(X + 0.02, Y + 0.01) * 6) * 0.35; // screen light
    const c = mix(hex('#1b1724'), hex('#5b4a8c'), glow);
    const oa = a + ba * (1 - a);
    const m = mix(base, c, a / Math.max(oa, 1e-6));
    soft[i] = m[0]; soft[i + 1] = m[1]; soft[i + 2] = m[2]; soft[i + 3] = oa * 255;
  }
  const gr = rng(12);
  for (let i = 0; i < soft.length; i += 4) { if (soft[i + 3] < 3) continue; const k = (gr() + gr() - 1) * 26; for (let c = 0; c < 3; c++) soft[i + c] = clamp(soft[i + c] + k, 0, 255); soft[i + 3] = clamp(soft[i + 3] * (1 + (gr() - 0.5) * 0.35), 0, 255); }
  await sharp(soft, { raw: { width: W, height: H, channels: 4 } }).resize(720, 720).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, 'friends.webp'));
}

// ---------- 3. clouds for the page behind the card ----------
async function clouds(name, stops, grain) {
  const W = 720, H = 720, buf = Buffer.alloc(W * H * 3), f1 = makeFbm(101, 3), f2 = makeFbm(202, 4), f3 = makeFbm(303, 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x / 620, py = y / 620, qx = f1(px, py), qy = f1(px + 3.1, py + 7.7);
    const f = f2(px + 2.4 * qx, py + 2.4 * qy), g = f3(px * 0.6 + qx, py * 0.6 - qy);
    const u = x / W - 0.5, v = y / H - 0.5, centre = clamp(1 - Math.hypot(u * 1.2, v * 1.6) * 1.6);
    const c = ramp(stops, clamp(0.52 + 0.5 * f + 0.22 * g - 0.5 * centre));
    const i = (y * W + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  const out = await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).blur(18).raw().toBuffer();
  const gr = rng(21);
  for (let i = 0; i < out.length; i += 3) { const k = (gr() + gr() - 1) * grain; for (let c = 0; c < 3; c++) out[i + c] = clamp(out[i + c] + k, 0, 255); }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 78, effort: 6 }).toFile(path.join(OUT, name));
}

(async () => {
  await clouds('clouds.webp', [[0, hex('#f7f4f2')], [0.45, hex('#f3e9ea')], [0.62, hex('#dcd2ea')], [0.78, hex('#f5c9bb')], [0.9, hex('#efa79c')], [1, hex('#e88f8b')]], 10);
  await clouds('clouds-dark.webp', [[0, hex('#121016')], [0.45, hex('#17131c')], [0.62, hex('#2a2140')], [0.78, hex('#3d2236')], [0.9, hex('#5a2a3a')], [1, hex('#6e3040')]], 8);
  await friends();
  await paintPanel();
  console.log('done');
})();
