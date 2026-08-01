import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

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
  /**
   * Reaches the `<input>` itself, past the wrapper this component draws.
   *
   * Named rather than the bare `ref` so it is unambiguous which element it
   * lands on. Needed where focus is part of the interaction design - a rejected
   * password returns focus with its content selected, so the next keystroke
   * replaces it (docs/01 § 13.2).
   */
  inputRef?: Ref<HTMLInputElement>;
  /** Optional weight on the label - primary fields read slightly stronger. */
  labelClassName?: string;
  /** Optional weight on the field wrapper for form hierarchy. */
  fieldClassName?: string;
}

export function TextField({
  label,
  hint,
  invalid = false,
  leading,
  trailing,
  shape = 'rounded',
  className,
  labelClassName,
  fieldClassName,
  id: providedId,
  inputRef,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label
          htmlFor={id}
          className={cn(
            // 2–4px tighter than a full caption stack so form rhythm is dense.
            'mb-1.5 block text-caption font-medium text-text-secondary',
            labelClassName,
          )}
        >
          {label}
        </label>
      )}

      <div
        className={cn(
          'group flex items-center gap-2.5 bg-sunken',
          'border border-line/40',
          'transition-[background-color,border-color,box-shadow] duration-150 ease-standard',
          // Focus is expressed on the wrapper, since the real input is bare.
          'focus-within:bg-surface focus-within:border-brand/25 focus-within:shadow-sm',
          shape === 'pill' ? 'rounded-full px-4 h-12' : 'rounded-xl px-4 h-12',
          // Soft invalid - never a red wall.
          invalid && 'border-danger/30 bg-danger-soft/80',
          fieldClassName,
        )}
      >
        {leading && (
          <span className="text-text-tertiary shrink-0" aria-hidden>
            {leading}
          </span>
        )}

        <input
          id={id}
          ref={inputRef}
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
            'mt-1.5 text-caption',
            invalid ? 'text-danger/90' : 'text-text-tertiary',
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
  fieldClassName,
  placeholder = 'Search...',
  ...rest
}: Omit<TextFieldProps, 'leading' | 'shape' | 'type'>) {
  return (
    <TextField
      type="search"
      shape="pill"
      placeholder={placeholder}
      leading={<SearchIcon size={18} />}
      // Height lands on the field surface, not the outer stack.
      fieldClassName={cn('h-11', fieldClassName, className)}
      {...rest}
    />
  );
}
