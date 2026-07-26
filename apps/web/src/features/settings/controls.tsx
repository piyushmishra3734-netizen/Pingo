import { Toggle, cn } from '@pingo/ui';
import type { ReactNode } from 'react';

import { ScreenHeader } from '../../components/ScreenHeader.js';

/**
 * The shared vocabulary of a settings page.
 *
 * Nine pages built from four controls, so they cannot drift apart in padding,
 * divider placement or how a choice is expressed. Adding a tenth page means
 * picking from these, not inventing a fifth.
 */

/** The page frame: header, scroll area, and room for the dock. */
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-page">
      <ScreenHeader title={title} showBack />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4">{children}</div>
    </div>
  );
}

/**
 * A titled block of rows.
 *
 * `note` is where a page admits what a setting does not do yet. It sits under
 * the title rather than beside a row, because it usually applies to the whole
 * group and repeating it per row would be louder than the settings themselves.
 */
export function Group({
  title,
  note,
  children,
}: {
  title?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      {title && <h2 className="mb-2 px-1 text-caption font-medium uppercase tracking-wider text-text-tertiary">{title}</h2>}
      <div
        className={cn(
          'rounded-lg bg-surface p-1 shadow-sm',
          '[&>*+*]:relative',
          "[&>*+*]:before:absolute [&>*+*]:before:left-3 [&>*+*]:before:right-3 [&>*+*]:before:top-0",
          '[&>*+*]:before:h-px [&>*+*]:before:bg-divider',
        )}
      >
        {children}
      </div>
      {note && <p className="mt-2 px-1 text-caption text-text-tertiary">{note}</p>}
    </section>
  );
}

/** A switch with a label, and an optional second line explaining it. */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-3',
        disabled ? 'opacity-45' : 'cursor-pointer hover:bg-hover',
        'transition-colors duration-instant ease-standard',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-caption text-text-secondary">{description}</span>
        )}
      </span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </label>
  );
}

/**
 * A choice between a handful of options.
 *
 * Segmented rather than a dropdown: with three or four options the whole set
 * fits, and seeing the alternatives is most of what makes a setting
 * understandable. A dropdown hides them behind a tap.
 */
export function ChoiceRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="px-3 py-3">
      <span className="block text-body text-ink">{label}</span>
      {description && (
        <span className="mt-0.5 block text-caption text-text-secondary">{description}</span>
      )}

      <div className="mt-2.5 flex gap-1.5" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              'flex-1 rounded-md px-2 py-2 text-caption',
              'focus-ring transition-colors duration-instant ease-standard',
              value === option.value
                ? 'bg-brand text-white'
                : 'bg-sunken text-text-secondary hover:bg-hover hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A row that only reports something, or leads somewhere not built yet. */
export function InfoRow({
  label,
  value,
  onClick,
  destructive = false,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  destructive?: boolean;
}) {
  const content = (
    <>
      <span
        className={cn('min-w-0 flex-1 text-body', destructive ? 'text-danger' : 'text-ink')}
      >
        {label}
      </span>
      {value && <span className="shrink-0 text-caption text-text-secondary">{value}</span>}
    </>
  );

  if (!onClick) {
    return <div className="flex items-center gap-3 px-3 py-3">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-3 text-left',
        'focus-ring transition-colors duration-instant ease-standard',
        'hover:bg-hover active:bg-pressed',
      )}
    >
      {content}
    </button>
  );
}
