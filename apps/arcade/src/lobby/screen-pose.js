import { Vector3 } from 'three';

/**
 * Where the camera must stand for a cabinet's screen to fill the view, and
 * where on the page that screen then lands.
 *
 * The zoom ends with the 2D game canvas taking the 3D screen's place, and
 * that swap is only invisible if the canvas sits exactly where the screen was
 * drawn. So the pose is computed from the screen's real size and the camera's
 * real field of view, and the canvas rectangle is measured by projecting the
 * screen's own corners - not assumed from either.
 */

/**
 * How far back a camera must be for a `width` x `height` rectangle, faced
 * square-on, to fit its view exactly: as close as possible with all of it
 * still in frame. Whichever of height and width runs out first decides.
 */
export function fitDistance(width, height, verticalFovDeg, aspect) {
  const halfTan = Math.tan((verticalFovDeg * Math.PI) / 360);
  return Math.max(height / 2 / halfTan, width / 2 / (halfTan * aspect));
}

const centre = new Vector3();
const normal = new Vector3();
const scale = new Vector3();

/**
 * The pose that puts `screen` (a plane mesh) square in front of the camera,
 * filling it. Along the screen's own normal, so a tilted screen is seen as a
 * rectangle rather than a trapezoid.
 */
export function screenPose(screen, camera, margin = 1) {
  screen.updateWorldMatrix(true, false);
  screen.getWorldPosition(centre);
  // A mesh's "direction" is its local +Z in world space: the way the glass faces.
  screen.getWorldDirection(normal);
  screen.getWorldScale(scale);
  const { width, height } = screen.geometry.parameters;
  const distance = fitDistance(width * scale.x, height * scale.y, camera.fov, camera.aspect) * margin;
  return {
    position: centre.clone().addScaledVector(normal, distance).toArray(),
    lookAt: centre.toArray(),
  };
}

/**
 * Where `screen` is on the page, in CSS pixels, seen through `camera` -
 * the rectangle the 2D canvas has to cover.
 *
 * @param {DOMRect} viewport - the WebGL canvas's bounding rect
 */
export function screenRect(screen, camera, viewport) {
  camera.updateMatrixWorld();
  screen.updateWorldMatrix(true, false);
  const { width, height } = screen.geometry.parameters;
  const xs = [];
  const ys = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const corner = new Vector3((sx * width) / 2, (sy * height) / 2, 0)
      .applyMatrix4(screen.matrixWorld)
      .project(camera);
    xs.push(viewport.left + ((corner.x + 1) / 2) * viewport.width);
    ys.push(viewport.top + ((1 - corner.y) / 2) * viewport.height);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
