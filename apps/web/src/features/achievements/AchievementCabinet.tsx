import { Button, CheckIcon, cn } from '@pingo/ui';
import type { MythicAura } from '@pingo/core';
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { AchievementArt } from './AchievementArt.js';
import { CABINET_SLOTS, displayTitle, type Achievement } from './registry.js';

/**
 * The collection, earned and not.
 *
 * ## The empty slots used to shout, and there is only one badge
 *
 * They were filled circles reading `???` with the word "Locked" under them, and
 * with one achievement in the registry that made five sixths of the screen
 * placeholder - louder than the only real thing on it, and the reason the page
 * read as a mock-up.
 *
 * The words were the first problem. A locked slot that says "Send 100 messages"
 * when no such achievement exists is a rule somebody will go and try to
 * satisfy, and nothing will happen; `???` avoids inventing a rule but still
 * promises a puzzle nobody wrote. Silence promises nothing and is true.
 *
 * ## Filled, not dashed
 *
 * The first attempt at silence was a dashed ring, and it was worse in a way
 * that took a second look to name: a dashed stroke is wireframe grammar. It
 * means "drop something here" or "this is not real yet", and a screen full of
 * them reads as a mock-up of a screen rather than a screen. Apple's own
 * interfaces essentially never use one in a finished product - an empty well in
 * iOS is a *material*, a quiet filled shape, because a material is a thing and
 * an outline is a note about a thing.
 *
 * So an empty slot is a filled disc in the same translucent ink the rest of the
 * app uses for a resting fill. It is quieter than the dashes were, it is
 * obviously deliberate, and it stops the grid looking like something waiting to
 * be finished.
 *
 * ## Why a fixed number of slots
 *
 * A grid that is exactly as long as what you own is not a collection, it is a
 * list - there is nowhere for the next one to go, so there is nothing to fill.
 * Six is enough to read as unfinished and few enough that it never looks like a
 * wall of failure.
 *
 * ## Big enough to see what you chose
 *
 * The emblem was 56 pixels, which is smaller than the aura around it, so the
 * three-way aura picker below changed something nobody could see and the
 * controls felt dead. At 88 the aura is the visible difference between the
 * options, and the picker becomes a picker.
 */

export function AchievementCabinet({
  earned,
  aura,
  earnedAt,
  displayed,
  onDisplay,
  className,
}: {
  earned: Achievement[];
  aura: MythicAura;
  /** When each was earned, ISO. Absent while the query is still in flight. */
  earnedAt?: (badgeId: string) => string | undefined;
  /** The one worn beside this account's name, if it chose one. */
  displayed?: string;
  /** Absent when the cabinet is somebody else's - then nothing is choosable. */
  onDisplay?: (badgeId: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<Achievement>();
  const empties = Math.max(0, CABINET_SLOTS - earned.length);

  /*
   * A shelf, three to a row.
   *
   * Tiles in boxes read as a settings grid; badges standing on a ledge read as
   * things somebody owns. The ledge is the whole trick - one rounded bar under
   * each row - and an empty place is a socket pressed into the card rather than
   * an outline, for the reason the note above gives about dashes.
   */
  const slots: (Achievement | undefined)[] = [...earned, ...Array.from({ length: empties }, () => undefined)];
  const rows: (Achievement | undefined)[][] = [];
  for (let i = 0; i < slots.length; i += 3) rows.push(slots.slice(i, i + 3));

  return (
    <div className={className}>
      <div className="flex flex-col gap-4">
        {rows.map((row, r) => (
          <div
            key={r}
            className={cn(
              'relative grid grid-cols-3 gap-1.5 pb-3',
              'after:absolute after:inset-x-[-4px] after:bottom-0 after:h-2 after:rounded-md after:bg-sunken',
            )}
          >
            {row.map((achievement, i) =>
              achievement ? (
                <button
                  key={achievement.id}
                  type="button"
                  onClick={() => setOpen(achievement)}
                  className={cn(
                    'focus-ring flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-1 pt-1',
                    // The only motion on the shelf, and it answers a finger.
                    'transition-transform duration-instant active:scale-[0.97]',
                  )}
                >
                  <span className="relative">
                    <AchievementArt
                      achievement={achievement}
                      size="small"
                      aura={aura}
                      className="size-[5.25rem] drop-shadow-[0_8px_8px_rgba(0,0,0,0.18)]"
                    />
                    {achievement.id === displayed && (
                      <span
                        aria-label="Worn beside your name"
                        className="absolute -right-1 top-0 grid size-5 place-items-center rounded-full border-2 border-surface bg-ink text-surface"
                      >
                        <CheckIcon size={10} strokeWidth={3.5} />
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center text-[12.5px] font-semibold text-ink">
                    {displayTitle(achievement)}
                  </span>
                  <span className="-mt-1 text-[11px] text-text-tertiary">
                    {shortDate(earnedAt?.(achievement.id)) ?? '\u00a0'}
                  </span>
                </button>
              ) : (
                // Not a button: there is nothing behind it, and a slot that
                // does nothing teaches people the shelf is not worth touching.
                <div key={`empty-${r}-${i}`} className="grid h-[5.75rem] place-items-end justify-center pb-1.5">
                  <span aria-hidden className="size-14 rounded-full bg-sunken shadow-[inset_0_3px_8px_rgba(0,0,0,0.08)]" />
                </div>
              ),
            )}
          </div>
        ))}
      </div>

      {open && (
        <AchievementSheet
          achievement={open}
          aura={aura}
          {...(earnedAt?.(open.id) ? { unlockedAt: earnedAt(open.id) } : {})}
          isDisplayed={open.id === displayed}
          {...(onDisplay ? { onDisplay: () => onDisplay(open.id) } : {})}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}

/** "22 Aug 2026", in the reader's own locale, or nothing at all. */
function shortDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One achievement, on its own.
 *
 * A collectible item, not a mission briefing: the emblem, its name, the fact
 * that it is unlocked, and one line about what it is. How it was earned belongs
 * to the mission screen - a detail view that explains the referral would turn
 * the reward back into an advertisement for the mechanism.
 */
export function AchievementSheet({
  achievement,
  aura,
  unlockedAt,
  isDisplayed = false,
  onDisplay,
  onClose,
}: {
  achievement: Achievement;
  aura: MythicAura;
  unlockedAt?: string;
  /** True when this is the badge currently worn beside the name. */
  isDisplayed?: boolean;
  /** Omitted for somebody else's badge, and for the one already worn. */
  onDisplay?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} title={achievement.title}>
      <div className="flex flex-col items-center px-6 pb-8 text-center">
        {/*
          The one micro-effect in the layer: the emblem arrives rather than
          appearing. It runs once, it is over in a third of a second, and
          reduced motion skips it entirely.
        */}
        <div className="motion-safe:animate-react-in mt-2">
          <AchievementArt achievement={achievement} size="medium" aura={aura} className="size-28" />
        </div>

        <h2 className="mt-4 text-body font-semibold tracking-[0.14em] text-ink">
          {achievement.title}
        </h2>

        {/*
          "Unlocked" on its own is a state; with a date it is something that
          happened. When the date has not arrived yet the word stands alone
          rather than the sheet reserving an empty line for it.
        */}
        <p className="text-caption mt-2 font-medium text-[color:var(--mythic-accent,var(--color-brand))]">
          {shortDate(unlockedAt) ? `Earned ${shortDate(unlockedAt)}` : 'Unlocked'}
        </p>

        <p className="text-body mt-4 max-w-xs text-text-secondary">{achievement.blurb}</p>

        {/*
          Owning and wearing, kept apart.

          With one badge these were the same thing and there was nothing to
          choose. With two there is, and the choice belongs to the person
          wearing it - so it sits on the badge itself rather than in a settings
          list somewhere else.

          Nothing here can revoke anything. The button either sets this badge as
          the one on show or says it already is; the collection above is
          unaffected either way, which is the distinction the whole column
          exists to make.
        */}
        {onDisplay && !isDisplayed && (
          <Button variant="primary" block className="mt-6" onClick={onDisplay}>
            Show beside my name
          </Button>
        )}

        {isDisplayed && (
          <p className="text-caption mt-6 inline-flex items-center gap-1.5 font-medium text-[color:var(--mythic-accent,var(--color-brand))]">
            <CheckIcon size={14} strokeWidth={3} />
            Shown beside your name
          </p>
        )}
      </div>
    </Sheet>
  );
}
