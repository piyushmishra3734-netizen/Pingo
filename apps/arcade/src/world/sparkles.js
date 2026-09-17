import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';

/**
 * Motes of light drifting in the air along the line - the little sparkles that
 * make the film's dusk feel alive. One Points draw call; each mote bobs and
 * twinkles in the shader, so nothing is updated on the CPU.
 */

const vertexShader = /* glsl */ `
  attribute float phase;
  uniform float time;
  uniform float scale;
  varying float vTwinkle;
  void main() {
    vec3 p = position;
    p.y += sin(time * 0.6 + phase) * 1.2;
    p.x += sin(time * 0.3 + phase * 2.0) * 0.8;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    vTwinkle = 0.5 + 0.5 * sin(time * 2.2 + phase * 7.0);
    // Never a blot: a mote right by the camera stays a mote.
    gl_PointSize = min(scale * (0.6 + vTwinkle * 0.8) / -view.z, scale * 0.02);
    gl_Position = projectionMatrix * view;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 colour;
  uniform float strength;
  varying float vTwinkle;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float glow = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(colour * glow * glow * (0.4 + vTwinkle * 0.6) * strength, 1.0);
  }
`;

/**
 * @param {import('three').Curve<import('three').Vector3>} curve
 * @param {number} count
 * @param {number} strength - 0 in full day, up to 1 at night
 */
export function createSparkles(curve, count, strength) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  let s = 17;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < count; i += 1) {
    const p = curve.getPointAt(r());
    positions[i * 3] = p.x + (r() - 0.5) * 30;
    positions[i * 3 + 1] = p.y + 1 + r() * 9;
    positions[i * 3 + 2] = p.z + (r() - 0.5) * 30;
    phases[i] = r() * 100;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new BufferAttribute(phases, 1));
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      time: { value: 0 },
      scale: { value: 300 },
      colour: { value: [1, 0.93, 0.75] },
      strength: { value: strength },
    },
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    update(seconds, pixelRatio) {
      material.uniforms.time.value = seconds;
      material.uniforms.scale.value = 300 * pixelRatio;
    },
  };
}
