/**
 * Pingo Flow, PINGO AI's character, drawn live with three.js.
 *
 * The shape is baked offline (scripts/bake-pingo-flow.mjs) and loaded from
 * /ai/pingo-flow.bin: building it here would cost a phone seconds. What runs
 * here is only the scene, the skin and visor shaders, the faces and the motion.
 *
 * Pinned to three r128 because the material patches below edit r128's shader
 * chunks by name.
 */
import * as THREE from 'three';

export const FLOW_FACES = ['default', 'happy', 'excited', 'thinking', 'surprised', 'sleepy', 'confused', 'sad', 'angry', 'listening', 'talking'] as const;
export type FlowFace = (typeof FLOW_FACES)[number];
export type FlowMode = 'idle' | 'listening' | 'talking';

export interface FlowController {
  setFace(face: FlowFace): void;
  setMode(mode: FlowMode): void;
  setColour(hex: string): void;
  /** A tap: a squash and a smile. */
  boop(): void;
  /** -1..1 each; null hands the gaze back to the idle drift. */
  lookAt(x: number | null, y?: number): void;
  /** 0..1, from a voice; the pulse when listening or talking. Without it a stand-in moves. */
  setVoice(level: number | null): void;
  /** Turn the body's motion (float, breathe, wobble) and the face's (blinks, gaze) on or off. */
  setMotion(body: boolean, face: boolean): void;
  dispose(): void;
}

/* ---------- the baked shape ---------- */

interface Baked {
  seg: [number, number];
  offsetZ: number;
  a: Record<string, Float32Array | Uint16Array>;
}

let bakedOnce: Promise<Baked> | null = null;

function loadBaked(): Promise<Baked> {
  bakedOnce ??= fetch('/ai/pingo-flow.bin')
    .then((r) => {
      if (!r.ok) throw new Error(`pingo-flow.bin ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const dv = new DataView(buf);
      if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'PFB1') throw new Error('pingo-flow.bin: bad header');
      const jl = dv.getUint32(4, true);
      const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))) as {
        seg: [number, number];
        offsetZ: number;
        arrays: { name: string; type: 'i16' | 'u16' | 'u16i' | 'f32'; length: number; scale?: number; max?: number }[];
      };
      const pad = (n: number) => (4 - (n % 4)) % 4;
      let off = 8 + jl + pad(8 + jl);
      const a: Baked['a'] = {};
      for (const d of header.arrays) {
        if (d.type === 'f32') {
          a[d.name] = new Float32Array(buf.slice(off, off + d.length * 4));
          off += d.length * 4;
        } else {
          const raw = new (d.type === 'i16' ? Int16Array : Uint16Array)(buf.slice(off, off + d.length * 2));
          off += d.length * 2 + pad(d.length * 2);
          if (d.type === 'u16i') a[d.name] = raw as Uint16Array;
          else {
            const f = new Float32Array(d.length);
            const k = d.type === 'i16' ? (d.scale ?? 1) / 32767 : (d.max ?? 1) / 65535;
            for (let i = 0; i < d.length; i++) f[i] = raw[i]! * k;
            a[d.name] = f;
          }
        }
        if (d.type === 'f32') off += pad(d.length * 4);
      }
      return { seg: header.seg, offsetZ: header.offsetZ, a };
    });
  bakedOnce.catch(() => {
    bakedOnce = null;
  });
  return bakedOnce;
}

/** Starts the download early, e.g. when a chat list shows PINGO AI. */
export function preloadPingoFlow(): void {
  void loadBaked().catch(() => {});
}

/* ---------- paint ---------- */

// Each of the five swatches has its own paint mix, tuned so the lit body reads like the reference colour row.
const PAINT: Record<string, string> = { '#efe8de': '#f4e7d9', '#5f8fe8': '#5093fa', '#ef8a80': '#f99894', '#7fcca5': '#9ee7b9', '#a98ae4': '#b798fc' };
// per paint finish: [highlight gain, shadow lift]
const FINISH: Record<string, [number, number]> = { '#efe8de': [0.18, 0], '#5f8fe8': [0, 0.04], '#ef8a80': [0, 0.03], '#7fcca5': [0, 0.03], '#a98ae4': [0, 0.03] };
export const FLOW_IVORY = '#efe8de';

/* ---------- faces, drawn on a canvas that spans the visor ---------- */

const EW = 512;
const EH = 404;
const MX = 258;
const EY = 240;
const L = { x: MX - 110, y: EY };
const R = { x: MX + 110, y: EY };
const WHITE = '#fffdf8';
const BLINKS = new Set<FlowFace>(['default', 'thinking', 'confused', 'listening', 'talking']);

function faceDrawer(ex: CanvasRenderingContext2D): Record<FlowFace, () => void> {
  const capsule = (cx: number, cy: number, w: number, h: number, tilt = 0) => {
    ex.save();
    ex.translate(cx, cy);
    ex.rotate(tilt);
    const r = Math.min(w, h) / 2;
    ex.beginPath();
    if (h >= w) {
      ex.moveTo(-r, -h / 2 + r);
      ex.arc(0, -h / 2 + r, r, Math.PI, 0);
      ex.lineTo(r, h / 2 - r);
      ex.arc(0, h / 2 - r, r, 0, Math.PI);
    } else {
      ex.moveTo(-w / 2 + r, -r);
      ex.lineTo(w / 2 - r, -r);
      ex.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
      ex.lineTo(-w / 2 + r, r);
      ex.arc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5);
    }
    ex.closePath();
    ex.fill();
    ex.restore();
  };
  const stroke = (fn: () => void, w = 26) => {
    ex.lineWidth = w;
    ex.lineCap = 'round';
    ex.lineJoin = 'round';
    ex.beginPath();
    fn();
    ex.stroke();
  };
  // One glyph for both eyes, mirrored: fn draws the LEFT eye around (0, 0), +x pointing in toward the nose.
  const pair = (half: number, y: number, fn: () => void, mx = MX) => {
    for (const [side, flip] of [[-1, 1], [1, -1]] as const) {
      ex.save();
      ex.translate(mx + side * half, y);
      ex.scale(flip, 1);
      fn();
      ex.restore();
    }
  };
  return {
    default: () => {
      capsule(L.x, L.y, 58, 150);
      capsule(R.x, R.y, 58, 150);
    },
    happy: () => pair(101, 256, () => stroke(() => ex.arc(0, 0, 43, Math.PI, Math.PI * 2), 28), 266),
    excited: () =>
      pair(97, 224, () => stroke(() => {
        ex.moveTo(-32, -42);
        ex.lineTo(33, 0);
        ex.lineTo(-32, 42);
      }, 27), 251),
    thinking: () => {
      capsule(188, 228, 60, 152);
      stroke(() => {
        ex.moveTo(360, 229);
        ex.quadraticCurveTo(356, 266, 381, 269);
        ex.quadraticCurveTo(408, 270, 412, 209);
      }, 24);
    },
    surprised: () => {
      ex.lineWidth = 24;
      pair(102, 225, () => {
        ex.beginPath();
        ex.ellipse(0, 0, 30.5, 60.5, 0, 0, Math.PI * 2);
        ex.stroke();
      });
    },
    sleepy: () => pair(105, 251, () => capsule(0, 0, 95, 37), 263),
    confused: () => {
      capsule(152, 228, 60, 152);
      stroke(() => {
        ex.arc(371, 197, 26, Math.PI * 0.98, Math.PI * 2.3);
        ex.quadraticCurveTo(362, 226, 362, 239);
      }, 22);
      ex.beginPath();
      ex.arc(345, 282, 17.5, 0, Math.PI * 2);
      ex.fill();
    },
    sad: () =>
      pair(106, 246, () => stroke(() => {
        ex.moveTo(-36, 20);
        ex.quadraticCurveTo(18, 28, 35, -24);
      }, 31)),
    angry: () =>
      pair(102, 236, () => {
        ex.beginPath();
        ex.moveTo(-46, -44);
        ex.lineTo(46, 4);
        ex.bezierCurveTo(40, 56, -40, 60, -46, -44);
        ex.closePath();
        ex.lineWidth = 6;
        ex.lineJoin = 'round';
        ex.fill();
        ex.stroke();
      }, 266),
    listening: () => {
      capsule(186, 216, 58, 142, -0.08);
      capsule(382, 203, 50, 130, -0.09);
    },
    talking: () => {
      capsule(141, 230, 50, 147);
      capsule(347, 229, 55, 155);
      stroke(() => {
        ex.moveTo(415, 219);
        ex.lineTo(441, 208);
        ex.moveTo(412, 268);
        ex.lineTo(436, 284);
      }, 19);
    },
  };
}

/* ---------- the scene ---------- */

export interface FlowOptions {
  face?: FlowFace;
  mode?: FlowMode;
  colour?: string;
  /** Hide the soft floor shadow (small avatars). */
  shadow?: boolean;
  /** Draws once and stops: for still avatars. */
  still?: boolean;
  /** Body motion on (default): float, breathe, wobble. */
  bodyMotion?: boolean;
  /** Face motion on (default): blinks and gaze. */
  faceMotion?: boolean;
}

/**
 * Draws into a canvas of its own inside `host`, removed again on dispose. Two
 * instances must never share a canvas: they would share its WebGL context, and
 * one disposing would take the other's down with it.
 */
export async function createPingoFlow(host: HTMLElement, opts: FlowOptions = {}): Promise<FlowController> {
  const baked = await loadBaked();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  host.appendChild(canvas);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0.15, 7.4);
  camera.lookAt(0, 0.05, 0);

  // Studio for reflections: a dark room with big soft light boxes.
  const textures: THREE.Texture[] = [];
  const softTex = (inner: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 64 * inner, 64, 64, 64);
    r.addColorStop(0, '#fff');
    r.addColorStop(1, '#000');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    textures.push(t);
    return t;
  };
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide })));
  const floorEnv = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x0e0d0d }));
  floorEnv.rotation.x = -Math.PI / 2;
  floorEnv.position.y = -4;
  envScene.add(floorEnv);
  const panel = (w: number, h: number, pos: [number, number, number], v: number, soft: number, tint: [number, number, number] = [1, 1, 1]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(v * tint[0], v * tint[1], v * tint[2]), map: softTex(soft), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  panel(5, 12, [8, 1, 2], 0.6, 0.0);
  panel(10, 10, [0, 9, -2], 0.35, 0.2);
  panel(9, 6, [5, 5, 7], 0.22, 0.0, [1, 0.8, 0.6]);
  panel(6, 4, [-6, -1, -6], 0.7, 0.2);
  panel(10, 9, [-7, 3.5, 1.5], 1.1, 0.0, [1, 0.9, 0.76]); // a big warm window on the key side
  panel(14, 10, [0, -6, 2], 0.35, 0.0, [1, 0.86, 0.7]); // warm floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  envScene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();

  // A soft key box at the upper left front, a low warm sky, a gentle fill, a rim from behind and a warm bounce.
  scene.add(new THREE.HemisphereLight(0xfff6ee, 0xd8c4b4, 0.55));
  const key = new THREE.DirectionalLight(0xffefe2, 1.5);
  key.position.set(-4.6, 3.6, 1.6);
  scene.add(key);
  for (const [x, y, z, v] of [[-4.4, 3.0, 1.4, 0.16], [-1.6, 5.2, 1.8, 0.06], [-3.4, 5.0, 0.4, 0.06], [-2.6, 2.8, 3.0, 0.16]] as const) {
    const l = new THREE.DirectionalLight(0xffe8d6, v);
    l.position.set(x, y, z);
    scene.add(l);
  }
  const fill = new THREE.DirectionalLight(0xfff0e4, 0.16);
  fill.position.set(3.5, 0.4, 3.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(1.5, 2.5, -4);
  scene.add(rim);
  const glow = new THREE.DirectionalLight(0xf2d6c2, 0.36);
  glow.position.set(-0.5, -3, 1.0);
  scene.add(glow);

  const rig = new THREE.Group();
  scene.add(rig);
  const body = new THREE.Group();
  rig.add(body);
  body.position.z = baked.offsetZ;

  // Body: the baked sphere, with its baked wobble mask, groove shadow and thickness.
  const [segW, segH] = baked.seg;
  const bodyGeo = new THREE.SphereGeometry(1, segW, segH);
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(baked.a['body.position'] as Float32Array, 3));
  bodyGeo.setAttribute('normal', new THREE.BufferAttribute(baked.a['body.normal'] as Float32Array, 3));
  bodyGeo.setAttribute('aWob', new THREE.BufferAttribute(baked.a['body.aWob'] as Float32Array, 1));
  bodyGeo.setAttribute('aAO', new THREE.BufferAttribute(baked.a['body.aAO'] as Float32Array, 1));
  bodyGeo.setAttribute('aThick', new THREE.BufferAttribute(baked.a['body.aThick'] as Float32Array, 1));
  bodyGeo.computeBoundingSphere();

  // The skin: soft-touch silicone that glows from inside (wrap, transmission through thin parts, a luminous edge).
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xefe8de, roughness: 0.6, metalness: 0, reflectivity: 0.12, envMapIntensity: 0.25 });
  const wobU = {
    uT: { value: 0 },
    uAmp: { value: 1 },
    uHi: { value: 0 },
    uLift: { value: 0 },
    uWarm: { value: 1 },
    uKeyDir: { value: new THREE.Vector3(0, 0, 1) },
    uBackDir: { value: new THREE.Vector3(0, 0, -1) },
  };
  bodyMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, wobU);
    sh.vertexShader =
      'uniform float uT;\nuniform float uAmp;\nattribute float aWob;\nattribute float aAO;\nattribute float aThick;\nvarying float vAO;\nvarying float vThick;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position); vAO = aAO; vThick = aThick;
      float wv = uAmp * aWob * (0.03 * sin(uT * 1.25 + position.x * 2.6 + position.y * 1.3) + 0.024 * sin(uT * 1.7 - position.y * 3.1) + 0.018 * sin(uT * 2.3 + position.z * 2.4));
      transformed += normal * wv;`,
      );
    sh.fragmentShader =
      'varying float vAO;\nvarying float vThick;\nuniform float uHi;\nuniform float uLift;\nuniform float uWarm;\nuniform vec3 uKeyDir;\nuniform vec3 uBackDir;\n' +
      sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vAO;')
        .replace(
          '#include <tonemapping_fragment>',
          `{
      vec3 N = normalize(vNormal), V = normalize(vViewPosition);
      float fr = 1.0 - max(dot(N, V), 0.0);
      float low = smoothstep(0.3, -0.8, N.y);
      const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
      vec3 paint = diffuseColor.rgb;
      float lp = dot(paint, LW);
      vec3 deep = max(mix(vec3(lp), paint, 1.6), 0.0) * mix(vec3(1.0), vec3(1.0, 0.86, 0.76), uWarm);
      vec3 glowC = mix(paint, deep, 0.35);
      float thin = exp(-vThick * 1.05);
      float ndl = dot(N, uKeyDir);
      float wrap = clamp((ndl + 0.6) / 1.6, 0.0, 1.0) - max(ndl, 0.0) * 0.85;
      gl_FragColor.rgb += deep * max(wrap, 0.0) * 1.1 * vAO;
      float tBack = pow(clamp(dot(V, -normalize(uBackDir + N * 0.5)), 0.0, 1.0), 2.5);
      float tKey = clamp(dot(-N, uKeyDir) * 0.5 + 0.5, 0.0, 1.0);
      gl_FragColor.rgb += deep * thin * (1.1 * tBack + 0.45 * tKey + 0.6 * low);
      gl_FragColor.rgb += glowC * pow(fr, 2.4) * (0.1 + 0.22 * thin);
      float lit = clamp(dot(gl_FragColor.rgb, LW) / max(lp, 0.02), 0.0, 1.6);
      gl_FragColor.rgb *= mix(mix(vec3(1.0), vec3(1.01, 0.96, 0.92), uWarm * 0.9 + 0.1), vec3(1.0), smoothstep(0.55, 1.1, lit));
      float sun = smoothstep(0.05, 0.9, ndl);
      gl_FragColor.rgb += mix(paint, vec3(1.0, 0.96, 0.9), 0.5) * sun * sun * (0.12 + 0.55 * uHi);
      gl_FragColor.rgb *= 1.0 + uHi * smoothstep(0.75, 1.15, lit);
      gl_FragColor.rgb += paint * uLift * (1.0 - smoothstep(0.3, 0.9, lit));
      float lum = dot(gl_FragColor.rgb, LW);
      gl_FragColor.rgb = max(vec3(0.0), mix(vec3(lum), gl_FragColor.rgb, 1.12));
    }
    #include <tonemapping_fragment>
    { float tl = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor.rgb = min(gl_FragColor.rgb * (1.0 + 0.085 * smoothstep(0.55, 0.9, tl)), vec3(1.0)); }`,
        );
  };
  body.add(new THREE.Mesh(bodyGeo, bodyMat));

  // The visor: a low glossy black dome set into the body's front; the eyes glow through it.
  const ec = document.createElement('canvas');
  ec.width = EW;
  ec.height = EH;
  const ex = ec.getContext('2d')!;
  const DRAW = faceDrawer(ex);
  const eyeTex = new THREE.CanvasTexture(ec);
  eyeTex.encoding = THREE.sRGBEncoding;
  eyeTex.anisotropy = 4;
  const visorGeo = new THREE.BufferGeometry();
  visorGeo.setAttribute('position', new THREE.BufferAttribute(baked.a['visor.position'] as Float32Array, 3));
  visorGeo.setAttribute('normal', new THREE.BufferAttribute(baked.a['visor.normal'] as Float32Array, 3));
  visorGeo.setAttribute('uv', new THREE.BufferAttribute(baked.a['visor.uv'] as Float32Array, 2));
  visorGeo.setAttribute('aRim', new THREE.BufferAttribute(baked.a['visor.aRim'] as Float32Array, 1));
  visorGeo.setIndex(new THREE.BufferAttribute(baked.a['visor.index'] as Uint16Array, 1));
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.3,
    emissive: 0xffffff,
    emissiveMap: eyeTex,
    emissiveIntensity: 3.2,
  });
  const visorU = { uEdgeOn: { value: 0 } };
  visorMat.onBeforeCompile = (sh) => {
    sh.uniforms.uEdgeOn = visorU.uEdgeOn;
    sh.vertexShader = 'attribute float aRim;\nvarying float vRim;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRim = aRim;');
    // The shell shows the studio's soft boxes, not the sharp dots of the direct lights.
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <lights_physical_pars_fragment>',
      THREE.ShaderChunk.lights_physical_pars_fragment.replace('ccIrradiance * material.clearcoat', '0.0 * ccIrradiance * material.clearcoat'),
    );
    // Seen edge-on the eyes fade away, so only the dark rim shows.
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= smoothstep(0.22, 0.45, abs(dot(normalize(vNormal), normalize(vViewPosition))));',
    );
    sh.fragmentShader =
      'varying float vRim;\nuniform float uEdgeOn;\n' +
      sh.fragmentShader.replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= 0.02;\n#include <aomap_fragment>').replace(
        '#include <tonemapping_fragment>',
        `{
        vec2 q = (vUv - 0.5) * 2.0;
        vec2 d2 = normalize(q + 1e-5);
        vec3 nn = normalize(vNormal);
        float fr = 1.0 - max(dot(nn, normalize(vViewPosition)), 0.0);
        gl_FragColor.rgb *= 1.0 - 0.9 * smoothstep(0.998, 1.03, vRim);
        float line = smoothstep(0.95, 0.978, vRim) * (1.0 - smoothstep(0.99, 1.0, vRim));
        float side = pow(max(dot(d2, normalize(vec2(0.45, 0.9))), 0.0), 2.0);
        gl_FragColor.rgb += vec3(0.7, 0.69, 0.67) * line * side;
        gl_FragColor.rgb += vec3(0.12, 0.07, 0.035) * pow(fr, 2.2) * (1.0 - smoothstep(0.72, 0.96, fr)) * pow(max(dot(d2, normalize(vec2(0.8, 0.6))), 0.0), 1.5) * (1.0 - smoothstep(0.985, 1.0, vRim));
        gl_FragColor.rgb += vec3(0.016, 0.012, 0.008) * smoothstep(0.25, 0.9, vRim) * (1.0 - smoothstep(0.93, 0.975, vRim)) * pow(max(dot(d2, normalize(vec2(0.75, 0.66))), 0.0), 1.6);
        gl_FragColor.rgb *= (1.0 - 0.9 * smoothstep(0.6, 0.92, fr)) * (1.0 - 0.7 * smoothstep(0.88, 0.99, fr));
        gl_FragColor.rgb *= 1.0 - 0.92 * uEdgeOn;
      }
      #include <tonemapping_fragment>`,
      );
  };
  body.add(new THREE.Mesh(visorGeo, visorMat));

  // A thin dark bevel ring in the groove between body and visor.
  const rimArr = baked.a.rim as Float32Array;
  const rimPts: THREE.Vector3[] = [];
  for (let i = 0; i < rimArr.length; i += 3) rimPts.push(new THREE.Vector3(rimArr[i], rimArr[i + 1], rimArr[i + 2]));
  const rimGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 240, 0.015, 8, true);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.4, envMapIntensity: 0.2 });
  body.add(new THREE.Mesh(rimGeo, rimMat));

  // Floor shadow.
  const sc = document.createElement('canvas');
  sc.width = sc.height = 128;
  {
    const g = sc.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(40,36,32,0.5)');
    r.addColorStop(0.5, 'rgba(40,36,32,0.18)');
    r.addColorStop(1, 'rgba(40,36,32,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const shadowTex = new THREE.CanvasTexture(sc);
  textures.push(shadowTex);
  const shadowGeo = new THREE.PlaneGeometry(2.8, 0.75);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.set(0, -1.55, 0);
  shadow.rotation.x = -Math.PI / 2 + 0.22;
  shadow.visible = opts.shadow !== false;
  scene.add(shadow);
  // Without the floor, frame the body alone, a little closer.
  if (opts.shadow === false) {
    camera.position.set(0, 0.12, 6.3);
    camera.lookAt(0, 0.08, 0);
  }

  /* ---------- state ---------- */
  let face: FlowFace = opts.face ?? 'default';
  let bodyOn = opts.bodyMotion !== false;
  let faceOn = opts.faceMotion !== false;
  /** Nothing moves: draw on change only, no loop. */
  const paused = () => Boolean(opts.still) || (!bodyOn && !faceOn);
  let prevFace: FlowFace = face;
  let faceAt = -1;
  let mode: FlowMode = opts.mode ?? 'idle';
  let colour = (opts.colour ?? FLOW_IVORY).toLowerCase();
  let voiceIn: number | null = null;
  let boopAt = -10;
  let blinkAt = 2;
  const blinkDur = 0.16;
  const look = { x: 0, y: 0, tx: null as number | null, ty: 0 };
  const paint = (c: THREE.Color, hex: string) => c.set(PAINT[hex] ?? hex).convertSRGBToLinear();
  const colourNow = paint(new THREE.Color(), colour);
  const colourTarget = colourNow.clone();
  const finish = { hi: (FINISH[colour] ?? [0, 0.03])[0], lift: (FINISH[colour] ?? [0, 0.03])[1] };
  const clock = new THREE.Clock();

  function drawFace(name: FlowFace, alpha: number, squash: number, blink: number, dx: number, dy: number) {
    ex.save();
    ex.fillStyle = WHITE;
    ex.strokeStyle = WHITE;
    ex.translate(MX + dx, EY + dy);
    ex.scale(1, squash * (BLINKS.has(name) ? blink : 1));
    ex.translate(-MX, -EY);
    ex.globalAlpha = alpha * 0.35;
    ex.shadowColor = 'rgba(255,253,248,0.9)';
    ex.shadowBlur = 12;
    DRAW[name]();
    ex.globalAlpha = alpha;
    ex.shadowColor = 'rgba(255,253,248,0.35)';
    ex.shadowBlur = 2;
    DRAW[name]();
    ex.restore();
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => {
    resize();
    if (paused()) frame();
  });
  ro.observe(canvas);
  resize();

  // Only draw while it can be seen.
  let visible = true;
  let raf = 0;
  const io = new IntersectionObserver(([e]) => {
    visible = Boolean(e?.isIntersecting);
    schedule();
  });
  io.observe(canvas);
  const onVis = () => schedule();
  document.addEventListener('visibilitychange', onVis);
  function schedule() {
    if (paused() || raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      frame();
      schedule();
    });
  }

  function frame() {
    const t = clock.getElapsedTime();
    const still = paused();
    const base = reduced ? 0.25 : 1;
    // The body's own motion, and the face's: either can be switched off in settings.
    const motion = still || !bodyOn ? 0 : base;
    const gaze = still || !faceOn ? 0 : base;

    const voice =
      mode === 'idle' || still
        ? 0
        : voiceIn ?? Math.max(0, 0.5 + 0.35 * Math.sin(t * 9) * Math.sin(t * 3.3) + 0.25 * Math.sin(t * 17.3));
    wobU.uT.value = t;
    wobU.uAmp.value = (1 + voice * 1.6) * motion;
    camera.updateMatrixWorld();
    wobU.uKeyDir.value.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse);
    wobU.uBackDir.value.copy(rim.position).normalize().transformDirection(camera.matrixWorldInverse);

    // Float, breathe, a squash when tapped.
    const sinceBoop = t - boopAt;
    const bounce = sinceBoop < 0.6 && bodyOn && !still ? Math.sin((sinceBoop / 0.6) * Math.PI) * Math.exp(-sinceBoop * 3) : 0;
    const breathe = 1 + 0.012 * Math.sin(t * 1.6) * motion + voice * 0.03;
    body.scale.set(breathe * (1 + bounce * 0.12), breathe * (1 - bounce * 0.12), breathe);
    rig.position.y = 0.1 + Math.sin(t * 1.1) * 0.07 * motion + bounce * 0.18;
    shadow.scale.setScalar(1 - (rig.position.y - 0.1) * 0.9);
    shadowMat.opacity = 0.9 - (rig.position.y - 0.1) * 1.5;

    // Follow a given gaze, else drift.
    const lx = gaze ? (look.tx ?? Math.sin(t * 0.37) * 0.35) : 0;
    const ly = gaze ? (look.tx === null ? Math.sin(t * 0.53) * 0.2 : look.ty) : 0;
    look.x += (lx - look.x) * 0.06;
    look.y += (ly - look.y) * 0.06;
    if (still || !gaze) {
      look.x = 0;
      look.y = 0;
    }
    rig.rotation.y = still ? 0.18 : look.x * 0.42 * (bodyOn ? 1 : 0.5);
    visorU.uEdgeOn.value = 0;
    rig.rotation.x = look.y * 0.22 + Math.sin(t * 0.8) * 0.02 * motion;
    rig.rotation.z = -look.x * 0.06 + (face === 'confused' ? 0.14 : 0);

    // Colour eases to the chosen one.
    if (still) colourNow.copy(colourTarget);
    else colourNow.lerp(colourTarget, 0.08);
    bodyMat.color.copy(colourNow);
    const f = FINISH[colour] ?? [0, 0.03];
    finish.hi += (f[0] - finish.hi) * (still ? 1 : 0.08);
    finish.lift += (f[1] - finish.lift) * (still ? 1 : 0.08);
    wobU.uHi.value = finish.hi;
    wobU.uLift.value = finish.lift;
    wobU.uWarm.value = colour === FLOW_IVORY ? 1 : 0.25;

    // Blink every few seconds.
    if (t > blinkAt + blinkDur) blinkAt = t + 2.2 + Math.random() * 3.2;
    const bp = (t - blinkAt) / blinkDur;
    const blink = gaze && bp > 0 && bp < 1 ? Math.max(0.08, Math.abs(Math.cos(bp * Math.PI))) : 1;

    // Faces cross over with a small squash. The canvas is an emissive map, so its ground must be opaque black.
    ex.fillStyle = '#000';
    ex.fillRect(0, 0, EW, EH);
    const k = faceAt < 0 || still || !faceOn ? 1 : Math.min(1, (t - faceAt) / 0.26);
    const dx = look.x * 22;
    const dy = look.y * 14;
    if (k < 1) drawFace(prevFace, 1 - k, 1 - k * 0.6, blink, dx, dy);
    drawFace(face, k, 0.4 + 0.6 * k + (mode === 'talking' ? voice * 0.08 : 0), blink, dx, dy);
    eyeTex.needsUpdate = true;

    renderer.render(scene, camera);
  }

  if (paused()) frame();
  else schedule();

  return {
    setFace(next) {
      if (next === face || !DRAW[next]) return;
      prevFace = face;
      face = next;
      faceAt = clock.getElapsedTime();
      if (paused()) frame();
    },
    setMode(next) {
      mode = next;
    },
    setColour(hex) {
      colour = hex.toLowerCase();
      paint(colourTarget, colour);
      if (paused()) frame();
    },
    boop() {
      boopAt = clock.getElapsedTime();
    },
    lookAt(x, y = 0) {
      look.tx = x;
      look.ty = y;
    },
    setVoice(level) {
      voiceIn = level;
    },
    setMotion(body, faceMotion) {
      bodyOn = body;
      faceOn = faceMotion;
      if (paused()) {
        cancelAnimationFrame(raf);
        raf = 0;
        frame();
      } else schedule();
    },
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      for (const g of [bodyGeo, visorGeo, rimGeo, shadowGeo]) g.dispose();
      for (const m of [bodyMat, visorMat, rimMat, shadowMat]) m.dispose();
      for (const t of [eyeTex, ...textures]) t.dispose();
      envRT.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
