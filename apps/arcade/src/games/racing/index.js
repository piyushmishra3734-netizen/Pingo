import { ChevronLeft, ChevronRight, LockOpen, Medal, Star, Trophy } from 'lucide';

import { icon, withIcon } from '../../ui/icon.js';
import { createControls } from '../controls.js';
import { stepsFor, STEP_MS } from '../game-host.js';
import { createLockstep, hashNumbers } from '../lockstep.js';
import { createRacingCpu } from './cpu.js';
import { clock, createHud, medal as medalIcon } from './hud.js';
import { FINISH_HOLD, IN, createRace, stepRace } from './race.js';
import { createRacingScene } from './scene.js';
import { TRACKS } from './track.js';

/**
 * Kart racing against three computers, full screen in 3D, drawn with the
 * arcade's renderer while the arcade is paused - like boxing.
 *
 * Against a friend (`online`) it is you and them in karts 0 and 1 plus two
 * computers, run in lockstep (../lockstep.js): both phones step the same race
 * with the same inputs, and the computers draw from the same seed. Each
 * rematch moves on to the next track.
 *
 * @param {{ renderer: import('three').WebGLRenderer, onSound?: (name: string) => void, engine?: { set: (speed: number, boost: boolean) => void, stop: () => void }, seed?: number, online?: { side: 0 | 1, seed: number, net: any, names: [string, string], exit?: () => void } }} options
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
    { label: icon(ChevronLeft, 26), bit: IN.LEFT, name: 'Steer left' },
    { label: icon(ChevronRight, 26), bit: IN.RIGHT, name: 'Steer right' },
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

export function createRacing({ renderer, onSound, engine, seed = 1, online }) {
  const view = createRacingScene();
  const hud = createHud();
  const controls = createControls({ keys: KEYS, pad: PAD });
  const progress = loadProgress();
  let trackIndex = Math.min(progress.unlocked, TRACKS.length) - 1;
  let race = createRace(TRACKS[trackIndex]);
  let drivers = [];
  let stage = 'menu';
  let done = false;
  /** Which kart is you. */
  const you = online?.side ?? 0;
  let lock;
  let rounds = 0;
  const wants = [false, false];
  const offs = [];
  let rematchCard;

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
    const title = you.place === 1 ? withIcon(Trophy, '1st PLACE!', { size: 30 }) : `${you.place}${['', 'st', 'nd', 'rd', 'th'][you.place]} place`;
    const summary = document.createElement('span');
    summary.className = 'ic-label';
    summary.append(clock(you.finished));
    if (record) summary.append(' · ', withIcon(Star, 'NEW BEST', { size: 15 }));
    summary.append(' · ', medal >= 0 ? medalIcon(medal) : withIcon(Medal, `bronze under ${track.medals[2]}s`, { size: 15 }));
    const lines = [summary];
    if (unlockedNow) lines.push(withIcon(LockOpen, `${TRACKS[trackIndex + 1].name} unlocked!`, { size: 15 }));
    else if (!podium) lines.push('Top 3 unlocks the next track. Drift the bends for turbos!');
    const standings = [...race.karts]
      .sort((a, b) => a.place - b.place)
      .map((k) => [`${k.place}. ${k.index === 0 ? 'YOU' : RIVALS[k.index - 1]}`, k.finished ? clock(k.finished) : '—', k.index === 0]);
    const next = TRACKS[trackIndex + 1];
    const choices = [];
    if (next && progress.unlocked > trackIndex + 1) choices.push([withIcon(ChevronRight, `Next: ${next.name}`, { after: true }), () => void pick(trackIndex + 1), podium]);
    choices.push(['Race again', start, !podium || !next]);
    choices.push(['All tracks', menu]);
    hud.showResults(title, lines, standings, choices);
    onSound?.(you.place <= 3 ? 'win' : 'lose');
  }

  function react(event) {
    if (event.type === 'count') onSound?.('race-count');
    else if (event.type === 'go') onSound?.('go');
    if (event.kart !== you) return;
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
        onSound?.('bump');
        break;
      case 'lap':
        if (event.lap === race.laps - 1) hud.pop('FINAL LAP!', '#ffd84a');
        onSound?.('lap');
        break;
      case 'finish':
        onSound?.('lap');
        break;
      default:
    }
  }

  /** Karts 0 and 1 are the two players online; the rest are the computer rivals. */
  const nameOf = (index) => (online ? (index < 2 ? online.names[index] : RIVALS[index - 2]) : RIVALS[index - 1]);

  /** One step with every kart's input; true once the race is over. */
  function stepOnce(inputs) {
    if (stage !== 'race') return true;
    stepRace(race, inputs);
    race.events.forEach(react);
    if (race.phase === 'finished' && !done && race.t >= FINISH_HOLD) {
      done = true;
      if (online) resultsOnline();
      else results();
      return true;
    }
    return false;
  }

  async function startOnline() {
    lock?.dispose();
    lock = undefined;
    stage = 'menu';
    wants[0] = false;
    wants[1] = false;
    trackIndex = (online.seed + rounds) % TRACKS.length;
    const track = TRACKS[trackIndex];
    race = createRace(track, 4, 2);
    await view.build(race, 7 + trackIndex);
    const roundSeed = (online.seed + rounds * 7919) >>> 0;
    drivers = race.karts.map((_, i) => (i < 2 ? null : createRacingCpu({ pace: track.pace * [1, 1.02][i - 2], drift: 0.45 + 0.15 * i, lane: [-2.5, 2.5][i - 2], seed: roundSeed + i })));
    done = false;
    lock = createLockstep({
      net: online.net,
      side: you,
      step: ([a, b]) => stepOnce([a, b, drivers[2].think(race, 2), drivers[3].think(race, 3)]),
      hash: () => hashNumbers(race.karts.flatMap((k) => [k.x, k.z, k.speed])),
      onDesync: (step) => console.error('racing desync at step', step),
    });
    hud.closeMenu();
    hud.pop(`vs ${online.names[1 - you]} · ${track.name}`, '#ffd84a');
    setPad(true);
    stage = 'race';
  }

  function resultsOnline() {
    stage = 'menu';
    setPad(false);
    engine?.set(0, false);
    const me = race.karts[you];
    const them = online.names[1 - you];
    const won = me.place < race.karts[1 - you].place;
    const title = me.place === 1 ? withIcon(Trophy, '1st PLACE!', { size: 30 }) : `${me.place}${['', 'st', 'nd', 'rd', 'th'][me.place]} place`;
    const standings = [...race.karts]
      .sort((a, b) => a.place - b.place)
      .map((k) => [`${k.place}. ${k.index === you ? 'YOU' : nameOf(k.index)}`, k.finished ? clock(k.finished) : '—', k.index === you]);
    rematchCard = (line) =>
      hud.showResults(title, [line], standings, [
        [wants[you] ? `Waiting for ${them}…` : withIcon(ChevronRight, `Rematch: ${TRACKS[(online.seed + rounds + 1) % TRACKS.length].name}`, { after: true }), requestRematch, true],
        ['Back to the arcade', () => online.exit?.()],
      ]);
    rematchCard(won ? withIcon(Trophy, `You beat ${them}!`, { size: 15 }) : `${them} beat you - get them back`);
    onSound?.(won ? 'win' : 'lose');
  }

  function requestRematch() {
    if (wants[you]) return;
    wants[you] = true;
    online.net.send({ type: 'g-rematch' });
    if (wants[1 - you]) {
      rounds += 1;
      void startOnline();
    } else rematchCard?.('Rematch asked…');
  }

  if (online) {
    offs.push(
      online.net.on('g-rematch', () => {
        wants[1 - you] = true;
        if (wants[you]) {
          rounds += 1;
          void startOnline();
        } else if (stage === 'menu') rematchCard?.(`${online.names[1 - you]} wants a rematch!`);
      }),
    );
  }

  const ready = online ? view.ready.then(startOnline) : view.ready.then(() => pick(trackIndex)).then(menu);

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
        if (online) lock.advance(next.steps, controls.read());
        else {
          for (let i = 0; i < next.steps; i += 1) {
            if (stepOnce(race.karts.map((_, k) => (k === 0 ? controls.read() : drivers[k].think(race, k))))) break;
          }
        }
        const mine = race.karts[you];
        engine?.set(mine.speed / 26, mine.boost > 0);
      }
      view.update(race, Math.min(elapsed, STEP_MS * 5) / 1000, you);
      hud.update(race, you);
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
      lock?.dispose();
      offs.forEach((off) => off());
      engine?.stop();
      controls.dispose();
      hud.dispose();
    },
  };
}
