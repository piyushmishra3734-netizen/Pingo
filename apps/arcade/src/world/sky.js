import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

/**
 * The sky: one inside-out sphere and one small shader - a gradient from the
 * horizon haze up to the zenith, a soft glow where the sun (or moon) is, and
 * at night a scatter of stars that twinkle. No texture, no cubemap.
 *
 * It follows the camera, so it is always "infinitely" far away.
 */

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // on the far plane, behind everything
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
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
    // Below the horizon the sky keeps the haze colour: the cloud sea covers it.
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(horizon, zenith, pow(up, 0.55));

    // A wide soft halo and a small bright core where the light is.
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 6.0) * 0.28 + pow(s, 180.0) * 0.9);

    if (stars > 0.0) {
      vec3 cell = floor(d * 180.0);
      float h = hash(cell);
      float star = step(0.9965, h) * smoothstep(0.02, 0.35, up);
      float twinkle = 0.6 + 0.4 * sin(time * 2.0 + h * 80.0);
      col += vec3(star * twinkle * stars);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(palette) {
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: palette.zenith },
      horizon: { value: palette.horizon },
      sunColor: { value: palette.sun },
      sunDir: { value: new Vector3(...palette.sunDirection) },
      stars: { value: palette.stars },
      time: { value: 0 },
    },
  });
  const mesh = new Mesh(new SphereGeometry(900, 24, 12), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;

  return {
    mesh,
    update(camera, seconds) {
      mesh.position.copy(camera.position);
      material.uniforms.time.value = seconds;
    },
  };
}
