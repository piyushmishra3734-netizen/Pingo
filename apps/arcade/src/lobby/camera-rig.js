import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

/**
 * Moves the camera between poses - the room overview, a seat - smoothly.
 *
 * Time-based, driven from the one frame loop: a phone that drops to 40 fps
 * still arrives in the same 900 ms, just in fewer steps. Position is
 * interpolated in a straight line and orientation by slerp, so the view turns
 * the shortest way round instead of swinging past its target.
 */

/** Slow out, fast through the middle, slow in: how a head turns to look. */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Eased progress of a tween at `now`, clamped to 0..1. */
export function tweenProgress(now, start, duration) {
  if (duration <= 0) return 1;
  return easeInOutCubic(Math.min(1, Math.max(0, (now - start) / duration)));
}

/**
 * A pose is where the camera stands and what it looks at, both as [x, y, z].
 * @typedef {{ position: number[], lookAt: number[] }} Pose
 */

// A camera, not a plain Object3D: `lookAt` aims a camera's -Z at the target,
// an Object3D's +Z - using the wrong one would face every seat backwards.
const scratch = new PerspectiveCamera();

export function createCameraRig(camera) {
  const fromPosition = new Vector3();
  const toPosition = new Vector3();
  const fromRotation = new Quaternion();
  const toRotation = new Quaternion();
  let start = 0;
  let duration = 0;
  let moving = false;

  return {
    /** Jump straight to a pose - for the first frame, where there is nothing to glide from. */
    snap(pose) {
      camera.position.set(...pose.position);
      camera.lookAt(...pose.lookAt);
      moving = false;
    },

    /** Glide from wherever the camera is now, even mid-glide, to `pose`. */
    moveTo(pose, ms = 900) {
      fromPosition.copy(camera.position);
      fromRotation.copy(camera.quaternion);
      scratch.position.set(...pose.position);
      scratch.lookAt(...pose.lookAt);
      toPosition.copy(scratch.position);
      toRotation.copy(scratch.quaternion);
      start = performance.now();
      duration = ms;
      moving = true;
    },

    /** Once per frame, before rendering. */
    update(now) {
      if (!moving) return;
      const t = tweenProgress(now, start, duration);
      camera.position.lerpVectors(fromPosition, toPosition, t);
      camera.quaternion.slerpQuaternions(fromRotation, toRotation, t);
      if (t >= 1) moving = false;
    },

    get moving() {
      return moving;
    },
  };
}
