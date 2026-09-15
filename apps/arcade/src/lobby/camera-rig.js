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

/*
 * Walking: the camera rides behind and above the player, always from the
 * street side, so the stick's "up" is always "further in". It trails rather
 * than locks - an exponential catch-up, frame-rate independent - which also
 * makes standing up a glide from the seat back out to here, for free.
 */
const FOLLOW = { height: 5.2, back: 6.2, aimHeight: 1.0, aimAhead: 1.5 };

export function createFollow(camera) {
  const position = new Vector3();
  const target = new Vector3();
  const wantPosition = new Vector3();
  const wantTarget = new Vector3();

  const aimAt = (at) => {
    wantPosition.set(at.x, FOLLOW.height, at.z + FOLLOW.back);
    wantTarget.set(at.x, FOLLOW.aimHeight, at.z - FOLLOW.aimAhead);
  };
  const apply = () => {
    camera.position.copy(position);
    camera.lookAt(target);
  };

  return {
    /** Straight to the player - the first frame. */
    snap(at) {
      aimAt(at);
      position.copy(wantPosition);
      target.copy(wantTarget);
      apply();
    },

    /** Take over from wherever the camera is, looking at `lookAt` - after a seat. */
    reset(lookAt) {
      position.copy(camera.position);
      target.set(...lookAt);
    },

    update(dt, at) {
      aimAt(at);
      const catchUp = 1 - Math.exp(-dt * 6);
      position.lerp(wantPosition, catchUp);
      target.lerp(wantTarget, catchUp);
      apply();
    },
  };
}

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
  /** Settles the promise of the glide in progress: true arrived, false superseded. */
  let settle;

  const finish = (arrived) => {
    const done = settle;
    settle = undefined;
    done?.(arrived);
  };

  return {
    /** Jump straight to a pose - for the first frame, where there is nothing to glide from. */
    snap(pose) {
      camera.position.set(...pose.position);
      camera.lookAt(...pose.lookAt);
      moving = false;
      finish(false);
    },

    /**
     * Glide from wherever the camera is now, even mid-glide, to `pose`.
     *
     * Resolves true on arrival, or false if another move replaced this one -
     * so a caller waiting to do something *at* the destination (start a game
     * at the screen) can tell that the destination changed under it.
     */
    moveTo(pose, ms = 900) {
      finish(false);
      fromPosition.copy(camera.position);
      fromRotation.copy(camera.quaternion);
      scratch.position.set(...pose.position);
      scratch.lookAt(...pose.lookAt);
      toPosition.copy(scratch.position);
      toRotation.copy(scratch.quaternion);
      start = performance.now();
      duration = ms;
      moving = true;
      return new Promise((resolve) => {
        settle = resolve;
      });
    },

    /** Once per frame, before rendering. */
    update(now) {
      if (!moving) return;
      const t = tweenProgress(now, start, duration);
      camera.position.lerpVectors(fromPosition, toPosition, t);
      camera.quaternion.slerpQuaternions(fromRotation, toRotation, t);
      if (t >= 1) {
        moving = false;
        finish(true);
      }
    },

    get moving() {
      return moving;
    },
  };
}
