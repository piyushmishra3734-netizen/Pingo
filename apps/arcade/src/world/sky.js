import { BackSide, CanvasTexture, LinearFilter, Mesh, ShaderMaterial, SphereGeometry, SRGBColorSpace, TextureLoader, Vector3 } from 'three';

/**
 * The backdrop: a painted panorama, as in a hand-painted film - sky, small
 * cumulus high up, the sea at the horizon and a floor of cloud far below it -
 * painted once (offline: public/panorama/, made with `paintPanorama` below by
 * the dev export script) and wrapped round the world on an
 * inside-out sphere. It never moves with the camera, exactly like a matte
 * painting behind a set, which is what makes the scene read as a painting
 * rather than a simulation. One draw call; stars and the sun's glow are added
 * in the shader so they can twinkle.
 *
 * Equirectangular: x is the compass (wraps), y runs from straight up (0) to
 * straight down (h); the horizon is the middle row.
 */

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One painted cumulus, the way a background painter lays one in: an
 * irregular mound of billows as a soft-edged silhouette, filled top to bottom
 * from its lit crown to its shaded base, then worked over inside the
 * silhouette - soft highlights on the billows facing the light, cooler shadow
 * in the folds - with a level base and, now and then, a thin trailing wisp.
 * `squash` flattens it for clouds seen far off at the horizon.
 */
function cumulus(target, { x, y, width, squash, random, tones, light = -0.35, wrap = 0 }) {
  const lobes = [];
  const count = 9 + Math.floor(random() * 9);
  for (let i = 0; i < count; i += 1) {
    // Spread about the middle, tallest in the middle.
    const across = (random() + random() + random()) / 3 - 0.5;
    const profile = 1 - Math.pow(Math.abs(across) * 2, 1.6);
    const r = width * (0.05 + 0.13 * profile * (0.5 + random() * 0.7));
    lobes.push({ bx: across * width * 0.95, by: -r * (0.2 + profile * (0.6 + random() * 0.9)) * squash, r });
  }
  const pad = Math.ceil(width * 0.1);
  const cw = Math.ceil(width * 1.3) + pad * 2;
  const ch = Math.ceil(width * squash * 0.9) + pad * 2;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return [c, c.getContext('2d')];
  };
  const ox = cw / 2;
  const oy = ch - pad;
  const top = Math.min(...lobes.map((l) => l.by - l.r * squash));

  const [canvas, ctx] = make();
  // Silhouette, softened.
  ctx.filter = `blur(${Math.max(1, width * 0.012)}px)`;
  ctx.fillStyle = '#fff';
  for (const { bx, by, r } of lobes) {
    ctx.beginPath();
    ctx.ellipse(ox + bx, oy + by, r, r * squash, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = 'none';
  // Level base: fade the bottom edge out over a short band.
  ctx.globalCompositeOperation = 'destination-out';
  const base = ctx.createLinearGradient(0, oy - width * 0.02 * squash, 0, oy + width * 0.03 * squash);
  base.addColorStop(0, 'rgba(0,0,0,0)');
  base.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = base;
  ctx.fillRect(0, oy - width * 0.02 * squash, cw, ch);
  // Fill: crown to base.
  ctx.globalCompositeOperation = 'source-in';
  const body = ctx.createLinearGradient(0, oy + top, 0, oy);
  body.addColorStop(0, tones.glow);
  body.addColorStop(0.3, tones.lit);
  body.addColorStop(0.7, tones.mid);
  body.addColorStop(1, tones.shade);
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, cw, ch);
  // Worked over inside the silhouette.
  ctx.globalCompositeOperation = 'source-atop';
  for (const { bx, by, r } of lobes) {
    const hx = ox + bx + light * r * 0.5;
    const hy = oy + by - r * 0.45 * squash;
    const hi = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.95);
    hi.addColorStop(0, tones.glow);
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = hi;
    ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
    const sx = ox + bx - light * r * 0.6;
    const sy = oy + by + r * 0.5 * squash;
    const lo = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.9);
    lo.addColorStop(0, tones.shade);
    lo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = lo;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Now and then a thin wisp trailing off the base.
  if (random() < 0.45) {
    ctx.filter = `blur(${Math.max(1, width * 0.02)}px)`;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = tones.mid;
    ctx.beginPath();
    ctx.ellipse(ox + (random() - 0.5) * width * 0.4, oy - width * 0.02 * squash, width * (0.45 + random() * 0.3), width * 0.025 * squash + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }
  for (const dx of wrap ? [-wrap, 0, wrap] : [0]) target.drawImage(canvas, x + dx - ox, y - oy);
}

/** Paints the panorama. `size` is the canvas width; height is half that. */
export function paintPanorama(palette, size = 4096) {
  const w = size;
  const h = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const p = palette.panorama;

  // Sky: deep at the top, lifting to haze at the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, h / 2);
  sky.addColorStop(0, p.zenith);
  sky.addColorStop(0.55, p.sky);
  sky.addColorStop(0.9, p.skyLow);
  sky.addColorStop(1, p.haze);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h / 2);
  // Sea: hazy at the horizon, clear turquoise below.
  const sea = ctx.createLinearGradient(0, h / 2, 0, h);
  sea.addColorStop(0, p.haze);
  sea.addColorStop(0.035, p.seaFar);
  sea.addColorStop(0.3, p.sea);
  sea.addColorStop(1, p.seaNear);
  ctx.fillStyle = sea;
  ctx.fillRect(0, h / 2, w, h / 2);
  // A thin bright line where sea meets sky.
  ctx.fillStyle = p.horizonLine;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, h / 2 - 1, w, Math.max(2, h * 0.002));
  ctx.globalAlpha = 1;

  const random = mulberry(1234);
  // Wraps: every cloud is stamped again one panorama-width left and right.
  const paintWrapped = (spec) => cumulus(ctx, { ...spec, wrap: w });

  // High sky: small, flat-bottomed clusters.
  for (let i = 0; i < 22; i += 1) {
    const y = h * (0.2 + random() * 0.27);
    const width = w * (0.03 + random() * 0.05) * (0.6 + (y / h) * 1.1);
    paintWrapped({ x: random() * w, y, width, squash: 0.42 + random() * 0.2, random, tones: p.skyCloud });
  }

  // Long thin streaks of cloud lying along the horizon, above and below it.
  ctx.save();
  for (let i = 0; i < 40; i += 1) {
    const below = random() < 0.6;
    const sy = h * (below ? 0.5 + random() * 0.05 : 0.5 - random() * 0.06);
    const sw = w * (0.05 + random() * 0.15);
    const sh = h * (0.002 + random() * 0.006);
    ctx.filter = `blur(${Math.max(1, sh * 0.8)}px)`;
    ctx.globalAlpha = 0.25 + random() * 0.3;
    ctx.fillStyle = below ? p.seaCloud.lit : p.skyCloud.mid;
    const sx = random() * w;
    for (const dx of [-w, 0, w]) {
      ctx.beginPath();
      ctx.ellipse(sx + dx, sy, sw, sh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // The floor of cloud on the sea: far and flat at the horizon, near and
  // towering below - painted back to front so near ones overlap far ones.
  const floor = [];
  for (let i = 0; i < 150; i += 1) {
    const depth = Math.pow(random(), 1.6);
    floor.push({ depth, x: random() * w });
  }
  floor.sort((a, b) => a.depth - b.depth);
  for (const { depth, x } of floor) {
    const y = h * (0.505 + depth * 0.4);
    const width = w * (0.03 + depth * 0.2) * (0.6 + random() * 0.7);
    // Thin out a little far away, so the sea shows between.
    if (depth < 0.08 && random() < 0.4) continue;
    paintWrapped({ x, y, width, squash: 0.28 + depth * 0.55, random, tones: p.seaCloud });
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // No mipmaps: they would draw a seam where the panorama wraps.
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return texture;
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D panorama;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float stars;
  uniform float time;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, 1.0 - acos(clamp(d.y, -1.0, 1.0)) / 3.1415926);
    vec3 col = texture2D(panorama, uv).rgb;

    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 5.0) * 0.18 + pow(s, 200.0) * 0.6);

    if (stars > 0.0) {
      float up = clamp(d.y, 0.0, 1.0);
      vec3 cell = floor(d * 220.0);
      float h = hash(cell);
      // Only where the painting is dark sky, not on a cloud.
      float dark = 1.0 - smoothstep(0.25, 0.45, dot(col, vec3(0.3, 0.5, 0.2)));
      float star = step(0.9972, h) * smoothstep(0.08, 0.4, up) * dark;
      col += vec3(star * (0.55 + 0.45 * sin(time * 2.0 + h * 90.0)) * stars);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Loads a painted panorama image, ready for the sky shader. */
function loadPanorama(url, onLoad) {
  const texture = new TextureLoader().load(url, onLoad, undefined, onLoad);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return texture;
}

/**
 * @param {string} url - the painted panorama for this hour and quality
 */
export function createSky(palette, url) {
  let loaded;
  const ready = new Promise((resolve) => {
    loaded = resolve;
  });
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      panorama: { value: loadPanorama(url, () => loaded()) },
      sunColor: { value: palette.sun },
      sunDir: { value: new Vector3(...palette.sunDirection) },
      stars: { value: palette.stars },
      time: { value: 0 },
    },
  });
  const mesh = new Mesh(new SphereGeometry(900, 48, 24), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;

  return {
    mesh,
    /** Resolves when the painting has arrived (or failed to), so nothing shows a blank sky. */
    ready,
    update(camera, seconds) {
      mesh.position.copy(camera.position);
      material.uniforms.time.value = seconds;
    },
  };
}
