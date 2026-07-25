import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { SearchIcon } from '../icons/index.js';
import { cn } from '../utils/cn.js';

/**
 * Text input.
 *
 * The board's fields are pill-shaped, filled with Soft White and *borderless*
 * until focused. That is deliberate: a page of outlined boxes is visual noise,
 * whereas a filled field reads as a soft recess in the surface. The border only
 * appears when the field is the thing you are working in.
 */

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  /** Helper or error text below the field. */
  hint?: string;
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Pill for search and composers; rounded for forms. */
  shape?: 'pill' | 'rounded';
}

export function TextField({
  label,
  hint,
  invalid = false,
  leading,
  trailing,
  shape = 'rounded',
  className,
  id: providedId,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="mb-2 block text-caption font-medium text-text-secondary"
        >
          {label}
        </label>
      )}

      <div
        className={cn(
          'group flex items-center gap-2.5 bg-sunken',
          'border border-transparent',
          'transition-[background-color,border-color,box-shadow] duration-instant ease-standard',
          // Focus is expressed on the wrapper, since the real input is bare.
          'focus-within:bg-surface focus-within:border-line-strong focus-within:shadow-sm',
          shape === 'pill' ? 'rounded-full px-4 h-12' : 'rounded-md px-4 h-12',
          invalid && 'border-danger/40 bg-danger-soft',
          className,
        )}
      >
        {leading && (
          <span className="text-text-secondary shrink-0" aria-hidden>
            {leading}
          </span>
        )}

        <input
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          className={cn(
            'min-w-0 flex-1 bg-transparent outline-none',
            'font-sans text-body text-ink',
            'placeholder:text-text-tertiary',
          )}
          {...rest}
        />

        {trailing && <span className="shrink-0">{trailing}</span>}
      </div>

      {hint && (
        <p
          id={hintId}
          className={cn(
            'mt-2 text-caption',
            invalid ? 'text-danger' : 'text-text-secondary',
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * The search field from the board: a pill with the magnifier on the left.
 *
 * A thin wrapper rather than a prop on `TextField`, because search appears often
 * enough that spelling out the icon and type at each call site would drift.
 */
export function SearchField({
  className,
  placeholder = 'Search...',
  ...rest
}: Omit<TextFieldProps, 'leading' | 'shape' | 'type'>) {
  return (
    <TextField
      type="search"
      shape="pill"
      placeholder={placeholder}
      leading={<SearchIcon size={18} />}
      className={cn('h-11', className)}
      {...rest}
    />
  );
}
