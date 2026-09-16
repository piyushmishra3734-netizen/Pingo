/**
 * The ladder: five opponents, each a personality you learn and then beat -
 * Punch-Out's roster in miniature. Beating one unlocks the next; the
 * progress and a daily win streak live on this device.
 *
 * `style` overrides the computer's numbers (see cpu.js LEVELS).
 */

/** You, in the shorts; every opponent wears something else. */
export const PLAYER_LOOK = 'beach';

export const ROSTER = [
  {
    name: 'Chintu',
    nick: 'The Rookie',
    look: 'casual',
    level: 'easy',
    style: {},
    tip: 'A glowing glove is a power punch coming. Jab first.',
  },
  {
    name: 'Bruno',
    nick: 'Big Swing',
    look: 'worker',
    level: 'easy',
    style: { aggression: 0.55, power: 0.7, defend: 0.25, think: 20 },
    tip: 'He swings big. Slip the glow, hit back, earn a ★.',
  },
  {
    name: 'Slick Sam',
    nick: "Can't Touch This",
    look: 'suit',
    level: 'normal',
    style: { defend: 0.85, slip: 0.85, aggression: 0.3 },
    tip: 'He slips power punches. Stick to fast jabs.',
  },
  {
    name: 'Viper',
    nick: 'Fast Hands',
    look: 'punk',
    level: 'normal',
    style: { aggression: 0.62, power: 0.2, think: 10, react: 8 },
    tip: 'Quick jabs. Block, then punish the gap.',
  },
  {
    name: 'Sultan',
    nick: 'The Champ',
    look: 'casual2',
    level: 'hard',
    style: { star: 0.1 },
    tip: 'Everything at once. Save your ★ for when he whiffs.',
  },
];

const KEY = 'pingo-boxing-v1';
const day = (date) => date.toISOString().slice(0, 10);

export function loadProgress() {
  const fresh = { beaten: 0, wins: 0, streak: 0, last: '' };
  try {
    return { ...fresh, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return fresh;
  }
}

/** A win against ladder spot `index`: unlocks the next, keeps the daily streak. */
export function recordWin(progress, index, now = new Date()) {
  progress.beaten = Math.max(progress.beaten, index + 1);
  progress.wins += 1;
  const today = day(now);
  if (progress.last !== today) {
    const yesterday = day(new Date(now.getTime() - 86_400_000));
    progress.streak = progress.last === yesterday ? progress.streak + 1 : 1;
    progress.last = today;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* private window: progress lasts this visit */
  }
  return progress;
}
