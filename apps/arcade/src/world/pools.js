import { AdditiveBlending, CanvasTexture, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry } from 'three';

/**
 * Pools of warm light on the ground under lamps and lanterns - at dusk the
 * film's paving glows around every lamp post, and that glow is most of what
 * makes the streets feel lit. Real lights would cost a shader pass each; these
 * are soft additive decals, all of them one instanced draw call.
 */

function poolTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,214,150,0.9)');
  g.addColorStop(0.35, 'rgba(255,190,120,0.45)');
  g.addColorStop(1, 'rgba(255,170,100,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/** @param {number[][]} lights - [x, y, z] of each lamp head; the pool lies on the ground at y */
export function createLightPools(lights, strength = 1) {
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: strength, fog: false });
  const mesh = new InstancedMesh(plane, material, Math.max(1, lights.length));
  const matrix = new Matrix4();
  lights.forEach(([x, y, z], i) => {
    matrix.makeScale(7, 1, 7).setPosition(x, y + 0.06, z);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.count = lights.length;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
