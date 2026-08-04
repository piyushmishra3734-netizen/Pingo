/**
 * The badge library, checked against its own design system.
 *
 * The reference sheet is the source of truth, and the things that keep a
 * library faithful to a sheet are not visible in a diff: that every badge still
 * has artwork, that nobody has quietly given a common badge a legendary XP
 * value, that rarity has not started leaking into the drawing. Those are the
 * assertions here.
 *
 * What this cannot check is whether the artwork looks like the reference. That
 * needs eyes on a screen.
 *
 * Run with `pnpm verify:badges`.
 */
import { BADGE_ART_IDS } from '../src/features/badges/BadgeArt.js';
import { METRIC_POLICY } from '../src/features/badges/metric-policy.js';
import {
  BADGES,
  BADGE_ACCENT,
  BADGE_BY_ID,
  MUTUAL_METRICS,
  XP_BY_RARITY,
  badgeXp,
  libraryFor,
  progressFor,
  type BadgeRarity,
} from '../src/features/badges/registry.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

console.log('— the sheet, complete —');

{
  // Twenty-four from the reference sheet, plus the four Real Life badges.
  check(BADGES.length === 28, `all twenty-eight badges are present (${BADGES.length})`);

  const ids = BADGES.map((b) => b.id);
  check(new Set(ids).size === ids.length, 'every id is unique');
  check(BADGE_BY_ID.size === BADGES.length, 'and the lookup covers all of them');

  const art = new Set(BADGE_ART_IDS);
  const missing = ids.filter((id) => !art.has(id as never));
  check(missing.length === 0, `every badge has artwork${missing.length ? `: missing ${missing.join(', ')}` : ''}`);

  const orphans = BADGE_ART_IDS.filter((id) => !BADGE_BY_ID.has(id));
  check(orphans.length === 0, `and no artwork is orphaned${orphans.length ? `: ${orphans.join(', ')}` : ''}`);
}

{
  // The nine categories the brief names, plus Real Life, and nothing else.
  const categories = new Set(BADGES.map((b) => b.category));
  check(categories.size === 10, `ten categories (${[...categories].sort().join(', ')})`);
  check(BADGES.filter((b) => b.category === 'stories').length === 5, 'five story badges');
  check(BADGES.filter((b) => b.category === 'friendship').length === 4, 'four friendship badges');
}

console.log('\n— XP follows rarity, always —');

{
  /*
   * Typed by hand, these drift: a badge gets promoted to epic and keeps its
   * rare reward, and the label under it says something the number does not.
   */
  const wrong = BADGES.filter((b) => b.xpReward !== XP_BY_RARITY[b.rarity]);
  check(wrong.length === 0, `no badge disagrees with its rarity${wrong.length ? `: ${wrong[0]!.id}` : ''}`);

  const order: BadgeRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
  const rising = order.every((r, i) => i === 0 || XP_BY_RARITY[r] > XP_BY_RARITY[order[i - 1]!]);
  check(rising, 'and rarer is always worth more');
}

{
  const unlocked = new Set(['first_message', 'around_together']);
  check(badgeXp(unlocked) === 25 + 400, `earned XP sums the badges held (${badgeXp(unlocked)})`);
  check(badgeXp(new Set(['not_a_badge'])) === 0, 'and an unknown id is worth nothing rather than NaN');
}

console.log('\n— rarity never touches the drawing —');

{
  /*
   * The rule the brief is most emphatic about. If fill or shape could be
   * predicted from rarity, then rarity would be redesigning the badge — so the
   * check is that they are *not* correlated: every rarity contains more than
   * one fill, or the library is too small for the question to mean anything.
   */
  const byRarity = new Map<BadgeRarity, Set<string>>();
  for (const b of BADGES) {
    const set = byRarity.get(b.rarity) ?? new Set<string>();
    set.add(b.fill);
    byRarity.set(b.rarity, set);
  }

  const rare = byRarity.get('rare')!;
  check(rare.size === 2, 'rare badges come in both fills, so fill is not a rarity signal');

  const commons = BADGES.filter((b) => b.rarity === 'common');
  check(
    new Set(commons.map((b) => b.shape)).size === 2,
    'and common badges use both shapes, so shape is not one either',
  );
}

console.log('\n— the muted palette holds —');

{
  const palette = new Set<string>(Object.values(BADGE_ACCENT));
  const accented = BADGES.filter((b) => b.accent);

  check(accented.length > 0 && accented.length < BADGES.length / 2, `most badges are monochrome (${accented.length} accented)`);
  check(
    accented.every((b) => palette.has(b.accent!)),
    'every accent comes from the sheet palette rather than being invented',
  );

  /*
   * Saturation is what separates "muted" from "neon", and it is checkable. A
   * fully saturated colour has one channel at 255 and another at 0; the sheet's
   * tones all sit well inside that.
   */
  for (const [name, hex] of Object.entries(BADGE_ACCENT)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    check(saturation < 0.75, `${name} is muted, not neon (saturation ${saturation.toFixed(2)})`);
  }
}

console.log('\n— progress —');

{
  const hundred = BADGE_BY_ID.get('hundred_messages')!;

  const none = progressFor(hundred, {});
  check(!none.unlocked && none.fraction === 0, 'a metric never recorded reads as zero, not as NaN');

  const part = progressFor(hundred, { messagesSent: 34 });
  check(!part.unlocked && Math.abs(part.fraction - 0.34) < 0.001, `partway is a real fraction (${part.fraction})`);

  const exact = progressFor(hundred, { messagesSent: 100 });
  check(exact.unlocked && exact.fraction === 1, 'hitting the threshold unlocks it');

  /*
   * Someone with four hundred messages must not see a bar four times too long,
   * and `fraction` is handed straight to a CSS width — so it is clamped here
   * rather than guarded at every call site.
   */
  const over = progressFor(hundred, { messagesSent: 400 });
  check(over.unlocked && over.fraction === 1, 'and going well past it does not overflow the bar');
  check(over.value === 100, 'the shown value is clamped too');
}

console.log('\n— the grid —');

{
  const all = libraryFor({});
  check(all.length === BADGES.length, 'a brand-new account still sees the whole collection');
  check(all.every((e) => !e.unlocked), 'with nothing unlocked');

  const some = libraryFor({ messagesSent: 100, friends: 1 });
  const unlockedIds = some.filter((e) => e.unlocked).map((e) => e.badge.id);
  check(unlockedIds.includes('hundred_messages'), 'metrics unlock what they should');
  check(unlockedIds.includes('first_friend'), 'across categories');
  check(!unlockedIds.includes('best_circle'), 'and not what they should not');

  /*
   * An explicit unlock has to win over the metric. A badge earned last year is
   * still earned after a device is wiped and the counters restart at zero.
   */
  const granted = libraryFor({}, new Set(['around_together']));
  check(
    granted.find((e) => e.badge.id === 'around_together')?.unlocked === true,
    'a recorded unlock survives a counter that no longer remembers why',
  );
}

console.log('\n— the words —');

{
  check(
    BADGES.every((b) => b.description.trim().length > 0 && b.description.endsWith('.')),
    'every badge says what it is for, as a sentence',
  );
  check(
    BADGES.every((b) => b.unlockCondition.progressLabel.trim().length > 0),
    'and every one can describe its own progress in the user’s words',
  );
  check(
    BADGES.every((b) => !/\bXP\b|\bunlock/i.test(b.description)),
    'without the description explaining the mechanic back at them',
  );
}

console.log('\n— every metric answers the gate question —');

{
  /*
   * The rule: "does this represent a meaningful human interaction?" — and if
   * not, it does not contribute to Journey. These checks are what stop that
   * from being a sentence in a document that nobody re-reads before adding a
   * counter.
   */
  const used = new Set(BADGES.map((b) => b.unlockCondition.metric));
  const policied = Object.keys(METRIC_POLICY) as (keyof typeof METRIC_POLICY)[];

  const unjudged = [...used].filter((m) => !METRIC_POLICY[m]);
  check(
    unjudged.length === 0,
    `every metric a badge watches has been through the rule${unjudged.length ? `: ${unjudged.join(', ')}` : ''}`,
  );

  const orphaned = policied.filter((m) => !used.has(m));
  check(orphaned.length === 0, `and no policy describes a metric nothing uses${orphaned.length ? `: ${orphaned.join(', ')}` : ''}`);

  /*
   * Never reward spam, never reward repetition: an entry with no ceiling is a
   * raw tally, and an entry with no exclusion has not been thought about.
   */
  const uncapped = policied.filter((m) => METRIC_POLICY[m].ceiling.trim().length === 0);
  check(uncapped.length === 0, `every metric names a ceiling${uncapped.length ? `: ${uncapped.join(', ')}` : ''}`);

  const unbounded = policied.filter((m) => METRIC_POLICY[m].excludes.length === 0);
  check(unbounded.length === 0, `and names what does not count${unbounded.length ? `: ${unbounded.join(', ')}` : ''}`);

  /*
   * Never reward inactivity. There must be no metric that goes up for being
   * present — a streak, a login, a day, time in the app.
   */
  const passive = policied.filter((m) => /\b(streak|login|logged in|days? active|time in app|opened the app)\b/i.test(
    `${m} ${METRIC_POLICY[m].counts}`,
  ));
  check(passive.length === 0, `nothing counts merely being present${passive.length ? `: ${passive.join(', ')}` : ''}`);

  // The gate itself: answered "no" means it cannot be behind a badge.
  const rejected = policied.filter((m) => !METRIC_POLICY[m].contributes);
  check(
    rejected.every((m) => !used.has(m)),
    'a metric the rule rejected is behind no badge',
  );

  /*
   * Real life cannot be self-awarded. A badge for meeting someone that one
   * person can tap on their own is worth nothing the moment anybody notices.
   */
  const realLife = BADGES.filter((b) => b.category === 'realLife');
  check(realLife.length === 4, `four real-life badges (${realLife.length})`);
  check(
    realLife.every((b) => MUTUAL_METRICS.has(b.unlockCondition.metric)),
    'and every one of them needs the other person to confirm it',
  );
  check(
    [...MUTUAL_METRICS].every((m) => METRIC_POLICY[m]?.mutual === true),
    'the policy agrees with the registry about which metrics are mutual',
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
