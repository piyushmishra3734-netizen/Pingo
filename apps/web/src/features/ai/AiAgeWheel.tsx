import { cn } from '@pingo/ui';
import { useEffect, useRef } from 'react';

const AGES = Array.from({ length: 80 - 13 + 1 }, (_, i) => 13 + i);

/**
 * Large snap-feel age list. No new picker library — plain scroll + listbox.
 */
export function AiAgeWheel({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (age: number | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [value]);

  return (
    <div className="space-y-2">
      <p className="text-center text-caption text-text-secondary">
        This helps me talk in a way that fits you.
      </p>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Age"
        className={cn(
          'relative mx-auto h-48 w-full max-w-[12rem] overflow-y-auto rounded-2xl',
          'border border-line/50 bg-sunken/80 py-16',
          'snap-y snap-mandatory scroll-smooth',
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-10 -translate-y-1/2 rounded-xl border border-brand/20 bg-selected/40"
          aria-hidden
        />
        {AGES.map((age) => {
          const selected = value === age;
          return (
            <button
              key={age}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(age)}
              className={cn(
                'focus-ring relative z-20 flex h-10 w-full snap-center items-center justify-center',
                'text-h2 tabular-nums transition-colors duration-quick ease-standard',
                selected ? 'font-medium text-ink' : 'text-text-tertiary',
              )}
            >
              {age}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'focus-ring mx-auto block rounded-full px-3 py-1.5 text-caption',
          value === null ? 'bg-selected text-brand' : 'text-text-tertiary hover:text-ink',
        )}
      >
        Prefer not to say
      </button>
    </div>
  );
}
