import { startLoop } from '../../audio/sfx.js';
import { createControls } from '../controls.js';
import { createLockstep, hashNumbers } from '../lockstep.js';
import { stepsFor, STEP_MS } from '../game-host.js';
import { createBoxingCpu } from './cpu.js';
import { createHud } from './hud.js';
import { IN, REMATCH_AFTER, createMatch, stepMatch } from './match.js';
import { PLAYER_LOOK, ROSTER, loadProgress, recordWin } from './roster.js';
import { createBoxingScene } from './scene.js';

/**
 * Boxing against the computer, full screen in 3D: pick an opponent off the
 * ladder, learn their tell, beat them, unlock the next.
 *
 * The match runs in fixed 1/60 s steps from two bytes of input - yours and
 * the computer's - exactly as it will run between two phones. The scene only
 * draws what the match says. Unlike the 2D games this one draws with the
 * arcade's own renderer, full screen, while the arcade itself is paused.
 *
 * @param {{ renderer: import('three').WebGLRenderer, onSound?: (name: string) => void, seed?: number }} options
 */

const KEYS = {
  ArrowLeft: IN.LEFT,
  KeyA: IN.LEFT,
  ArrowRight: IN.RIGHT,
  KeyD: IN.RIGHT,
  KeyJ: IN.JAB,
  KeyZ: IN.JAB,
  KeyK: IN.POWER,
  KeyX: IN.POWER,
  KeyL: IN.BLOCK,
  ShiftLeft: IN.BLOCK,
  KeyS: IN.DODGE,
  ArrowDown: IN.DODGE,
  Space: IN.DODGE,
  KeyI: IN.STAR,
  KeyC: IN.STAR,
  ArrowUp: IN.STAR,
};

const PAD = [
  [
    { label: '◀', bit: IN.LEFT, name: 'Step left' },
    { label: '▶', bit: IN.RIGHT, name: 'Step right' },
  ],
  [
    { label: 'SLIP', bit: IN.DODGE, name: 'Slip', small: true },
    { label: 'BLOCK', bit: IN.BLOCK, name: 'Block', small: true },
    { label: '★', bit: IN.STAR, name: 'Star punch', small: true },
    { label: 'JAB', bit: IN.JAB, name: 'Jab' },
    { label: 'POW', bit: IN.POWER, name: 'Power punch', raised: true },
  ],
];

const SOUNDS = {
  hit: (e) => (e.punch === 'star' ? 'star-hit' : e.punch === 'power' || e.counter ? 'hit-heavy' : 'hit'),
  block: () => 'block',
  ko: () => 'ko',
  down: () => 'down',
  count: () => 'count',
  rise: () => 'cheer',
  star: () => 'star',
  fight: () => 'fight',
};

/**
 * `online`, for a match against a friend: which boxer you are (0 red, 1 blue),
 * the shared seed, the link, both names, and how to leave.
 */
export function createBoxing({ renderer, onSound, seed = 1, online }) {
  const view = createBoxingScene();
  const hud = createHud();
  const controls = createControls({ keys: KEYS, pad: PAD });
  const progress = loadProgress();
  let match = createMatch();
  let cpu;
  let foe = Math.min(progress.beaten, ROSTER.length - 1);
  /** 'menu' while a card is up, 'fight' while the match runs. */
  let stage = 'menu';
  let ended = false;
  /** The crowd round the ring, while a fight is on. */
  let crowd = () => {};

  let last = 0;
  let accumulator = 0;
  let size = { width: innerWidth, height: innerHeight };
  /** Which boxer is you. */
  const you = online?.side ?? 0;
  let lock;
  let rounds = 0;
  const wants = [false, false];
  const offs = [];

  const setPad = (on) => {
    const pad = document.querySelector('.pad');
    if (pad) pad.style.visibility = on ? '' : 'hidden';
  };

  function ladder() {
    stage = 'menu';
    setPad(false);
    hud.showLadder(ROSTER, progress, (index) => void pick(index));
  }

  async function pick(index) {
    foe = index;
    const entry = ROSTER[index];
    hud.setOpponent(entry.name);
    await view.setLooks([PLAYER_LOOK, entry.look]);
    match = createMatch();
    hud.showIntro(entry, index, start);
  }

  function start() {
    const entry = ROSTER[foe];
    seed = (seed * 1103515245 + 12345) >>> 0;
    cpu = createBoxingCpu({ level: entry.level, style: entry.style, seed });
    match = createMatch();
    ended = false;
    hud.closeMenu();
    setPad(true);
    crowd();
    crowd = startLoop('sounds/crowd-loop.mp3', 0.18);
    stage = 'fight';
  }

  function finish() {
    const entry = ROSTER[foe];
    const won = match.winner === 0;
    crowd();
    setPad(false);
    stage = 'menu';
    if (won) {
      const first = progress.beaten <= foe;
      recordWin(progress, foe);
      onSound?.('win');
      const next = ROSTER[foe + 1];
      if (next) {
        hud.showEnd('YOU WIN! 🏆', first ? `${next.name} “${next.nick}” unlocked` : `🔥 ${progress.streak}-day streak`, [
          [`Next: ${next.name} ▶`, () => void pick(foe + 1), true],
          ['Rematch', start],
          ['All opponents', ladder],
        ]);
      } else {
        hud.showEnd('🏆 CHAMPION!', `You beat ${entry.name}. Come back tomorrow to keep the 🔥 ${progress.streak}-day streak.`, [
          ['Rematch', start, true],
          ['All opponents', ladder],
        ]);
      }
    } else {
      onSound?.('lose');
      hud.showEnd(match.winner === null ? 'DRAW' : `${entry.name.toUpperCase()} WINS`, `💡 ${entry.tip}`, [
        ['Rematch', start, true],
        ['All opponents', ladder],
      ]);
    }
  }

  /** Words where the punches land: damage, COUNTER!, combos, stars. */
  function show(event) {
    const { width, height } = size;
    if (event.type === 'hit') {
      const at = view.headOnScreen(event.boxer, width, height);
      hud.pop(String(event.damage), at.x, at.y, event.punch === 'jab' ? '' : 'big');
      if (event.punch === 'star') hud.pop('★ STAR PUNCH!', width / 2, height * 0.3, 'big');
      else if (event.counter) hud.pop('COUNTER!', at.x, at.y - 40, 'big');
      if (event.combo >= 3) hud.pop(`${event.combo} HIT COMBO`, width / 2, height * 0.24, 'combo');
    } else if (event.type === 'star') {
      const at = view.headOnScreen(event.boxer, width, height);
      hud.pop('+★', at.x, at.y - 30, 'star');
    } else if (event.type === 'whiff' && event.dodged) {
      const at = view.headOnScreen(1 - event.boxer, width, height);
      hud.pop('SLIPPED!', at.x, at.y - 10, 'combo');
    }
  }

  /** One step of the match with both inputs; true when the match has ended. */
  function stepOnce(inputs) {
    if (stage !== 'fight') return true;
    stepMatch(match, inputs);
    for (const event of match.events) {
      view.onEvent(event, match);
      show(event);
      const sound = SOUNDS[event.type]?.(event);
      if (sound) onSound?.(sound);
    }
    if (match.phase === 'over' && !ended) {
      ended = true;
      onSound?.('bell');
    }
    if (ended && match.t >= REMATCH_AFTER * 0.6) {
      if (online) finishOnline();
      else finish();
      return true;
    }
    return false;
  }

  function startOnline() {
    lock?.dispose();
    match = createMatch();
    ended = false;
    wants[0] = false;
    wants[1] = false;
    lock = createLockstep({
      net: online.net,
      side: you,
      step: (inputs) => stepOnce(inputs),
      hash: () => hashNumbers(match.boxers.flatMap((b) => [b.x, b.health, b.stamina, b.t])),
      onDesync: (step) => console.error('boxing desync at step', step),
    });
    hud.closeMenu();
    setPad(true);
    crowd();
    crowd = startLoop('sounds/crowd-loop.mp3', 0.18);
    stage = 'fight';
  }

  function finishOnline() {
    crowd();
    setPad(false);
    stage = 'menu';
    const won = match.winner === you;
    onSound?.(won ? 'win' : match.winner === null ? 'bell' : 'lose');
    const them = online.names[1 - you];
    const card = (line) =>
      hud.showEnd(match.winner === null ? 'DRAW' : won ? 'YOU WIN! 🏆' : `${them.toUpperCase()} WINS`, line, [
        [wants[you] ? `Waiting for ${them}…` : 'Rematch', requestRematch, true],
        ['Back to the arcade', () => online.exit?.()],
      ]);
    rematchCard = card;
    card(won ? `You knocked out ${them}!` : `Ask ${them} for a rematch`);
  }

  let rematchCard;
  function requestRematch() {
    if (wants[you]) return;
    wants[you] = true;
    online.net.send({ type: 'g-rematch' });
    maybeRematch();
    if (!wants[1 - you]) rematchCard?.('Rematch asked…');
  }

  function maybeRematch() {
    if (!wants[0] || !wants[1]) return;
    rounds += 1;
    startOnline();
  }

  if (online) {
    offs.push(
      online.net.on('g-rematch', () => {
        wants[1 - you] = true;
        if (!wants[you] && stage === 'menu') rematchCard?.(`${online.names[1 - you]} wants a rematch!`);
        maybeRematch();
      }),
    );
  }

  const ready = online
    ? view.setLooks(['beach', 'punk']).then(() => {
        hud.setNames(online.names[0], online.names[1]);
        startOnline();
      })
    : view.setLooks([PLAYER_LOOK, ROSTER[foe].look]).then(() => {
        hud.setOpponent(ROSTER[foe].name);
        ladder();
      });

  return {
    is3d: true,
    ready,
    get match() {
      return match;
    },
    /** For the probes: jump straight into a fight with ladder spot `index`. */
    async debugFight(index = 0) {
      await pick(index);
      start();
    },

    /** One display frame: catch the match up, then draw it. */
    frame(now) {
      if (!last) last = now;
      const elapsed = now - last;
      last = now;
      const next = stepsFor(accumulator, elapsed);
      accumulator = next.accumulator;
      const steps = stage !== 'fight' || window.__boxing?.freeze ? 0 : next.steps;
      if (online) {
        if (stage === 'fight') lock.advance(steps, controls.read());
      } else {
        for (let i = 0; i < steps; i += 1) {
          if (stepOnce([controls.read(), cpu.think(match, 1)])) break;
        }
      }
      view.update(match, Math.min(elapsed, STEP_MS * 5) / 1000);
      hud.update(match, match.boxers[you].state === 'down', you);
      renderer.render(view.scene, view.camera);
    },

    /** After a pause (a hidden tab) the clock restarts rather than leaping. */
    resume() {
      last = 0;
      accumulator = 0;
    },

    resize(width, height) {
      size = { width, height };
      view.resize(width, height);
    },

    dispose() {
      crowd();
      lock?.dispose();
      offs.forEach((off) => off());
      controls.dispose();
      hud.dispose();
    },
  };
}
