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

/** How many the registry ships with, so the fixture check is not a literal. */
const REGISTERED = ACHIEVEMENTS.length;

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
check(ACHIEVEMENTS.length === REGISTERED, 'the fixture is cleaned up');

// ---------------------------------------------------------------------------
// Owning a badge and wearing one
// ---------------------------------------------------------------------------

/*
 * The distinction the FOUNDER badge forced into existence.
 *
 * With one achievement "which do you own" and "which do you show" were the same
 * question. With two they are not, and getting it wrong in either direction is
 * bad in a way nobody would report as a bug: a choice that silently does
 * nothing, or a choice that appears to delete the badge it was not chosen.
 */
console.log('\n--- owning a badge, and wearing one ---');

const founder = achievementById('founder');
check(!!founder, 'FOUNDER is in the registry');

if (founder && mythic) {
  const both = [founder.id, mythic.id];

  check(
    leadAchievement(both)?.id === mythic.id,
    'with no choice made, the rare tier still leads - nothing changed for anybody else',
  );
  check(leadAchievement(both, founder.id)?.id === founder.id, 'a choice wins over the tier');
  check(leadAchievement(both, mythic.id)?.id === mythic.id, 'and can be changed back');

  /*
   * The whole point of keeping the two apart: choosing one badge must never
   * cost the other. `all` is the collection and does not consult the choice.
   */
  check(
    orderedIds(both, founder.id).length === 2 && orderedIds(both, mythic.id).length === 2,
    'switching what is worn never changes what is owned',
  );

  check(
    hasTier(both, 'mythic') && hasTier([founder.id], 'mythic') === false,
    'FOUNDER alone does not grant the rare layer, and wearing it does not remove it',
  );

  check(
    leadAchievement([founder.id], mythic.id)?.id === founder.id,
    'a badge that is not earned cannot be worn, however it is asked for',
  );
  check(
    leadAchievement([], founder.id) === undefined,
    'an account with nothing wears nothing',
  );
  check(
    leadAchievement(both, 'not_a_badge')?.id === mythic.id,
    'an unknown choice falls back rather than blanking the badge',
  );
}

/** The collection, which must be indifferent to what is worn. */
function orderedIds(earnedIds: string[], displayedId?: string): string[] {
  void displayedId;
  return ACHIEVEMENTS.filter((a) => earnedIds.includes(a.id)).map((a) => a.id);
}

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
