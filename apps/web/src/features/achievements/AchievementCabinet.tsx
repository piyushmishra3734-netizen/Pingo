import { cn } from '@pingo/ui';
import type { MythicAura } from '@pingo/core';
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { AchievementArt } from './AchievementArt.js';
import { CABINET_SLOTS, type Achievement } from './registry.js';

/**
 * The collection, earned and not.
 *
 * ## Why the empty slots carry no words
 *
 * A locked slot that says "Send 100 messages" when no such achievement exists
 * is a rule somebody will go and try to satisfy, and nothing will happen. So
 * the empty ones say `???` and nothing else - they are honest about there being
 * more to come and silent about what, which is also the only version of this
 * that stays true as the registry grows.
 *
 * ## Why a fixed number of slots
 *
 * A grid that is exactly as long as what you own is not a collection, it is a
 * list - there is nowhere for the next one to go, so there is nothing to fill.
 * Six is enough to read as unfinished and few enough that it never looks like a
 * wall of failure.
 */

export function AchievementCabinet({
  earned,
  aura,
  className,
}: {
  earned: Achievement[];
  aura: MythicAura;
  className?: string;
}) {
  const [open, setOpen] = useState<Achievement>();
  const empties = Math.max(0, CABINET_SLOTS - earned.length);

  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-3">
        {earned.map((achievement) => (
          <button
            key={achievement.id}
            type="button"
            onClick={() => setOpen(achievement)}
            className={cn(
              'focus-ring flex flex-col items-center gap-2 rounded-xl p-3',
              // The only motion in the cabinet, and it answers a finger.
              'transition-transform duration-instant active:scale-[0.97]',
            )}
          >
            <AchievementArt achievement={achievement} size="small" aura={aura} className="size-14" />
            <span className="text-caption text-center leading-tight font-medium text-ink">
              {achievement.title}
            </span>
          </button>
        ))}

        {Array.from({ length: empties }, (_, i) => (
          <div
            key={`empty-${i}`}
            className="flex flex-col items-center gap-2 rounded-xl p-3"
            /*
              Not a button. There is nothing behind it, and a tappable slot that
              does nothing teaches people the grid is not worth touching.
            */
          >
            <span
              aria-hidden
              className="grid size-14 place-items-center rounded-full bg-hover text-text-tertiary"
            >
              <span className="text-body font-semibold tracking-widest">???</span>
            </span>
            <span className="text-caption text-center leading-tight text-text-tertiary">
              Locked
            </span>
          </div>
        ))}
      </div>

      {empties > 0 && (
        <p className="text-caption mt-3 text-center text-text-tertiary">
          A hidden achievement awaits.
        </p>
      )}

      {open && <AchievementSheet achievement={open} aura={aura} onClose={() => setOpen(undefined)} />}
    </div>
  );
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
  onClose,
}: {
  achievement: Achievement;
  aura: MythicAura;
  unlockedAt?: string;
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

        <p className="text-caption mt-2 font-medium text-brand">Unlocked</p>
        {unlockedAt && <p className="text-caption text-text-tertiary">{unlockedAt}</p>}

        <p className="text-body mt-4 max-w-xs text-text-secondary">{achievement.blurb}</p>
      </div>
    </Sheet>
  );
}
