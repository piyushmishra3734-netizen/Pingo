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
            <li key={p.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(p.id)}
                className={cn(
                  'focus-ring flex w-full flex-col rounded-2xl border px-3 py-3 text-left',
                  'transition-[border-color,background-color,transform,opacity] duration-quick ease-standard',
                  selected
                    ? 'scale-[1.02] border-brand/35 bg-selected shadow-sm'
                    : 'border-line/50 bg-surface hover:bg-hover',
                )}
              >
                <span className="text-body font-medium text-ink">{p.label}</span>
                <span className="mt-0.5 text-caption text-text-tertiary">{p.hint}</span>
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
            'focus-ring w-full resize-none rounded-2xl border border-line/50 bg-sunken',
            'px-3 py-2.5 text-body text-ink',
          )}
        />
      )}

      <p
        className="rounded-2xl border border-line/40 bg-sunken/60 px-3 py-2.5 text-caption leading-snug text-text-secondary"
        aria-live="polite"
      >
        <span className="font-medium text-text-tertiary">Preview · </span>
        {preview}
      </p>
    </div>
  );
}
