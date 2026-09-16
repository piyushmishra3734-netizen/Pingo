import { createControls } from '../controls.js';
import { stepsFor, STEP_MS } from '../game-host.js';
import { createRacingCpu } from './cpu.js';
import { MEDALS, clock, createHud } from './hud.js';
import { FINISH_HOLD, IN, createRace, stepRace } from './race.js';
import { createRacingScene } from './scene.js';
import { TRACKS } from './track.js';

/**
 * Kart racing against three computers, full screen in 3D, drawn with the
 * arcade's renderer while the arcade is paused - like boxing.
 *
 * @param {{ renderer: import('three').WebGLRenderer, onSound?: (name: string) => void, engine?: { set: (speed: number, boost: boolean) => void, stop: () => void }, seed?: number }} options
 */

const KEYS = {
  ArrowLeft: IN.LEFT,
  KeyA: IN.LEFT,
  ArrowRight: IN.RIGHT,
  KeyD: IN.RIGHT,
  ArrowDown: IN.BRAKE,
  KeyS: IN.BRAKE,
  Space: IN.DRIFT,
  ShiftLeft: IN.DRIFT,
  KeyJ: IN.DRIFT,
  ArrowUp: IN.DRIFT,
};

const PAD = [
  [
    { label: '◀', bit: IN.LEFT, name: 'Steer left' },
    { label: '▶', bit: IN.RIGHT, name: 'Steer right' },
  ],
  [
    { label: 'BRAKE', bit: IN.BRAKE, name: 'Brake', small: true },
    { label: 'DRIFT', bit: IN.DRIFT, name: 'Drift', raised: true },
  ],
];

const RIVALS = ['Chintu', 'Bruno', 'Viper'];
const TURBO = ['', 'MINI-TURBO!', 'SUPER TURBO!', 'ULTRA TURBO!'];
const TURBO_COLOR = ['', '#4fb3ff', '#ff9a2e', '#ff4fd8'];
const KEY = 'pingo-racing-v1';

function loadProgress() {
  const fresh = { unlocked: 1, best: [] };
  try {
    return { ...fresh, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return fresh;
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* private window: progress lasts this visit */
  }
}

export function createRacing({ renderer, onSound, engine, seed = 1 }) {
  const view = createRacingScene();
  const hud = createHud();
  const controls = createControls({ keys: KEYS, pad: PAD });
  const progress = loadProgress();
  let trackIndex = Math.min(progress.unlocked, TRACKS.length) - 1;
  let race = createRace(TRACKS[trackIndex]);
  let drivers = [];
  let stage = 'menu';
  let done = false;

  let last = 0;
  let accumulator = 0;

  const setPad = (on) => {
    const pad = document.querySelector('.pad');
    if (pad) pad.style.visibility = on ? '' : 'hidden';
  };

  function menu() {
    stage = 'menu';
    setPad(false);
    engine?.set(0, false);
    hud.showTracks(TRACKS, progress, (i) => void pick(i));
  }

  async function pick(index) {
    trackIndex = index;
    race = createRace(TRACKS[index]);
    await view.build(race, 7 + index);
    view.update(race, 0);
    hud.showIntro(TRACKS[index], start);
  }

  function start() {
    const track = TRACKS[trackIndex];
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    race = createRace(track);
    drivers = race.karts.map((_, i) => (i === 0 ? null : createRacingCpu({ pace: track.pace * [0.96, 1, 1.03][i - 1], drift: 0.35 + 0.2 * i, lane: [-2.5, 2.5, 0][i - 1], seed: seed + i })));
    done = false;
    hud.closeMenu();
    setPad(true);
    stage = 'race';
  }

  function results() {
    stage = 'menu';
    setPad(false);
    engine?.set(0, false);
    const track = TRACKS[trackIndex];
    const you = race.karts[0];
    const best = progress.best[trackIndex];
    const record = !best || you.finished < best;
    if (record) progress.best[trackIndex] = you.finished;
    const podium = you.place <= 3;
    const unlockedNow = podium && trackIndex + 1 < TRACKS.length && progress.unlocked < trackIndex + 2;
    if (unlockedNow) progress.unlocked = trackIndex + 2;
    saveProgress(progress);
    const medal = track.medals.findIndex((m) => you.finished <= m * 60);
    const title = you.place === 1 ? '🏆 1st PLACE!' : `${you.place}${['', 'st', 'nd', 'rd', 'th'][you.place]} place`;
    const lines = [
      `${clock(you.finished)}${record ? ' · ⭐ NEW BEST' : ''}${medal >= 0 ? ` · ${MEDALS[medal]}` : ` · 🥉 under ${track.medals[2]}s`}`,
    ];
    if (unlockedNow) lines.push(`🔓 ${TRACKS[trackIndex + 1].name} unlocked!`);
    else if (!podium) lines.push('Top 3 unlocks the next track. Drift the bends for turbos!');
    const standings = [...race.karts]
      .sort((a, b) => a.place - b.place)
      .map((k) => [`${k.place}. ${k.index === 0 ? 'YOU' : RIVALS[k.index - 1]}`, k.finished ? clock(k.finished) : '—', k.index === 0]);
    const next = TRACKS[trackIndex + 1];
    const choices = [];
    if (next && progress.unlocked > trackIndex + 1) choices.push([`Next: ${next.name} ▶`, () => void pick(trackIndex + 1), podium]);
    choices.push(['Race again', start, !podium || !next]);
    choices.push(['All tracks', menu]);
    hud.showResults(title, lines, standings, choices);
    onSound?.(you.place === 1 ? 'cheer' : 'bell');
  }

  function react(event) {
    if (event.type === 'count') onSound?.('count');
    else if (event.type === 'go') onSound?.('go');
    if (event.kart !== 0) return;
    switch (event.type) {
      case 'turbo':
        hud.pop(TURBO[event.level], TURBO_COLOR[event.level]);
        onSound?.('boost');
        break;
      case 'spark':
        onSound?.('spark');
        break;
      case 'rocket':
        hud.pop('ROCKET START!', '#7dff6b');
        onSound?.('boost');
        break;
      case 'slipstream':
        hud.pop('SLIPSTREAM!', '#bfe8ff');
        onSound?.('boost');
        break;
      case 'pad':
        onSound?.('boost');
        break;
      case 'bump':
        onSound?.('block');
        break;
      case 'lap':
        if (event.lap === race.laps - 1) hud.pop('FINAL LAP!', '#ffd84a');
        onSound?.('lap');
        break;
      case 'finish':
        onSound?.('bell');
        break;
      default:
    }
  }

  const ready = view.ready.then(() => pick(trackIndex)).then(menu);

  return {
    is3d: true,
    ready,
    get race() {
      return race;
    },
    get match() {
      return race;
    },

    frame(now) {
      if (!last) last = now;
      const elapsed = now - last;
      last = now;
      const next = stepsFor(accumulator, elapsed);
      accumulator = next.accumulator;
      if (stage === 'race') {
        for (let i = 0; i < next.steps; i += 1) {
          const inputs = race.karts.map((_, k) => (k === 0 ? controls.read() : drivers[k].think(race, k)));
          stepRace(race, inputs);
          race.events.forEach(react);
          if (race.phase === 'finished' && !done && race.t >= FINISH_HOLD) {
            done = true;
            results();
            break;
          }
        }
        const you = race.karts[0];
        engine?.set(you.speed / 26, you.boost > 0);
      }
      view.update(race, Math.min(elapsed, STEP_MS * 5) / 1000);
      hud.update(race);
      renderer.render(view.scene, view.camera);
    },

    resume() {
      last = 0;
      accumulator = 0;
    },

    resize(width, height) {
      view.resize(width, height);
    },

    dispose() {
      engine?.stop();
      controls.dispose();
      hud.dispose();
    },
  };
}
