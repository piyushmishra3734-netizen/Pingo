import { Group } from 'three';

import { createTramAnimator } from './animate.js';
import { buildCarriage } from './carriage.js';
import { buildCompanion, buildDrivingCab } from './cars.js';
import { COUPLING_GAP } from './contract.js';
import { createTramDrive, stepTramDrive } from './drive.js';
import { ROOFS } from './roofs.js';

/**
 * The tram, assembled: a front car, the open carriage, and whichever roof is
 * fitted. The parts come from their own modules (carriage.js, cars.js,
 * roofs.js); this puts them together, keeps them in step with the driving
 * logic (drive.js) and the animator (animate.js), and swaps parts when the
 * workshop asks.
 *
 * Nobody drives most of the time, so an autopilot rides the line: it holds a
 * cruising speed, leans into the wind, brakes for each station and opens the
 * doors. Take `input` over (world.js does that while the player rides) and the
 * same logic runs with their inputs instead.
 */

export const FRONT_CARS = {
  cab: { name: 'Wooden cab', build: buildDrivingCab },
  companion: { name: 'Little Companion', build: buildCompanion },
};

/** The contract's door/step hints, as the animator expects to find them. */
function teachAnimator(car) {
  for (const door of car.doors ?? []) {
    if (door.userData.openOffset === undefined) door.userData.openOffset = door.userData.slide ?? 0.9;
  }
  for (const step of car.steps ?? []) {
    if (step.userData.openAngle === undefined) step.userData.openAngle = step.userData.fold ?? -Math.PI / 2;
  }
  // Every lamp on the car breathes with the hour rather than being fixed at build.
  car.group.traverse((object) => {
    const material = object.material;
    if (!material || Array.isArray(material) || !material.emissive) return;
    if ((material.emissiveIntensity ?? 0) <= 0) return;
    object.userData.flicker = true;
  });
}

/**
 * @param {{
 *   palette: { windows: number },
 *   quality?: { detail?: number, props?: number },
 *   curve: import('three').Curve<import('three').Vector3>,
 *   stations: Array<{ name: string, at: number }>,
 *   config?: { front?: keyof typeof FRONT_CARS, roof?: keyof typeof ROOFS },
 * }} options
 */
export function createTram({ palette, quality = {}, curve, stations, config = {} }) {
  const glow = palette.windows;
  const detail = Math.max(0, Math.min(3, Math.round(quality.props ?? 2)));
  const group = new Group();

  const fitted = { front: config.front ?? 'cab', roof: config.roof ?? 'hearthLeaves' };
  const carriage = buildCarriage({ detail, glow });
  let front = FRONT_CARS[fitted.front].build({ detail, glow });
  let roof = ROOFS[fitted.roof].build({ length: carriage.length, width: carriage.width ?? 2.7, detail, glow });
  carriage.roofMount.add(roof);
  group.add(front.group, carriage.group);

  let cars = [front, carriage];
  let animator = createTramAnimator(cars);
  for (const car of cars) teachAnimator(car);

  const lineLength = curve.getLength();
  const drive = createTramDrive({ routeLength: lineLength, stations, seed: 7 });
  /** What the driver is doing; the autopilot fills it in when nobody is aboard. */
  const input = { power: false, brake: false, lean: 0, openDoors: false };
  let autopilot = true;

  const ahead = curve.getPointAt(0).clone();

  function autoInput() {
    // Cruise, ease off for a station, and lean the way the wind pushes.
    const stopping = (drive.speed * drive.speed) / (2 * 3.2) + 6;
    const braking = drive.phase === 'arriving' && drive.distanceToNext < stopping;
    input.power = !braking && drive.phase !== 'doors' && drive.speedKmh < 42;
    input.brake = braking && drive.speed > 0.2;
    input.lean = Math.max(-1, Math.min(1, drive.crosswind * 1.1));
    input.openDoors = drive.canOpenDoors;
  }

  /** Puts the cars along the line, nose to tail, from the front car's position. */
  function place() {
    let back = 0;
    for (const car of cars) {
      const at = (((drive.position - back - car.length / 2) / lineLength) % 1 + 1) % 1;
      const p = curve.getPointAt(at);
      curve.getPointAt((at + 0.0015) % 1, ahead);
      car.group.position.set(p.x, p.y, p.z);
      car.group.lookAt(ahead.x, ahead.y, ahead.z);
      back += car.length + COUPLING_GAP;
    }
  }

  place();

  return {
    group,
    drive,
    input,
    get cars() {
      return cars;
    },
    /** The carriage, for the workshop's part swaps and the ride camera. */
    carriage,
    get front() {
      return front;
    },
    get fitted() {
      return { ...fitted };
    },
    set autopilot(on) {
      autopilot = on;
      if (on) return;
      input.power = false;
      input.brake = false;
      input.lean = 0;
      input.openDoors = false;
    },
    get autopilot() {
      return autopilot;
    },

    /**
     * One step: the driving logic, then the cars on the line, then the parts
     * inside them. Returns the events the driving logic raised this step.
     */
    update(dt, seconds) {
      if (autopilot) autoInput();
      stepTramDrive(drive, input, dt);
      // A press, not a hold: the logic only wants the moment it was asked.
      input.openDoors = false;
      place();
      animator.update(dt, { speed: drive.speed, lean: drive.balance, doorsOpen: drive.doorsOpen, glow, seconds });
      return drive.events;
    },

    /** Fits a different roof, lifted on and off as the workshop's crane does. */
    swapRoof(id, onStatus) {
      if (!ROOFS[id]) return Promise.resolve();
      fitted.roof = id;
      const next = ROOFS[id].build({ length: carriage.length, width: carriage.width ?? 2.7, detail, glow });
      const swap = animator.swapPart({ parent: carriage.roofMount, oldPart: roof, newPart: next, onStatus });
      roof = next;
      return swap;
    },

    /** Fits a different car in front; the old one is lifted away. */
    swapFront(id, onStatus) {
      if (!FRONT_CARS[id]) return Promise.resolve();
      fitted.front = id;
      const next = FRONT_CARS[id].build({ detail, glow });
      next.group.position.copy(front.group.position);
      next.group.quaternion.copy(front.group.quaternion);
      const old = front.group;
      front = next;
      cars = [front, carriage];
      animator = createTramAnimator(cars);
      for (const car of cars) teachAnimator(car);
      const swap = animator.swapPart({ parent: group, oldPart: old, newPart: next.group, onStatus });
      place();
      return swap;
    },
  };
}
