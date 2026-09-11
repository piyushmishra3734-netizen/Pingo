import { cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * A code as six boxes - drawn over one real input.
 *
 * The boxes are only a picture. Underneath them is a single transparent field
 * covering the whole row, because `autoComplete="one-time-code"`, paste and a
 * screen reader all need one field; six separate inputs break every one of them.
 * Tapping anywhere on the row lands in it.
 *
 * The motion says where you are: the box waiting for the next digit lifts and
 * shows a caret, each digit pops in, a wrong code shakes the row (on every
 * refusal, not just the first - see `TextField`), and a full code sends a small
 * wave across the boxes as it goes off to be checked.
 */
export function CodeBoxes({
  value,
  onChange,
  onComplete,
  length = 6,
  invalid = false,
  disabled = false,
  autoFocus = false,
  inputRef,
  label = 'Code',
}: {
  value: string;
  onChange: (next: string) => void;
  /** The code once all its digits are in - and again on Enter. */
  onComplete?: (code: string) => void;
  length?: number;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: { current: HTMLInputElement | null };
  label?: string;
}) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const [focused, setFocused] = useState(false);

  const [shaking, setShaking] = useState(false);
  const wasInvalid = useRef(invalid);
  useEffect(() => {
    if (invalid && !wasInvalid.current) setShaking(true);
    wasInvalid.current = invalid;
  }, [invalid]);

  /*
   * Focus, and the attribute with it. React never writes `autofocus` into the
   * DOM, and `Sheet` gives focus to `[autofocus]` or else takes it for the
   * dialog - after this effect, since a parent's run after its child's. Also
   * when a disabled field comes back, which `autoFocus` alone would miss.
   */
  useEffect(() => {
    const input = ref.current;
    if (!autoFocus || disabled || !input) return;
    input.setAttribute('autofocus', '');
    input.focus();
  }, [autoFocus, disabled, ref]);

  const complete = value.length === length;

  return (
    <div
      className={cn(
        'relative mx-auto flex w-full max-w-[22rem] justify-center gap-2',
        shaking && 'motion-safe:animate-shake',
        disabled && 'opacity-60',
      )}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setShaking(false);
      }}
    >
      {Array.from({ length }, (_, index) => {
        const digit = value[index];
        const active =
          focused && !disabled && (index === value.length || (complete && index === length - 1));

        return (
          <div
            key={index}
            aria-hidden
            className={cn(
              'relative grid h-14 min-w-0 max-w-12 flex-1 place-items-center rounded-xl border',
              'text-h2 font-semibold tabular-nums text-ink',
              'transition-[border-color,background-color,box-shadow,translate] duration-150 ease-standard',
              digit ? 'border-brand/30 bg-surface' : 'border-line/40 bg-sunken',
              active && '-translate-y-0.5 border-brand bg-surface ring-4 ring-brand/15',
              invalid && 'border-danger/50 bg-danger-soft/80 text-danger',
              complete && !invalid && 'motion-safe:animate-code-wave',
            )}
            style={complete && !invalid ? { animationDelay: `${index * 45}ms` } : undefined}
          >
            {digit && (
              <span key={digit} className="motion-safe:animate-react-in">
                {digit}
              </span>
            )}
            {active && !digit && (
              <span className="absolute h-6 w-0.5 rounded-full bg-brand motion-safe:animate-code-caret" />
            )}
          </div>
        );
      })}

      <input
        ref={ref}
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(event) => {
          // Digits only: a pasted code often arrives with spaces around it.
          const next = event.target.value.replace(/\D/g, '').slice(0, length);
          onChange(next);
          if (next.length === length && value.length !== length) onComplete?.(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && complete) onComplete?.(value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        disabled={disabled}
        // 16px so iOS does not zoom the page on focus; nobody sees this text.
        className="absolute inset-0 size-full cursor-text bg-transparent text-[16px] text-transparent caret-transparent outline-none selection:bg-transparent"
      />
    </div>
  );
}
