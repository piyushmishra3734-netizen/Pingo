/**
 * Life Chapters, drawn as a timeline.
 *
 * ## Why it is a rule and not cards
 *
 * The rest of Journey is cards, and cards were tried here first. They read as
 * separate items — four things that happened, side by side, with no sense that
 * one followed another. A single vertical line through the year is what makes it
 * a story: the eye travels it in one direction, and the order becomes the
 * meaning rather than the layout.
 *
 * ## The year is the loudest thing on the row
 *
 * Not the badge, not the month. The section exists to say "this was 2026", so
 * the year is set at title size and everything under it is body text. A timeline
 * where each entry shouts is a feed.
 *
 * ## No counts anywhere
 *
 * No "6 moments in 2026", no per-year totals. The instant a chapter has a score
 * it becomes a year to beat, and next year starts at zero — which is the
 * pressure this whole screen is built to avoid.
 */
import { Card, cn } from '@pingo/ui';

import { Badge } from '../badges/Badge.js';
import { BADGE_BY_ID } from '../badges/registry.js';
import {
  chapterNote,
  momentMonth,
  yearsAgoLabel,
  type Chapter,
  type ChapterMoment,
  type Recollection,
} from './chapters.js';
import { SectionHeading } from './sections.js';

/**
 * On this day.
 *
 * The feature this must not become is a memories feed: something shown every
 * day whether or not there is anything to show, with a button to post it again.
 * So it renders nothing on a day with no match — which is most days — and there
 * is no share control anywhere on it. It is a private recollection.
 *
 * One at a time. Two would be a list, and a list is something you scan rather
 * than something that catches you.
 */
export function OnThisDay({ recollections }: { recollections: Recollection[] }) {
  const first = recollections[0];
  if (!first) return null;

  return (
    <>
      <SectionHeading title="On this day" />
      <div className="px-4">
        <Card elevation="flat" className="p-4">
          <p className="text-caption text-text-tertiary">{yearsAgoLabel(first.yearsAgo)}</p>
          {/*
            Set a size larger than the timeline rows below it. This is the one
            line on the screen whose only job is to make somebody feel
            something, and it should not read like another entry in a list.
          */}
          <p className="pt-1 text-body leading-snug text-balance">{first.moment.title}</p>
          {first.moment.detail ? (
            <p className="pt-1 text-caption text-text-secondary">{first.moment.detail}</p>
          ) : null}
        </Card>
      </div>
    </>
  );
}

export function LifeChapters({ chapters }: { chapters: Chapter[] }) {
  if (chapters.length === 0) return null;

  return (
    <>
      <SectionHeading title="Life chapters" />
      <div className="px-4">
        <ol className="space-y-6">
          {chapters.map((chapter, index) => {
            const note = chapterNote(chapter, index, chapters.length);
            return (
              <li key={chapter.year}>
                <div className="flex items-baseline gap-3">
                  <h3 className="text-title tabular-nums">{chapter.year}</h3>
                  {note ? <p className="text-caption text-text-tertiary">{note}</p> : null}
                </div>

                {/*
                  The line lives on the list, not on each row, so it is
                  continuous through the chapter — a rule per row would leave
                  hairline gaps at every join and read as a dashed border.
                */}
                <ol className="mt-3 border-l border-line pl-4">
                  {chapter.moments.map((moment) => (
                    <MomentRow key={moment.id} moment={moment} />
                  ))}
                </ol>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

function MomentRow({ moment }: { moment: ChapterMoment }) {
  const badge = moment.badgeId ? BADGE_BY_ID.get(moment.badgeId) : undefined;

  return (
    <li className="relative flex items-center gap-3 py-2.5">
      {/*
        The marker sits *on* the line, not beside it — `-left-4` puts it back
        over the border the list is padded away from, and the negative
        translate centres it there at whatever size it is drawn.
      */}
      <span aria-hidden className="absolute -left-4 -translate-x-1/2">
        {badge ? (
          <Badge badge={badge} unlocked size={26} />
        ) : (
          <span
            className={cn(
              'block h-2.5 w-2.5 rounded-full',
              // Joining is the one moment with no badge that still deserves a
              // filled mark; everything else is an outline, so the line does
              // not read as a row of buttons.
              moment.kind === 'joined' ? 'bg-brand' : 'border border-line bg-bg',
            )}
          />
        )}
      </span>

      <div className="min-w-0 flex-1 pl-1">
        <p className="truncate text-body">{moment.title}</p>
        {moment.detail ? (
          <p className="truncate text-caption text-text-tertiary">{moment.detail}</p>
        ) : null}
      </div>

      <p className="shrink-0 text-caption text-text-tertiary">{momentMonth(moment.at)}</p>
    </li>
  );
}
