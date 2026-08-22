/**
 * The achievement registry, which every surface now trusts.
 *
 * Six places draw a badge - a chat row, a message header, two kinds of user
 * card, a profile and a cabinet - and none of them knows which badge it is
 * looking at. They ask the registry: which one leads, and does this account
 * have anything rare. If those two answers are wrong, every one of those
 * surfaces is wrong in the same silent way: it renders something plausible.
 *
 * So this checks the answers, and it checks the property the whole design rests
 * on - that a second achievement can be added without touching any of them.
 *
 * Run with `pnpm verify:achievements`.
 */
import {
  ACHIEVEMENTS,
  CABINET_SLOTS,
  achievementById,
  hasTier,
  leadAchievement,
  type Achievement,
} from '../src/features/achievements/registry.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('\n--- the registry itself ---');

check(ACHIEVEMENTS.length > 0, 'there is at least one achievement');
check(
  new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length,
  'ids are unique',
);
check(
  ACHIEVEMENTS.every((a) => a.art.emblem.startsWith('/') && a.art.crest.startsWith('/')),
  'every achievement has both artworks',
);
check(
  ACHIEVEMENTS.every((a) => a.art.emblem !== a.art.crest),
  'the crest is a different file from the emblem',
);
check(
  ACHIEVEMENTS.every((a) => !/refer|invite|friend/i.test(a.blurb)),
  'no blurb explains how it was earned - that belongs to the mission',
);
check(CABINET_SLOTS >= ACHIEVEMENTS.length, 'the cabinet has room for what exists');

console.log('\n--- an account with nothing ---');

check(leadAchievement([]) === undefined, 'nothing leads');
check(hasTier([], 'mythic') === false, 'no rare tier');
check(hasTier(['not_a_badge'], 'mythic') === false, 'an unknown id grants nothing');

console.log('\n--- an account with the rare badge ---');

const mythic = ACHIEVEMENTS.find((a) => a.tier === 'mythic');
check(!!mythic, 'a mythic achievement exists to test with');

if (mythic) {
  check(leadAchievement([mythic.id])?.id === mythic.id, 'it leads');
  check(hasTier([mythic.id], 'mythic'), 'it grants the rare tier');
  check(achievementById(mythic.id)?.title === mythic.title, 'it resolves by id');
}

console.log('\n--- the property the whole design rests on ---');

/*
 * A second achievement, added the way a real one would be. Nothing in the UI is
 * touched: if these pass, a new badge already renders beside names, in the
 * cabinet and on a profile.
 */
const future: Achievement = {
  id: 'future_badge',
  title: 'FUTURE',
  blurb: 'A rare PINGO achievement.',
  tier: 'standard',
  art: { emblem: '/badges/x-512.png', crest: '/badges/x-48.png' },
};
ACHIEVEMENTS.push(future);

check(achievementById('future_badge')?.title === 'FUTURE', 'a new entry resolves with no UI change');
check(
  hasTier(['future_badge'], 'mythic') === false,
  'a standard badge does NOT hand somebody the rare layer',
);
check(leadAchievement(['future_badge'])?.id === 'future_badge', 'it leads when it is all there is');

if (mythic) {
  check(
    leadAchievement(['future_badge', mythic.id])?.id === mythic.id,
    'rare leads over standard, whatever order they arrive in',
  );
  check(
    leadAchievement([mythic.id, 'future_badge'])?.id === mythic.id,
    'and in the other order too',
  );
  check(hasTier(['future_badge', mythic.id], 'mythic'), 'the rare tier survives company');
}

ACHIEVEMENTS.pop();
check(ACHIEVEMENTS.length === 1, 'the fixture is cleaned up');

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
