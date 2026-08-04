/**
 * Profile → Journey.
 *
 * The badge collection, and for now the whole of Journey. Missions, Pulse and
 * friendship levels join it later; the screen is laid out so they can arrive as
 * sections above the collection without the collection moving.
 *
 * ## Grouped by rarity, not by category
 *
 * The category chips already answer "show me the story ones". Sorting the grid
 * by category as well would mean the same organising idea twice and no answer to
 * the question people actually bring to a collection, which is *what is rare*.
 * Rarity sections give the page a shape: a wide common row at the top narrowing
 * to one or two mythics at the bottom.
 *
 * ## Locked badges are not hidden behind a filter
 *
 * There is no "earned only" toggle, deliberately. The set is the feature, and a
 * control that lets someone hide two-thirds of it is a control that turns a
 * collection into a scoreboard.
 */
import { Chip, TextField, cn } from '@pingo/ui';
import { useMemo, useState } from 'react';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { Badge } from '../features/badges/Badge.js';
import { BadgeDetailSheet } from '../features/badges/BadgeDetailSheet.js';
import { DUMMY_METRICS, DUMMY_UNLOCKED_AT } from '../features/badges/dummy-progress.js';
import { buildChapters, onThisDay } from '../features/journey/chapters.js';
import {
  DUMMY_ENCOURAGEMENT,
  DUMMY_JOINED_AT,
  DUMMY_LEVEL,
  DUMMY_MISSIONS,
  DUMMY_PERSONAL_MOMENTS,
  DUMMY_PULSE,
  STATISTIC_PLACEHOLDERS,
} from '../features/journey/dummy-journey.js';
import { LifeChapters, OnThisDay } from '../features/journey/LifeChapters.js';
import {
  JourneyOverview,
  Pulse,
  RecentUnlocks,
  SectionHeading,
  StatisticsPlaceholder,
  TodaysMissions,
} from '../features/journey/sections.js';
import {
  libraryFor,
  type BadgeCategory,
  type BadgeProgress,
  type BadgeRarity,
} from '../features/badges/registry.js';

/** Sheet order, so the sections read common-first the way a collection does. */
const RARITY_ORDER: BadgeRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];

const RARITY_TITLE: Record<BadgeRarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
};

const CATEGORIES: Array<{ id: BadgeCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'calls', label: 'Calls' },
  { id: 'camera', label: 'Camera' },
  { id: 'stories', label: 'Stories' },
  { id: 'friendship', label: 'Friendship' },
  { id: 'ai', label: 'AI' },
  { id: 'learning', label: 'Learning' },
  { id: 'goals', label: 'Goals' },
  { id: 'realLife', label: 'Real Life' },
];

export function JourneyScreen() {
  const [category, setCategory] = useState<BadgeCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<BadgeProgress | undefined>();

  /*
   * The whole library is computed once and filtered from there, so the counts on
   * the chips describe the collection rather than the current search — a chip
   * whose number changed as you typed would be describing the filter to itself.
   */
  const library = useMemo(() => libraryFor(DUMMY_METRICS), []);

  const earned = library.filter((e) => e.unlocked);
  const xp = earned.reduce((sum, e) => sum + e.badge.xpReward, 0);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.filter((entry) => {
      if (category !== 'all' && entry.badge.category !== category) return false;
      if (!needle) return true;
      // Title and description both, because people search for what a badge is
      // for at least as often as for what it is called.
      return (
        entry.badge.title.toLowerCase().includes(needle) ||
        entry.badge.description.toLowerCase().includes(needle)
      );
    });
  }, [library, category, query]);

  /*
   * Newest first, and only a handful. The row is a reminder of what just
   * happened, not a second way to browse the collection that sits below it.
   */
  const recent = useMemo(
    () =>
      earned
        .filter((e) => DUMMY_UNLOCKED_AT[e.badge.id] !== undefined)
        .sort((a, b) => (DUMMY_UNLOCKED_AT[b.badge.id] ?? 0) - (DUMMY_UNLOCKED_AT[a.badge.id] ?? 0))
        .slice(0, 6),
    [earned],
  );

  /*
   * Built from the unlock dates rather than stored, so the timeline cannot
   * disagree with the badges above it.
   */
  const chapters = useMemo(
    () =>
      buildChapters({
        joinedAt: DUMMY_JOINED_AT,
        unlockedAt: DUMMY_UNLOCKED_AT,
        personal: DUMMY_PERSONAL_MOMENTS,
      }),
    [],
  );

  /*
   * Read from the chapters rather than from the raw data, so a moment that was
   * dropped as impossible — dated before the account existed — cannot come back
   * as a memory.
   */
  const recollections = useMemo(() => onThisDay(chapters.flatMap((c) => c.moments)), [chapters]);

  const sections = RARITY_ORDER.map((rarity) => ({
    rarity,
    entries: visible.filter((e) => e.badge.rarity === rarity),
  })).filter((section) => section.entries.length > 0);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <ScreenHeader title="Journey" showBack />

      {/*
        The dock floats over the page, so the last rarity section needs room to
        clear it — otherwise the rarest badges, which are the ones worth
        scrolling for, sit underneath the tab bar.
      */}
      <div className="mx-auto w-full max-w-2xl flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <JourneyOverview level={DUMMY_LEVEL} encouragement={DUMMY_ENCOURAGEMENT} />

        <TodaysMissions missions={DUMMY_MISSIONS} />

        <Pulse entries={DUMMY_PULSE} />

        <RecentUnlocks entries={recent} unlockedAt={DUMMY_UNLOCKED_AT} onOpen={setOpen} />

        {/*
          The story, directly under the last few badges.

          It could have gone at the bottom, after the collection — but the
          collection is twenty-eight badges tall, and a section nobody scrolls
          to is a section nobody has. Following "recently earned" also reads in
          one movement: here is the last of it, and here is all of it.
        */}
        {/*
          Above the timeline, because it is about today. It renders nothing on
          a day with nothing to remember, which is most days — and that absence
          is the feature working, not failing.
        */}
        <OnThisDay recollections={recollections} />

        <LifeChapters chapters={chapters} />

        {/*
          The collection's own heading, so the search and chips below it clearly
          belong to it rather than to the page. Everything above is today; this
          is everything.
        */}
        <SectionHeading
          title="Badges"
          action={
            <span className="text-caption text-text-tertiary">
              {earned.length}/{library.length}
            </span>
          }
        />

        <div className="px-4">
          <TextField
            shape="pill"
            type="search"
            value={query}
            placeholder="Search badges"
            aria-label="Search badges"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {/*
          Horizontally scrolled rather than wrapped. Ten chips wrapped to three
          rows would push the collection itself below the fold on a phone, and
          the collection is what the screen is for.
        */}
        <nav
          aria-label="Filter badges by category"
          className="scrollbar-none mt-3 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {CATEGORIES.map((option) => (
            <Chip
              key={option.id}
              selected={category === option.id}
              className="shrink-0"
              onClick={() => setCategory(option.id)}
              count={
                option.id === 'all'
                  ? undefined
                  : library.filter((e) => e.badge.category === option.id).length
              }
            >
              {option.label}
            </Chip>
          ))}
        </nav>

        {sections.length === 0 ? (
          <p className="px-4 pt-10 text-center text-body text-text-secondary">
            No badges match “{query.trim()}”.
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.rarity} className="px-4 pt-7">
              <header className="flex items-baseline justify-between pb-4">
                <h3 className="text-caption uppercase tracking-wide text-text-tertiary">
                  {RARITY_TITLE[section.rarity]}
                </h3>
                <span className="text-caption text-text-tertiary">
                  {section.entries.filter((e) => e.unlocked).length}/{section.entries.length}
                </span>
              </header>

              {/*
                Four across on a phone, six on a tablet. Five would fit and would
                turn each badge into an icon; the sheet is drawn to be looked at,
                so it is given the room.
              */}
              <ul className="grid grid-cols-4 gap-x-3 gap-y-6 sm:grid-cols-6">
                {section.entries.map((entry) => (
                  <li key={entry.badge.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(entry)}
                      aria-label={`${entry.badge.title}. ${entry.unlocked ? 'Earned' : 'Locked'}.`}
                      className={cn(
                        'flex w-full flex-col items-center gap-2 rounded-xl py-1 text-center',
                        'transition-transform duration-instant ease-standard',
                        'active:scale-[0.96] motion-reduce:active:scale-100',
                      )}
                    >
                      <Badge badge={entry.badge} unlocked={entry.unlocked} size={64} />
                      <span
                        className={cn(
                          'line-clamp-2 text-caption leading-tight',
                          entry.unlocked ? 'text-text-primary' : 'text-text-tertiary',
                        )}
                      >
                        {entry.badge.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <StatisticsPlaceholder items={STATISTIC_PLACEHOLDERS} />
      </div>

      {open ? (
        <BadgeDetailSheet
          entry={open}
          unlockedAt={DUMMY_UNLOCKED_AT[open.badge.id]}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </div>
  );
}
