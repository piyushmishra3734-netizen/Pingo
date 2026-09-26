import { useProfile } from '@pingo/core';
import type { MythicAccent, MythicAura } from '@pingo/core';
import { cn } from '@pingo/ui';
import { CalendarDays } from 'lucide-react';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { AchievementArt } from '../features/achievements/AchievementArt.js';
import { AchievementCabinet } from '../features/achievements/AchievementCabinet.js';
import { CABINET_SLOTS, displayTitle } from '../features/achievements/registry.js';
import { mythicWashStyle } from '../features/achievements/MythicAura.js';
import { useOwnAchievements } from '../features/achievements/useAchievements.js';
import { setDisplayedBadge } from '../features/referrals/referrals-service.js';
import { refreshEarnedBadges } from '../features/referrals/useEarnedBadges.js';
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

  /*
   * Write, then forget what was remembered.
   *
   * `useEarnedBadges` caches for the session because a badge is earned once and
   * never revoked - but which one is *worn* changes whenever somebody says so,
   * and the cache would otherwise keep answering with the old choice until a
   * reload. Dropping this account's entry makes the next render re-ask, in the
   * same batched query every other row already uses.
   *
   * A refusal changes nothing on screen on purpose. The server rejects a badge
   * the account has not earned, and the honest response to that is the tile
   * staying where it was - not a dialog about a state the person cannot reach.
   */
  const chooseDisplayed = async (badgeId: string) => {
    if (!(await setDisplayedBadge(badgeId))) return;
    refreshEarnedBadges(profile?.id);
  };

  const lead = mine.lead();
  const leadDate = lead ? shortDate(mine.earnedAt(lead.id)) : undefined;

  return (
    /* The wash is the root's own background - see `mythicWashStyle`. */
    <div
      className="profile-type relative flex h-full min-h-0 flex-col"
      style={isMythic ? mythicWashStyle(accent) : undefined}
    >
      <ScreenHeader title="Achievements" showBack />

      <div className="relative mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-2 overflow-y-auto px-2 pb-28 pt-2">
        {/*
          The worn badge, standing on your own cover.

          The same card as the profile, so this reads as a room in the same
          house: your picture at the top, fading into the card, and the badge
          you chose standing where your face would be.
        */}
        {lead && (
          <article className="rounded-[34px] bg-surface/70 p-[5px] ring-1 ring-line">
            <div className="relative overflow-hidden rounded-[29px] bg-surface px-5 pb-5 pt-[176px] text-center">
              {profile?.bannerUrl ? (
                <img
                  src={profile.bannerUrl}
                  alt=""
                  className="absolute inset-x-0 top-0 h-[150px] w-full object-cover"
                  style={{ objectPosition: `50% ${profile.bannerOffset}%` }}
                />
              ) : (
                <div className="absolute inset-x-0 top-0 h-[150px] bg-brand-wash" />
              )}
              <div className="absolute inset-x-0 top-[70px] h-20 bg-gradient-to-b from-transparent to-surface" />
              <div className="absolute inset-x-0 top-[26px] flex justify-center">
                <AchievementArt achievement={lead} size="large" aura={aura} className="size-[9.5rem] sm:size-[9.5rem]" />
              </div>

              <h2 className="relative text-[22px] font-bold leading-tight tracking-[-0.04em] text-ink">
                {displayTitle(lead)}
              </h2>
              <p className="relative mt-1 text-body text-text-secondary">{lead.blurb}</p>
              <p className="relative mt-3 flex flex-wrap justify-center gap-x-3.5 gap-y-1 text-[12.5px] text-text-tertiary">
                <span className="inline-flex items-center gap-1.5">
                  <AchievementArt achievement={lead} size="mark" className="size-4" />
                  Beside your name
                </span>
                {leadDate && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays size={14} />
                    {leadDate}
                  </span>
                )}
              </p>
            </div>
          </article>
        )}

        <section className="rounded-[28px] bg-surface p-[18px]">
          <div className="flex items-baseline justify-between">
            <h3 className="text-body font-semibold text-ink">Collection</h3>
            <span className="text-caption text-text-secondary">
              {earned.length} of {CABINET_SLOTS}
            </span>
          </div>
          <AchievementCabinet
            className="mt-4"
            earned={earned}
            aura={aura}
            earnedAt={mine.earnedAt}
            {...(mine.displayed() ? { displayed: mine.displayed() } : {})}
            onDisplay={(badgeId) => void chooseDisplayed(badgeId)}
          />
          <p className="mt-3.5 text-caption text-text-secondary">
            {earned.length > 0
              ? 'Tap a badge to see it, and to wear it beside your name.'
              : 'Nothing here yet. Achievements appear once they are earned.'}
          </p>
        </section>

        {/*
          The choices, and only for somebody they apply to.

          The glow is chosen on the badge itself - three copies of what you
          wear, each in its own light - because "Iridescent" is an adjective
          and the picture is the answer.
        */}
        {isMythic && lead && (
          <section className="rounded-[28px] bg-surface p-[18px]">
            <h3 className="text-body font-semibold text-ink">Look</h3>

            <p className="mt-3.5 text-caption font-medium text-text-secondary">Badge glow</p>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Badge glow">
              {AURAS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={option.id === aura}
                  onClick={() => update('mythic', { aura: option.id })}
                  className={cn(
                    'focus-ring flex h-[5.25rem] flex-col items-center justify-center gap-1.5 rounded-[18px] bg-sunken',
                    'text-caption font-medium text-ink transition-[box-shadow,transform] duration-instant active:scale-[0.97]',
                    option.id === aura && 'ring-[1.5px] ring-inset ring-ink',
                  )}
                >
                  <AchievementArt achievement={lead} size="small" aura={option.id} className="size-10" />
                  {option.label}
                </button>
              ))}
            </div>

            <p className="mt-4 text-caption font-medium text-text-secondary">Profile accent</p>
            <div className="mt-2 flex gap-3.5" role="radiogroup" aria-label="Profile accent">
              {ACCENTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={option.id === accent}
                  onClick={() => update('mythic', { accent: option.id })}
                  className={cn(
                    'focus-ring flex flex-col items-center gap-1.5 rounded-lg text-[11.5px] font-medium',
                    option.id === accent ? 'text-ink' : 'text-text-secondary',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-[30px] rounded-full transition-shadow duration-quick',
                      option.id === accent && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
                    )}
                    style={{ background: option.swatch }}
                  />
                  {option.label}
                </button>
              ))}
            </div>

            <p className="mt-4 text-caption text-text-tertiary">
              Only you choose how yours is drawn. Everyone sees the same badge.
            </p>
          </section>
        )}
      </div>
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

export default AchievementsScreen;
