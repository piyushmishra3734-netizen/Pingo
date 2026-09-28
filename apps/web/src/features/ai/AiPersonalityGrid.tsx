import { cn } from '@pingo/ui';
import { Check } from 'lucide-react';

import { useT } from '../i18n/useT.js';
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
  const t = useT();
  const active = PERSONALITIES.find((p) => p.id === value) ?? PERSONALITIES[0]!;
  const preview =
    value === 'custom' && customText?.trim()
      ? `“${customText.trim().slice(0, 80)}${customText.trim().length > 80 ? '…' : ''}”`
      : active.preview;

  return (
    <div className="space-y-3">
      {/* A list with a tick, as a phone's own settings pick one of several. */}
      <ul className="overflow-hidden rounded-[14px] bg-surface ring-1 ring-line [&>li+li]:border-t [&>li+li]:border-line" role="radiogroup" aria-label={t('ai.personality')}>
        {PERSONALITIES.map((p) => {
          const selected = value === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(p.id)}
                className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] text-ink">{p.label}</span>
                  <span className="block text-[13px] text-text-tertiary">{p.hint}</span>
                </span>
                {selected && <Check size={20} strokeWidth={2.5} className="shrink-0 text-brand" />}
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
          placeholder={t('ai.vibePh')}
          className={cn(
            'w-full resize-none rounded-xl border border-line bg-surface',
            'px-3 py-2.5 text-[0.9375rem] text-ink',
            'placeholder:text-text-tertiary outline-none',
            'focus:border-black/20 focus:shadow-[0_0_0_3px_rgba(17,17,19,0.06)]',
          )}
        />
      )}

      <p className="px-4 text-[13px] leading-snug text-text-tertiary" aria-live="polite">
        {preview}
      </p>
    </div>
  );
}
