import {
  ACCENT_SWATCHES,
  type AccentName,
  type GlassLevel,
  type MotionLevel,
  type ThemeMode,
} from '@pingo/core';
import { CheckIcon, cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import { ScreenHeader } from '../../components/ScreenHeader.js';
import { useAppearance } from '../../features/settings/SettingsContext.js';

/**
 * Appearance.
 *
 * Every control here changes the product **immediately** - there is no Save
 * button and no preview pane, because the whole app is the preview. Tapping
 * Dark repaints the screen you are standing on, which is the only honest way to
 * choose a theme: you are looking at the result while you decide.
 *
 * That is possible because none of this is React state that components read.
 * Each choice writes a data attribute on `<html>`, and `@pingo/tokens` overrides
 * the same tokens every component already uses. The cascade does the work.
 */

const THEMES: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'auto', label: 'Auto', hint: 'Follows your device' },
];

const ACCENTS: { value: AccentName; label: string }[] = [
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'green', label: 'Green' },
  { value: 'pink', label: 'Pink' },
  { value: 'custom', label: 'Custom' },
];

const MOTIONS: { value: MotionLevel; label: string; hint: string }[] = [
  { value: 'smooth', label: 'Smooth', hint: 'Longer, softer' },
  { value: 'balanced', label: 'Balanced', hint: 'The default' },
  { value: 'minimal', label: 'Minimal', hint: 'Barely there' },
];

const GLASS_LEVELS: GlassLevel[] = [0, 25, 50, 75, 100];

export function AppearanceScreen() {
  const { appearance, updateAppearance, resolvedTheme } = useAppearance();

  return (
    <div className="flex h-full flex-col bg-page">
      <ScreenHeader title="Appearance" showBack />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <Group
          title="Dark Mode"
          hint={
            appearance.theme === 'auto'
              ? `Following your device - currently ${resolvedTheme}.`
              : undefined
          }
        >
          <div className="grid grid-cols-3 gap-2.5">
            {THEMES.map((theme) => (
              <ChoiceCard
                key={theme.value}
                selected={appearance.theme === theme.value}
                label={theme.label}
                hint={theme.hint}
                onSelect={() => updateAppearance({ theme: theme.value })}
              >
                {/* A miniature of the real chat screen, not a colour swatch. */}
                <ThemePreview mode={theme.value} resolved={resolvedTheme} />
              </ChoiceCard>
            ))}
          </div>
        </Group>

        <Group title="Accent">
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map((accent) => {
              const selected = appearance.accent === accent.value;
              const swatch =
                accent.value === 'custom'
                  ? (appearance.customAccent ?? '#5c6cff')
                  : ACCENT_SWATCHES[accent.value as keyof typeof ACCENT_SWATCHES];

              return (
                <button
                  key={accent.value}
                  type="button"
                  onClick={() => updateAppearance({ accent: accent.value })}
                  aria-pressed={selected}
                  className="focus-ring flex w-16 flex-col items-center gap-2 rounded-lg py-1"
                >
                  <span
                    className={cn(
                      'grid size-11 place-items-center rounded-full',
                      'transition-transform duration-quick ease-standard',
                      selected && 'scale-110',
                    )}
                    style={{ backgroundColor: swatch }}
                  >
                    {selected && <CheckIcon size={18} className="text-white" strokeWidth={3} />}
                  </span>
                  <span
                    className={cn(
                      'text-caption',
                      selected ? 'text-ink' : 'text-text-secondary',
                    )}
                  >
                    {accent.label}
                  </span>
                </button>
              );
            })}
          </div>

          {appearance.accent === 'custom' && (
            <label className="mt-4 flex items-center gap-3 rounded-md bg-sunken px-3 py-2.5">
              <span className="flex-1 text-caption text-text-secondary">Pick a colour</span>
              {/*
                The OS colour picker. Building one would mean re-implementing a
                control every platform already ships, worse.
              */}
              <input
                type="color"
                value={appearance.customAccent ?? '#5c6cff'}
                onChange={(event) => updateAppearance({ customAccent: event.target.value })}
                className="size-8 cursor-pointer rounded-md border border-line bg-transparent"
                aria-label="Custom accent colour"
              />
            </label>
          )}
        </Group>

        <Group title="Animations">
          <div className="grid grid-cols-3 gap-2.5">
            {MOTIONS.map((motion) => (
              <ChoiceCard
                key={motion.value}
                selected={appearance.motion === motion.value}
                label={motion.label}
                hint={motion.hint}
                onSelect={() => updateAppearance({ motion: motion.value })}
              />
            ))}
          </div>
          <p className="mt-3 text-caption text-text-tertiary">
            If your device asks for reduced motion, that still wins over this.
          </p>
        </Group>

        <Group title="Glass Intensity">
          {/*
            A live glass panel over a patterned ground - the only way to judge
            blur is against something worth blurring.
          */}
          <div className="relative overflow-hidden rounded-lg bg-brand-gradient p-5">
            <div className="glass-surface rounded-md px-4 py-3">
              <p className="text-body text-ink">Glass</p>
              <p className="text-caption text-text-secondary">
                {appearance.glass === 0 ? 'Off, solid surfaces' : `${appearance.glass}%`}
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            {GLASS_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => updateAppearance({ glass: level })}
                aria-pressed={appearance.glass === level}
                className={cn(
                  'flex-1 rounded-md py-2 text-caption',
                  'focus-ring transition-colors duration-instant ease-standard',
                  appearance.glass === level
                    ? 'bg-brand text-white'
                    : 'bg-sunken text-text-secondary hover:bg-hover',
                )}
              >
                {level}%
              </button>
            ))}
          </div>
        </Group>
      </div>
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-h2 text-ink">{title}</h2>
      {hint && <p className="mb-3 text-caption text-text-secondary">{hint}</p>}
      <div className={cn(!hint && 'mt-3')}>{children}</div>
    </section>
  );
}

function ChoiceCard({
  selected,
  label,
  hint,
  onSelect,
  children,
}: {
  selected: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col items-stretch gap-2 rounded-lg p-2 text-left',
        'focus-ring border transition-all duration-quick ease-standard',
        selected
          ? 'border-brand bg-selected'
          : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      {children}
      <span className="px-1">
        <span className="flex items-center gap-1.5">
          <span className="text-caption font-medium text-ink">{label}</span>
          {selected && <CheckIcon size={13} className="text-brand" strokeWidth={3} />}
        </span>
        <span className="mt-0.5 block text-[0.6875rem] leading-tight text-text-tertiary">
          {hint}
        </span>
      </span>
    </button>
  );
}

/**
 * A miniature chat screen - header, two bubbles, dock.
 *
 * Hard-coded colours, uniquely in this codebase: the Light card must look light
 * *while the app is dark*, so it cannot read the live tokens the way everything
 * else does.
 */
function ThemePreview({ mode, resolved }: { mode: ThemeMode; resolved: 'light' | 'dark' }) {
  const dark = mode === 'dark' || (mode === 'auto' && resolved === 'dark');

  return (
    <span
      className="block h-14 overflow-hidden rounded-md p-1.5"
      style={{ backgroundColor: dark ? '#0c0d11' : '#fbfbfe' }}
      aria-hidden
    >
      <span
        className="mb-1.5 block h-1.5 w-6 rounded-full"
        style={{ backgroundColor: dark ? '#3a3d4a' : '#d9dbe6' }}
      />
      <span
        className="mb-1 block h-2.5 w-8 rounded"
        style={{ backgroundColor: dark ? '#16171d' : '#ffffff' }}
      />
      <span
        className="ml-auto block h-2.5 w-10 rounded"
        style={{ backgroundImage: 'linear-gradient(135deg, #6d7cff, #a16eff)' }}
      />
    </span>
  );
}
