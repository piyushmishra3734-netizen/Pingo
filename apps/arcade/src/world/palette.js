import { Color } from 'three';

/**
 * The world's colours, by time of day. Everything that is coloured - sky,
 * clouds, fog, lights, windows - reads from here, so day and night stay one
 * picture rather than a pile of separately tuned parts.
 *
 * Pastel and soft on purpose: a painted film, not neon and not photographic.
 */

const DAY = {
  zenith: '#3f8fd6',
  horizon: '#bfe6ef',
  sun: '#ffe7b8',
  sunDirection: [0.55, 0.6, 0.58],
  cloudLight: '#fffaf0',
  cloudShade: '#9fc2dd',
  sea: '#3fb3bd',
  seaFar: '#8fd3d6',
  fog: '#b9dfe9',
  hemiSky: '#e4f2ff',
  hemiGround: '#8a8a62',
  hemiIntensity: 1.15,
  sunIntensity: 2.1,
  windows: 0.0,
  stars: 0,
};

const DUSK = {
  zenith: '#34527c',
  horizon: '#7390b0',
  sun: '#ffe2b8',
  sunDirection: [-0.55, 0.35, -0.76],
  cloudLight: '#f1eff7',
  cloudShade: '#5f7fb8',
  sea: '#4cc6ea',
  seaFar: '#3a9fd0',
  fog: '#6f8db0',
  hemiSky: '#c6d3ec',
  hemiGround: '#4a5a70',
  hemiIntensity: 1.35,
  sunIntensity: 0.85,
  windows: 0.5,
  stars: 0.35,
};

const NIGHT = {
  zenith: '#0d1a3a',
  horizon: '#33507a',
  sun: '#bcd3ff',
  sunDirection: [0.35, 0.55, 0.75],
  cloudLight: '#b8c8e6',
  cloudShade: '#3e5480',
  sea: '#17506e',
  seaFar: '#2c5a80',
  fog: '#2a4268',
  hemiSky: '#6f86c0',
  hemiGround: '#1c2440',
  hemiIntensity: 1.0,
  sunIntensity: 0.45,
  windows: 1.0,
  stars: 1,
};

export const TIMES = { day: DAY, dusk: DUSK, night: NIGHT };

/** A palette with every hex turned into a three.js Color, for uniforms and lights. */
export function paletteFor(name) {
  const source = TIMES[name] ?? DAY;
  const out = {};
  for (const [key, value] of Object.entries(source)) out[key] = typeof value === 'string' ? new Color(value) : value;
  return out;
}
