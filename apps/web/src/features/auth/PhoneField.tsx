import { normalisePhoneDigits } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useId } from 'react';

import { COUNTRIES, flagFor, type Country } from './countries.js';

/**
 * The phone number field - § 6.2.
 *
 * A country pill beside the number, exactly as the wireframe draws it, and the
 * two together assemble the E.164 string the backend wants.
 *
 * ## Two deliberate departures from § 6.2
 *
 * **The pill is a `<select>`, not a searchable bottom sheet.** The sheet is the
 * right answer at 250 countries; at the curated list in `countries.ts` it would
 * be a search box over one screenful. The native control also brings keyboard
 * navigation, type-ahead and platform pickers for free - on a phone it already
 * *is* a bottom sheet. It is styled as the pill from the wireframe, so the
 * affordance the design specifies is unchanged.
 *
 * **Grouping is every five digits, not per-country.** Real per-country
 * formatting needs libphonenumber's metadata (~150 kB), which the performance
 * budget would rightly question for a field used once. Five-digit groups match
 * the wireframe's `98765 43210` and stay readable everywhere else.
 *
 * Both are noted rather than hidden: they are the kind of shortcut that should
 * be visible to whoever revisits § 6.2 with a metadata library in hand.
 */

export interface PhoneFieldProps {
  country: Country;
  onCountryChange: (country: Country) => void;
  /** National digits only - no dial code, no punctuation. */
  digits: string;
  onDigitsChange: (digits: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

/** Groups digits in fives, so a long number is scannable while being typed. */
function group(digits: string): string {
  return digits.replace(/(\d{5})(?=\d)/g, '$1 ');
}

export function PhoneField({
  country,
  onCountryChange,
  digits,
  onDigitsChange,
  disabled = false,
  autoFocus = false,
  onSubmit,
}: PhoneFieldProps) {
  const id = useId();

  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-2 block text-caption font-medium text-text-secondary">
        Phone number
      </label>

      <div className="flex items-center gap-2">
        {/*
          The pill. The native select sits transparent on top of the rendered
          flag and dial code, so the control looks like the wireframe while the
          browser supplies the picker.
        */}
        <div
          className={cn(
            'relative flex h-12 shrink-0 items-center gap-1.5 rounded-md px-3',
            'bg-sunken border border-transparent',
            'transition-[background-color,border-color] duration-instant ease-standard',
            'focus-within:bg-surface focus-within:border-line-strong',
            disabled && 'opacity-45',
          )}
        >
          <span aria-hidden className="text-body leading-none">
            {flagFor(country.code)}
          </span>
          <span className="text-body text-ink tabular-nums">{country.dial}</span>

          <select
            aria-label="Country"
            value={country.code}
            disabled={disabled}
            onChange={(event) => {
              const next = COUNTRIES.find((c) => c.code === event.target.value);
              if (next) onCountryChange(next);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {COUNTRIES.map((option) => (
              <option key={option.code} value={option.code}>
                {`${flagFor(option.code)}  ${option.name}  ${option.dial}`}
              </option>
            ))}
          </select>
        </div>

        <div
          className={cn(
            'flex h-12 min-w-0 flex-1 items-center rounded-md px-4',
            'bg-sunken border border-transparent',
            'transition-[background-color,border-color,box-shadow] duration-instant ease-standard',
            'focus-within:bg-surface focus-within:border-line-strong focus-within:shadow-sm',
          )}
        >
          <input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={group(digits)}
            disabled={disabled}
            autoFocus={autoFocus}
            placeholder="98765 43210"
            onChange={(event) => onDigitsChange(normalisePhoneDigits(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && onSubmit) onSubmit();
            }}
            className={cn(
              'min-w-0 flex-1 bg-transparent outline-none',
              'font-sans text-body text-ink tabular-nums',
              'placeholder:text-text-tertiary',
            )}
          />
        </div>
      </div>
    </div>
  );
}

/** Assembles what the field holds into the E.164 string the backend takes. */
export function toE164(country: Country, digits: string): string {
  return `${country.dial}${normalisePhoneDigits(digits)}`;
}
