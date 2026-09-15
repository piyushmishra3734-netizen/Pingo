import { CylinderGeometry, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Shared by every stool, so two stools are still one material. */
const STOOL = new MeshLambertMaterial({ color: 0x2b2740 });

/**
 * A low round stool, the kind bolted in front of an arcade cabinet.
 *
 * One mesh, one material, one draw call: seat, post and foot merged. Ten
 * radial segments is enough at the size this ever appears on screen - a phone
 * showing this stool at 80 pixels wide cannot tell 10 from 32, and 10 costs a
 * third of the triangles. ~120 triangles.
 */
export function createStool() {
  const seat = new CylinderGeometry(0.21, 0.21, 0.07, 10);
  seat.translate(0, 0.52, 0);

  const post = new CylinderGeometry(0.045, 0.045, 0.5, 8);
  post.translate(0, 0.26, 0);

  const foot = new CylinderGeometry(0.17, 0.19, 0.04, 10);
  foot.translate(0, 0.02, 0);

  return new Mesh(mergeGeometries([seat, post, foot]), STOOL);
}
