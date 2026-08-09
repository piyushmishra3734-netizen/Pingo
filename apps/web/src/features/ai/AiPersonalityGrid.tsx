import { cn } from '@pingo/ui';

import { PERSONALITIES, type PersonalityId } from './personalities.js';

export function AiPersonalityGrid({
  value,
  customText,
  onChange,
  onCustomText,
}: {
  value: PersonalityId;
  customText?: string;
  onChange: (id: PersonalityId) => void;
  onCustomText?: (text: string) => void;
}) {
  const active = PERSONALITIES.find((p) => p.id === value) ?? PERSONALITIES[0]!;
  const preview =
    value === 'custom' && customText?.trim()
      ? `“${customText.trim().slice(0, 80)}${customText.trim().length > 80 ? '…' : ''}”`
      : active.preview;

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Personality">
        {PERSONALITIES.map((p) => {
          const selected = value === p.id;
          return (
            <li key={p.id} className="min-w-0">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(p.id)}
                className={cn(
                  'flex w-full flex-col rounded-xl border px-3 py-2.5 text-left',
                  'transition-[border-color,background-color,box-shadow] duration-150',
                  'active:scale-[0.98]',
                  selected
                    ? 'border-ink/20 bg-ink text-white shadow-sm'
                    : 'border-black/[0.07] bg-sunken/80 text-ink hover:bg-hover',
                )}
              >
                <span
                  className={cn(
                    'text-[0.875rem] font-medium tracking-[-0.01em]',
                    selected ? 'text-white' : 'text-ink',
                  )}
                >
                  {p.label}
                </span>
                <span
                  className={cn(
                    'mt-0.5 text-[0.75rem] leading-snug',
                    selected ? 'text-white/70' : 'text-text-tertiary',
                  )}
                >
                  {p.hint}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {value === 'custom' && onCustomText && (
        <textarea
          value={customText ?? ''}
          onChange={(e) => onCustomText(e.target.value.slice(0, 200))}
          rows={2}
          placeholder="Describe the vibe in a sentence"
          className={cn(
            'w-full resize-none rounded-xl border border-black/[0.07] bg-white',
            'px-3 py-2.5 text-[0.9375rem] text-ink',
            'placeholder:text-text-tertiary outline-none',
            'focus:border-black/20 focus:shadow-[0_0_0_3px_rgba(17,17,19,0.06)]',
          )}
        />
      )}

      <p
        className={cn(
          'rounded-xl border border-black/[0.05] bg-sunken/70 px-3 py-2.5',
          'text-[0.75rem] leading-snug text-text-secondary',
        )}
        aria-live="polite"
      >
        <span className="font-medium text-text-tertiary">Preview · </span>
        {preview}
      </p>
    </div>
  );
}
