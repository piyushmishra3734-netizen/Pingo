import { Color } from 'three';

/**
 * The world's colours, by time of day. Everything that is coloured - the
 * painted panorama, fog, lights, windows - reads from here, so each hour is
 * one picture rather than a pile of separately tuned parts.
 *
 * Dusk is the film's hour and is sampled from it: a deep navy sky lifting to
 * a grey-blue haze, a turquoise sea, cool light on everything and warm light
 * only from windows and lamps.
 *
 * Top-level hex strings become three.js Colors; `panorama` stays as CSS
 * strings for the canvas painter.
 */

const DAY = {
  panorama: {
    zenith: '#2f7fd0',
    sky: '#58a3e0',
    skyLow: '#8cc6ea',
    haze: '#cbe6f0',
    horizonLine: '#f2fbff',
    seaFar: '#6fc3d8',
    sea: '#3bb0d0',
    seaNear: '#35bfe0',
    skyCloud: { shade: '#9db8d8', mid: '#cfdff0', lit: '#f4f8fc', glow: '#ffffff' },
    seaCloud: { shade: '#8fb0d6', mid: '#cddcef', lit: '#f3f6fb', glow: '#ffffff' },
  },
  sun: '#ffe7b8',
  sunDirection: [0.55, 0.6, 0.58],
  fog: '#b9dfe9',
  hemiSky: '#e4f2ff',
  hemiGround: '#8a8a62',
  hemiIntensity: 1.15,
  sunIntensity: 2.1,
  windows: 0.0,
  stars: 0,
  lampPools: 0,
};

const DUSK = {
  panorama: {
    zenith: '#16284a',
    sky: '#253f63',
    skyLow: '#3e5f82',
    haze: '#6f8aa6',
    horizonLine: '#b9c8d6',
    seaFar: '#4f7ea3',
    sea: '#2e86ad',
    seaNear: '#2a9fc2',
    skyCloud: { shade: '#4a5b80', mid: '#66789e', lit: '#8d9dbd', glow: '#b8c1d8' },
    seaCloud: { shade: '#46628f', mid: '#6883b0', lit: '#97abcd', glow: '#c3d0e6' },
  },
  sun: '#c9d4f2',
  sunDirection: [-0.45, 0.55, -0.7],
  fog: '#56708f',
  hemiSky: '#9fb2d6',
  hemiGround: '#2c3446',
  hemiIntensity: 1.25,
  sunIntensity: 0.7,
  windows: 0.95,
  stars: 0.6,
  lampPools: 0.8,
};

const NIGHT = {
  panorama: {
    zenith: '#070f24',
    sky: '#0f1d3c',
    skyLow: '#1c3052',
    haze: '#2f4668',
    horizonLine: '#58708f',
    seaFar: '#1f3f62',
    sea: '#18506f',
    seaNear: '#1a6284',
    skyCloud: { shade: '#26324f', mid: '#3a4769', lit: '#5a6788', glow: '#76829f' },
    seaCloud: { shade: '#26385c', mid: '#3c5078', lit: '#62759c', glow: '#8595b8' },
  },
  sun: '#bcd3ff',
  sunDirection: [0.35, 0.55, 0.75],
  fog: '#26395a',
  hemiSky: '#6f86c0',
  hemiGround: '#1c2440',
  hemiIntensity: 0.95,
  sunIntensity: 0.4,
  windows: 1.0,
  stars: 1,
  lampPools: 1,
};

export const TIMES = { day: DAY, dusk: DUSK, night: NIGHT };

export function paletteFor(name) {
  const source = TIMES[name] ?? DUSK;
  const out = {};
  for (const [key, value] of Object.entries(source)) out[key] = typeof value === 'string' ? new Color(value) : value;
  return out;
}
