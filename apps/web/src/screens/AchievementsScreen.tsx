import { useProfile } from '@pingo/core';
import type { MythicAccent, MythicAura } from '@pingo/core';
import { cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { AchievementCabinet } from '../features/achievements/AchievementCabinet.js';
import { mythicWashStyle } from '../features/achievements/MythicAura.js';
import { useOwnAchievements } from '../features/achievements/useAchievements.js';
import { usePreferences } from '../features/settings/SettingsContext.js';

/**
 * What this account has collected, and the little it may change about it.
 *
 * ## One screen, not two
 *
 * The cabinet and the customisation belong together: the choices only exist
 * because of what is in the cabinet, and separating them would mean a settings
 * page whose controls are meaningless until you have been somewhere else. So
 * the collection is the page, and the choices sit under it - visible only to
 * somebody who has something to apply them to.
 *
 * ## Nothing here is a shop
 *
 * No prices, no upsell, no "unlock more". An account with nothing sees an
 * honest empty cabinet and a sentence saying so; it is not shown a list of
 * things it could buy or a mission it should run. The way in to the mission is
 * on the profile, once, where somebody goes looking for it.
 */

/**
 * Each option carries a sample of itself.
 *
 * The three buttons used to be words in identical pills, so choosing between
 * them was reading three adjectives and guessing. A dot of the actual light is
 * the shortest possible description of what "Iridescent" means, and it costs a
 * gradient string per row.
 */
const AURAS: { id: MythicAura; label: string; swatch: string }[] = [
  {
    id: 'classic',
    label: 'Classic',
    swatch: 'radial-gradient(circle at 35% 30%, #a78bfa, #6d3ff0 70%)',
  },
  {
    id: 'iridescent',
    label: 'Iridescent',
    swatch: 'linear-gradient(135deg, #78beff, #be8cff 45%, #ffaadc)',
  },
  { id: 'gold', label: 'Gold Glow', swatch: 'linear-gradient(135deg, #ffcd6e, #e2a03c)' },
];

const ACCENTS: { id: MythicAccent; label: string; swatch: string }[] = [
  { id: 'aurora', label: 'Aurora', swatch: 'linear-gradient(135deg, #7c5cff, #50b4ff)' },
  { id: 'gold', label: 'Gold', swatch: 'linear-gradient(135deg, #e2aa46, #ffd68c)' },
  {
    id: 'prism',
    label: 'Prism',
    swatch: 'linear-gradient(135deg, #ff96c8, #8cc8ff 50%, #be96ff)',
  },
];

export function AchievementsScreen() {
  const { profile } = useProfile();
  const { preferences, update } = usePreferences();
  const mine = useOwnAchievements(profile?.id);

  const earned = mine.all();
  const isMythic = mine.isMythic();
  const { aura, accent } = preferences.mythic;

  return (
    /* The wash is the root's own background - see `mythicWashStyle`. */
    <div
      className="relative flex h-full min-h-0 flex-col bg-page"
      style={isMythic ? mythicWashStyle(accent) : undefined}
    >
      <ScreenHeader title="Achievements" showBack />

      <div className="relative min-h-0 mx-auto w-full max-w-md flex-1 overflow-y-auto px-5 pb-28">
        {earned.length === 0 ? (
          /*
            An empty cabinet rather than a sentence where a cabinet would be.
            The slots are what the screen is; showing them empty says "nothing
            yet" in the shape of the thing that will hold it, and it means the
            page does not change layout the day the first one arrives.
          */
          <>
            <SectionLabel>Collection</SectionLabel>
            <Card>
              <AchievementCabinet earned={[]} aura={aura} />
            </Card>
            <p className="text-body mt-4 text-center text-text-secondary">
              Nothing here yet. Achievements appear once they are earned.
            </p>
          </>
        ) : (
          <>
            {/*
              A heading, so the grid is a section rather than the first thing
              that happens to be under the header. The two pickers below already
              had one each, which is what made the collection look like an
              unlabelled leftover.
            */}
            <SectionLabel>Collection</SectionLabel>
            <Card>
              <AchievementCabinet earned={earned} aura={aura} earnedAt={mine.earnedAt} />
            </Card>
          </>
        )}

        {/*
          The choices, and only for somebody they apply to.

          Two decisions, three options each. A longer panel would turn a
          collectible into a settings screen, and the point is the badge rather
          than the configuring of it.
        */}
        {isMythic && (
          <div className="mt-8">
            <SectionLabel>Badge aura</SectionLabel>
            <ChoiceRow
              options={AURAS}
              value={aura}
              onPick={(next) => update('mythic', { aura: next })}
            />

            <SectionLabel className="mt-7">Profile accent</SectionLabel>
            <ChoiceRow
              options={ACCENTS}
              value={accent}
              onPick={(next) => update('mythic', { accent: next })}
            />

            {/*
              The footnote sits under both controls rather than inside either,
              because it is true of both and repeating it would read as a
              warning rather than a note.
            */}
            <p className="text-caption mt-4 px-1 text-text-tertiary">
              Only you choose how yours is drawn. Everyone sees the same badge.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One heading, so all three sections are the same heading.
 *
 * They were three separate `h2` elements with the same six classes typed out
 * each time, which is how the collection ended up with none - it is easier to
 * forget a heading than to forget a component.
 *
 * The inset padding is not decoration: the card below it is inset from the
 * page, and a heading flush to the screen edge above an inset card is the
 * detail that makes a grouped list look assembled rather than stacked.
 */
function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        'text-caption px-1 pb-2 font-medium tracking-wide text-text-secondary uppercase',
        className,
      )}
    >
      {children}
    </h2>
  );
}

/**
 * The grouped card the sections sit in.
 *
 * Borrowed from the inset-grouped list iOS has used since 13: content on a
 * filled surface, floating on a slightly darker page, with no border at all.
 * The border is the thing worth noticing - a hairline ring would draw the eye
 * to the container, and the container is not the point. Contrast between two
 * fills says "this is a group" quietly enough that nobody reads it as a box.
 */
function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-[1.25rem] bg-surface p-4">{children}</div>;
}

/**
 * Three options, one chosen: a segmented control.
 *
 * ## The swatch, which the original argued against
 *
 * This file used to say a row of glowing swatches would compete with the emblem
 * for attention. That was written when the emblem was 56 pixels in a grid of
 * `???` circles - it was not winning anything to compete for. With the emblem
 * at 88 the balance is the other way round, and three identical pills reading
 * "Classic / Iridescent / Gold Glow" made somebody choose between adjectives
 * with no idea what any of them looked like.
 *
 * So each option carries a dot of the light it applies. It is the shortest
 * description of "Iridescent" there is, and it is still a dot - not a preview
 * panel, not an animation.
 *
 * ## One track, not three buttons
 *
 * Three separate pills, each with its own ring, is a web pattern: it says
 * "three things, one of which is highlighted". A segmented control says "one
 * setting with three positions", which is what this is - and it is the control
 * iOS has used for exactly this shape of choice for fifteen years.
 *
 * The mechanics are the ones that make it read as physical rather than styled.
 * A recessed track in the app's resting fill. One raised segment on the surface
 * colour with a soft shadow, so the selection looks lifted out of the track
 * instead of coloured in. Hairlines between the segments that are not touching
 * the selection, which is the small thing that keeps the unselected pair from
 * reading as one wide button. And the selected segment presses when tapped,
 * because on iOS everything you can move answers a finger.
 */
function ChoiceRow<T extends string>({
  options,
  value,
  onPick,
}: {
  options: { id: T; label: string; swatch: string }[];
  value: T;
  onPick: (next: T) => void;
}) {
  const chosen = options.findIndex((option) => option.id === value);

  return (
    <div className="flex gap-0.5 rounded-[0.85rem] bg-hover p-1" role="radiogroup">
      {options.map((option, index) => {
        const active = option.id === value;
        /*
         * A separator before this segment only when neither it nor the one
         * before it is selected. Beside the raised segment the shadow already
         * draws the edge, and a hairline there would double it.
         */
        const separated = index > 0 && index !== chosen && index - 1 !== chosen;

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(option.id)}
            className={cn(
              // 44px of touch target, kept while the visible pill stays slim.
              'focus-ring text-caption relative flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[0.6rem] px-2 font-medium',
              'transition-[background-color,box-shadow,transform] duration-quick ease-standard',
              active
                ? 'bg-surface text-ink shadow-sm active:scale-[0.97]'
                : 'text-text-secondary active:opacity-60',
              separated &&
                'before:absolute before:left-[-1px] before:h-4 before:w-px before:bg-line-strong',
            )}
          >
            <span
              aria-hidden
              className="size-3.5 shrink-0 rounded-full"
              style={{ background: option.swatch }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default AchievementsScreen;
