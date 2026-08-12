/**
 * The Journey sections above the badge collection.
 *
 * ## A timeline, not a cabinet
 *
 * The brief for this screen is that it should read as "I have grown", not "I
 * collected items", and that difference is mostly hierarchy. The level is
 * stated once and quietly; the missions are today's, so they are the only thing
 * with a call to action; Pulse is about people rather than counts. Nothing is
 * given a trophy frame, nothing is centred and enlarged, and no number is
 * repeated in two places to make the page feel fuller.
 *
 * Everything here is built from `Card`, `Chip` and the existing tokens — no new
 * visual language, which is also why there is no gauge, no ring and no medal.
 */
import { Card, cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import { Badge } from '../badges/Badge.js';
import type { BadgeProgress } from '../badges/registry.js';
import type { JourneyLevel, Mission, PulseEntry } from './dummy-journey.js';
import { moments } from './language.js';

/** A section heading, so the six sections cannot drift apart in weight. */
export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="flex items-baseline justify-between px-4 pb-3 pt-7">
      <h2 className="text-caption uppercase tracking-wide text-text-tertiary">{title}</h2>
      {action}
    </header>
  );
}

/**
 * Level, progress, and one sentence.
 *
 * Deliberately compact. A large level number with a ring around it is the
 * gaming UI the brief rules out, and it would also be the biggest thing on a
 * screen whose subject is the last three months rather than a score.
 */
export function JourneyOverview({
  level,
  encouragement,
  feeling,
  notice,
}: {
  level: JourneyLevel;
  encouragement: string;
  /** How the journey feels, in words. Never a percentage, never a rank. */
  feeling: string;
  /** What the system noticed today, if it noticed anything. */
  notice?: string;
}) {
  const fraction = level.xpForLevel <= 0 ? 1 : level.xpIntoLevel / level.xpForLevel;

  return (
    <section className="px-4 pt-5">
      <Card elevation="flat" className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-h2">Level {level.level}</p>
          <p className="text-caption text-text-tertiary">
            {moments(level.xpTotal)}
          </p>
        </div>

        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={level.xpForLevel}
          aria-valuenow={level.xpIntoLevel}
          aria-label={`Progress to level ${level.level + 1}`}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-slow ease-standard"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>

        {/*
          A feeling, not a countdown.

          This line used to read "175 moments to level 7" — a target, and the
          same mistake as the percentage that was removed from the strip: it
          tells somebody how much is missing rather than how things are going.
          A phrase says what is true about the week without implying there is a
          better phrase to reach.
        */}
        <p className="pt-2 text-caption text-text-secondary">{feeling}</p>

        {/*
          The one line on the screen that says something rather than counts
          something. It sits under the bar because it is a reflection on what
          the bar represents, not a caption for it.
        */}
        <p className="pt-3 text-body text-text-secondary">{encouragement}</p>

        {/*
          What the system noticed, when it noticed anything.

          Inside the same card rather than in a section of its own, and with no
          heading: a notice with a title above it is a feature announcing
          itself, and the whole idea is that nobody asked for this and nobody
          earned it. It is worth nothing, and that is why it is worth reading.
        */}
        {notice ? (
          <p className="mt-3 border-t border-line pt-3 text-body leading-snug text-text-primary text-balance">
            {notice}
          </p>
        ) : null}
      </Card>
    </section>
  );
}

/**
 * One mission.
 *
 * Reusable because daily and weekly missions are the same object with a
 * different reset — building two would guarantee they eventually looked
 * different for no reason.
 */
export function MissionCard({ mission }: { mission: Mission }) {
  const complete = mission.done >= mission.target;
  const fraction = mission.target <= 0 ? 1 : Math.min(1, mission.done / mission.target);

  return (
    /*
     * A column with the bar pinned to the bottom, so cards line up whatever
     * their titles do.
     *
     * Heights were uneven for two reasons at once: a long title wrapped to a
     * second line, and a completed card dropped its bar entirely. Fixing only
     * the wrapping would have left the completed card short. So the track is
     * always drawn — filled and tinted when done — and `mt-auto` holds it to the
     * bottom edge, which keeps every bar on the same line across the row.
     */
    <Card elevation="flat" className={cn('flex h-full flex-col p-3.5', complete && 'opacity-70')}>
      <div className="flex items-start gap-3">
        {/*
          A tick or an empty ring, at text size. A checkbox would invite a tap,
          and missions are completed by living rather than by pressing.
        */}
        <span
          aria-hidden
          className={cn(
            // `mt-0.5` sits it on the first line's baseline rather than centred
            // against a title that may be two lines tall.
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
            complete ? 'border-brand bg-brand text-on-brand' : 'border-line',
          )}
        >
          {complete ? (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>

        <p
          className={cn(
            'min-w-0 flex-1 text-body leading-snug text-balance',
            complete && 'line-through decoration-line',
          )}
        >
          {mission.title}
        </p>

        <p className="mt-0.5 shrink-0 text-caption tabular-nums text-text-tertiary">
          {mission.done}/{mission.target}
        </p>
      </div>

      {/*
        Always drawn, so a finished mission occupies the same shape as an
        unfinished one. Full and tinted rather than hidden — the card still has
        to say "done" once the tick has been taken in.
      */}
      <div className="mt-auto pt-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-sunken">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-slow ease-standard',
              complete ? 'bg-brand/60' : 'bg-text-tertiary',
            )}
            style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }}
          />
        </div>
      </div>
    </Card>
  );
}

export function TodaysMissions({ missions }: { missions: Mission[] }) {
  const done = missions.filter((m) => m.done >= m.target).length;

  return (
    <>
      <SectionHeading
        title="Today"
        action={
          <span className="text-caption text-text-tertiary">
            {done}/{missions.length} done
          </span>
        }
      />
      {/*
        `auto-fit` with a floor, rather than a fixed three.

        Three hard columns squeezed "Send 5 messages" onto two lines at the very
        width where there was room for a wider card. Letting the grid choose
        means it takes three when each can be 190px, two when it cannot, and one
        on a phone — and no title is broken to satisfy a column count that was
        decided in advance.
      */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] items-stretch gap-2 px-4">
        {missions.map((mission) => (
          <MissionCard key={mission.id} mission={mission} />
        ))}
      </div>
    </>
  );
}

/**
 * Pulse.
 *
 * People and warmth, not a leaderboard. Ordered by how recently you spoke, so
 * the top of the list is who you are close to *now* — which is the thing a
 * friendship signal is for, and the reason it is not sorted by message count.
 */
export function Pulse({ entries }: { entries: PulseEntry[] }) {
  const busiest = Math.max(1, ...entries.map((e) => e.exchanges));

  return (
    <>
      <SectionHeading title="Pulse" />
      <div className="px-4">
        <Card elevation="flat" className="divide-y divide-line p-0">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
              {/*
                The name takes what it needs; the bar takes what is left.

                It was a fixed 6rem column, which cut names short while the bar
                beside it had room to spare. Flexing both — with the name given
                the smaller share and a ceiling so one long name cannot swallow
                the row — keeps the reading order the section is built on: who
                first, how warm second.
              */}
              <p className="min-w-0 flex-[1_1_auto] basis-20 truncate text-body sm:max-w-48">
                {entry.name}
              </p>

              {/*
                A bar rather than a number. "128 messages" invites comparison
                between friends, which is the last thing a friendship signal
                should encourage; a length says "warm" without scoring anyone.
                The floor stops it collapsing to a dot beside a long name.
              */}
              <div className="h-1 min-w-16 flex-[2_1_0%] overflow-hidden rounded-full bg-sunken">
                <div
                  className="h-full rounded-full bg-brand/70"
                  style={{ width: `${Math.max(4, Math.round((entry.exchanges / busiest) * 100))}%` }}
                />
              </div>

              {/*
                Memory framing, not decay.

                "12d ago" beside a shrinking bar reads as something running out.
                Naming what the time refers to turns the same number into a
                recollection — the last time you two spoke — which is a warm
                fact rather than a countdown.
              */}
              <p className="w-28 shrink-0 text-right text-caption leading-tight text-text-tertiary">
                <span className="block">Last conversation</span>
                <span className="block">
                  {entry.quietDays === 0
                    ? 'today'
                    : entry.quietDays === 1
                      ? 'yesterday'
                      : `${entry.quietDays} days ago`}
                </span>
              </p>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

/**
 * Recent unlocks.
 *
 * A row rather than a grid, and small. These are already in the collection
 * below; this is a reminder of the last few, not a second place to browse them.
 */
export function RecentUnlocks({
  entries,
  unlockedAt,
  onOpen,
}: {
  entries: BadgeProgress[];
  unlockedAt: Readonly<Record<string, number>>;
  onOpen: (entry: BadgeProgress) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <>
      <SectionHeading title="Recently earned" />
      <ul className="scrollbar-none flex gap-4 overflow-x-auto px-4 pb-1">
        {entries.map((entry) => (
          <li key={entry.badge.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onOpen(entry)}
              className={cn(
                'flex w-16 flex-col items-center gap-1.5 text-center',
                'transition-transform duration-instant ease-standard',
                'active:scale-[0.96] motion-reduce:active:scale-100',
              )}
            >
              <Badge badge={entry.badge} unlocked size={52} />
              <span className="line-clamp-2 text-[11px] leading-tight text-text-secondary">
                {entry.badge.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="px-4 pt-2 text-caption text-text-tertiary">
        {relativeDay(unlockedAt[entries[0]!.badge.id])}
      </p>
    </>
  );
}

function relativeDay(at?: number): string {
  if (!at) return '';
  const days = Math.round((Date.now() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Latest, today';
  if (days === 1) return 'Latest, yesterday';
  if (days < 30) return `Latest, ${days} days ago`;
  return `Latest, ${Math.round(days / 30)} months ago`;
}

/**
 * Statistics, deliberately empty.
 *
 * Cards with no numbers rather than cards with invented ones. A placeholder
 * that shows plausible figures is the kind of made-up detail that gets screen-
 * shotted and quoted back, and the point of this phase is to judge the layout
 * — which these do without pretending to be data.
 */
export function StatisticsPlaceholder({
  items,
}: {
  items: ReadonlyArray<{ id: string; label: string }>;
}) {
  return (
    <>
      <SectionHeading
        title="Statistics"
        action={<span className="text-caption text-text-tertiary">Coming soon</span>}
      />
      <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-4">
        {items.map((item) => (
          <Card key={item.id} elevation="flat" className="p-3.5">
            <p className="text-caption text-text-tertiary">{item.label}</p>
            <p aria-hidden className="pt-2 text-h2 text-text-tertiary/40">
              —
            </p>
          </Card>
        ))}
      </div>
    </>
  );
}
