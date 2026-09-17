import {
  CanvasTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';

/**
 * Clouds, two ways, both cheap.
 *
 * The sea: one opaque plane far below the islands - turquoise water with
 * the soft shadows of the cloud field on it. It follows the camera but is
 * patterned in world space, so it never slides.
 *
 * The clouds: billboards drawn from a painted cumulus atlas made on a canvas
 * at boot, in two instanced meshes (two draw calls). The field - hundreds of
 * them lying on the sea - is cut out crisp and writes depth, so they overlap
 * like painted billows with no sorting; the few high in the sky are soft.
 */

const NOISE = /* glsl */ `
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < OCTAVES; i++) {
      v += a * noise2(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      a *= 0.5;
    }
    return v;
  }
`;

const seaVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const seaFragment = /* glsl */ `
  uniform vec3 cloudLight;
  uniform vec3 cloudShade;
  uniform vec3 sea;
  uniform vec3 seaFar;
  uniform vec3 fogColor;
  uniform vec2 sunXZ;
  uniform vec3 eye;
  uniform float time;
  varying vec3 vWorld;
  ${NOISE}
  void main() {
    vec2 uv = vWorld.xz * 0.0045 + vec2(time * 0.003, time * 0.001);
    float dist = length(vWorld.xz - eye.xz);
    vec3 water = mix(sea, seaFar, smoothstep(250.0, 2200.0, dist));
    // The cloud field's shadows on the water, and faint long glints.
    float shadow = smoothstep(0.5, 0.62, fbm(uv - sunXZ * 0.05));
    water *= 1.0 - shadow * 0.12;
    water += vec3(0.06) * smoothstep(0.75, 0.92, noise2(vWorld.xz * vec2(0.008, 0.04) + time * 0.04)) * (1.0 - shadow);
    vec3 col = mix(water, fogColor, smoothstep(1800.0, 2600.0, dist) * 0.7);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** A 2x2 atlas of painted cumulus: red channel = how lit, alpha = cloud. */
function cumulusAtlas() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size;
  const out = canvas.getContext('2d');
  const image = out.createImageData(canvas.width, canvas.height);
  let seed = 11;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (let cell = 0; cell < 4; cell += 1) {
    const w = size;
    const h = size / 2;
    const ox = (cell % 2) * w;
    const oy = Math.floor(cell / 2) * h;
    const cover = document.createElement('canvas');
    cover.width = w;
    cover.height = h;
    const c = cover.getContext('2d');
    const shade = document.createElement('canvas');
    shade.width = w;
    shade.height = h;
    const s = shade.getContext('2d');
    // Base: shaded underside, lighter towards the top.
    const g = s.createLinearGradient(0, h * 0.2, 0, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#3a3a3a');
    s.fillStyle = g;
    s.fillRect(0, 0, w, h);
    c.filter = 'blur(2px)';
    s.filter = 'blur(7px)';
    // A mound of billows: big ones low and wide, smaller ones stacked on top.
    const blobs = 14 + cell * 3;
    for (let i = 0; i < blobs; i += 1) {
      const t = random();
      const x = w * (0.16 + 0.68 * random());
      const r = h * (0.12 + 0.22 * (1 - Math.abs(x / w - 0.5) * 1.6) * (0.6 + random() * 0.6));
      const y = h * 0.82 - r * (0.4 + t * 1.4) * (1 - Math.abs(x / w - 0.5));
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      // Each billow is lit on its upper side.
      const hl = s.createRadialGradient(x - r * 0.25, y - r * 0.45, r * 0.1, x, y, r);
      hl.addColorStop(0, 'rgba(255,255,255,0.95)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      s.fillStyle = hl;
      s.beginPath();
      s.arc(x, y, r, 0, Math.PI * 2);
      s.fill();
    }
    // A flat, soft base, the way cumulus sit on a layer of air.
    c.fillRect(w * 0.12, h * 0.8, w * 0.76, h * 0.06);
    const a = c.getImageData(0, 0, w, h).data;
    const l = s.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const o = ((oy + y) * canvas.width + ox + x) * 4;
        image.data[o] = l[i];
        image.data[o + 1] = l[i];
        image.data[o + 2] = l[i];
        image.data[o + 3] = a[i + 3];
      }
    }
  }
  out.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const puffVertex = /* glsl */ `
  attribute float cell;
  uniform float time;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vDist;
  void main() {
    vLocal = uv;
    vec3 centre = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float width = length(instanceMatrix[0].xyz);
    float height = length(instanceMatrix[1].xyz);
    centre.x += sin(time * 0.02 + centre.z * 0.01) * 12.0;
    vec4 view = viewMatrix * modelMatrix * vec4(centre, 1.0);
    view.xy += position.xy * vec2(width, height);
    vDist = -view.z;
    vUv = (uv + vec2(mod(cell, 2.0), floor(cell / 2.0))) * vec2(0.5, 0.5);
    gl_Position = projectionMatrix * view;
  }
`;

const puffFragment = /* glsl */ `
  uniform sampler2D atlas;
  uniform vec3 cloudLight;
  uniform vec3 cloudShade;
  uniform vec3 fogColor;
  uniform float cutout;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vDist;
  void main() {
    vec4 t = texture2D(atlas, vUv);
    // Never a hard edge where a billow meets the side of its cell.
    t.a *= smoothstep(0.0, 0.1, vLocal.x) * smoothstep(1.0, 0.9, vLocal.x) * smoothstep(0.0, 0.08, vLocal.y) * smoothstep(1.0, 0.85, vLocal.y);
    // Close to the eye a cloud thins away rather than filling the screen.
    t.a *= smoothstep(25.0, 90.0, vDist);
    if (t.a < mix(0.02, 0.5, cutout)) discard;
    // Painted in three soft tones: shaded skirt, mid, lit crown - and a cool
    // edge where the billow thins, the way a painter outlines cumulus in blue.
    float tone = smoothstep(0.42, 0.55, t.r) * 0.4 + smoothstep(0.7, 0.85, t.r) * 0.6;
    vec3 col = mix(cloudShade, cloudLight, tone);
    col = mix(col, cloudShade, (1.0 - smoothstep(0.5, 0.72, t.a)) * 0.3);
    col = mix(col, fogColor, smoothstep(300.0, 1500.0, vDist) * 0.75);
    gl_FragColor = vec4(col, mix(t.a, 1.0, cutout));
  }
`;

/**
 * @param {ReturnType<import('./palette.js').paletteFor>} palette
 * @param {Array<{ x: number, y: number, z: number, w: number }>} puffs
 */
export function createClouds(palette, { sky: puffs, field }, quality = { octaves: 4 }) {
  const sunXZ = new Vector2(palette.sunDirection[0], palette.sunDirection[2]).normalize();
  const seaMaterial = new ShaderMaterial({
    vertexShader: seaVertex,
    fragmentShader: seaFragment,
    defines: { OCTAVES: quality.octaves },
    uniforms: {
      cloudLight: { value: palette.cloudLight },
      cloudShade: { value: palette.cloudShade },
      sea: { value: palette.sea },
      seaFar: { value: palette.seaFar },
      fogColor: { value: palette.horizon },
      sunXZ: { value: sunXZ },
      eye: { value: new Vector3() },
      time: { value: 0 },
    },
  });
  const seaGeometry = new PlaneGeometry(5200, 5200, 1, 1);
  seaGeometry.rotateX(-Math.PI / 2);
  const sea = new Mesh(seaGeometry, seaMaterial);
  sea.position.y = -60;
  sea.frustumCulled = false;
  sea.renderOrder = -5;

  const atlas = cumulusAtlas();
  const sprites = (list, cutout) => {
    const quad = new PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const material = new ShaderMaterial({
      vertexShader: puffVertex,
      fragmentShader: puffFragment,
      transparent: !cutout,
      depthWrite: Boolean(cutout),
      side: DoubleSide,
      uniforms: {
        atlas: { value: atlas },
        cloudLight: { value: palette.cloudLight },
        cloudShade: { value: palette.cloudShade },
        fogColor: { value: palette.horizon },
        cutout: { value: cutout },
        time: { value: 0 },
      },
    });
    const mesh = new InstancedMesh(quad, material, list.length);
    const cells = new Float32Array(list.length);
    const matrix = new Matrix4();
    list.forEach(({ x, y, z, w }, i) => {
      matrix.compose(new Vector3(x, y, z), new Quaternion(), new Vector3(w, w * 0.5, 1));
      mesh.setMatrixAt(i, matrix);
      cells[i] = i % 4;
    });
    quad.setAttribute('cell', new InstancedBufferAttribute(cells, 1));
    mesh.frustumCulled = false;
    return mesh;
  };
  const mesh = sprites(puffs, 0);
  mesh.renderOrder = 5;
  const fieldMesh = sprites(field, 1);

  return {
    sea,
    puffs: mesh,
    field: fieldMesh,
    update(camera, seconds) {
      sea.position.x = camera.position.x;
      sea.position.z = camera.position.z;
      seaMaterial.uniforms.eye.value.copy(camera.position);
      seaMaterial.uniforms.time.value = seconds;
      mesh.material.uniforms.time.value = seconds;
      fieldMesh.material.uniforms.time.value = seconds;
    },
  };
}

