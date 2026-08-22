import { useProfile } from '@pingo/core';
import type { MythicAccent, MythicAura } from '@pingo/core';
import { cn } from '@pingo/ui';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { AchievementCabinet } from '../features/achievements/AchievementCabinet.js';
import { MythicAura as MythicAuraWash } from '../features/achievements/MythicAura.js';
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

const AURAS: { id: MythicAura; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'iridescent', label: 'Iridescent' },
  { id: 'gold', label: 'Gold Glow' },
];

const ACCENTS: { id: MythicAccent; label: string }[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'gold', label: 'Gold' },
  { id: 'prism', label: 'Prism' },
];

export function AchievementsScreen() {
  const { profile } = useProfile();
  const { preferences, update } = usePreferences();
  const mine = useOwnAchievements(profile?.id);

  const earned = mine.all();
  const isMythic = mine.isMythic();
  const { aura, accent } = preferences.mythic;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-page">
      {/*
        The same wash as the profile, so the two screens feel like one place.
        Only for an account that has the rare tier - an ordinary collection is
        an ordinary screen.
      */}
      {isMythic && <MythicAuraWash accent={accent} />}

      <ScreenHeader title="Achievements" showBack />

      <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-12">
        {earned.length === 0 ? (
          <p className="text-body mt-10 text-center text-text-secondary">
            Nothing here yet. Achievements appear once they are earned.
          </p>
        ) : (
          <AchievementCabinet earned={earned} aura={aura} className="mt-6" />
        )}

        {/*
          The choices, and only for somebody they apply to.

          Two decisions, three options each. A longer panel would turn a
          collectible into a settings screen, and the point is the badge rather
          than the configuring of it.
        */}
        {isMythic && (
          <div className="mt-10">
            <h2 className="text-caption font-medium tracking-wide text-text-secondary uppercase">
              Badge aura
            </h2>
            <ChoiceRow
              options={AURAS}
              value={aura}
              onPick={(next) => update('mythic', { aura: next })}
            />

            <h2 className="text-caption mt-7 font-medium tracking-wide text-text-secondary uppercase">
              Profile accent
            </h2>
            <ChoiceRow
              options={ACCENTS}
              value={accent}
              onPick={(next) => update('mythic', { accent: next })}
            />

            <p className="text-caption mt-5 text-text-tertiary">
              Only you choose how yours is drawn. Everyone sees the same badge.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Three options, one chosen.
 *
 * Deliberately plain controls: the thing being chosen is already the decorative
 * part of the screen, and a row of glowing swatches competing with the emblem
 * above them would be two things asking for the same attention.
 */
function ChoiceRow<T extends string>({
  options,
  value,
  onPick,
}: {
  options: { id: T; label: string }[];
  value: T;
  onPick: (next: T) => void;
}) {
  return (
    <div className="mt-2 flex gap-2" role="radiogroup">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(option.id)}
            className={cn(
              // 44px tall: a real touch target rather than a chip.
              'focus-ring text-caption min-h-11 flex-1 rounded-lg px-3 font-medium',
              'transition-colors duration-instant',
              active
                ? 'bg-surface text-ink ring-1 ring-[color:var(--mythic-accent,var(--color-brand))]'
                : 'bg-hover text-text-secondary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default AchievementsScreen;
