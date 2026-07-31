import type { PasswordAssessment } from '@pingo/core';
import { CheckIcon, cn } from '@pingo/ui';

/**
 * The strength meter and live checklist  - 
 * [docs/01 § 8](../../../../../docs/01-onboarding-auth.md#8-create-password).
 *
 * The one rule worth stating twice: **unmet items are never red.** A requirement
 * that is not yet satisfied on a password still being typed is not an error, and
 * colouring it as one turns a half-typed field into a screen full of failures.
 * Met items get a brand check; unmet ones stay hollow and quiet.
 *
 * The judgement - what counts as met, what counts as strong - lives in
 * `assessPassword` in `@pingo/core`. This file only draws the result.
 */

const SEGMENTS = 4;

export function PasswordMeter({ assessment }: { assessment: PasswordAssessment }) {
  const { score, strengthLabel, requirements } = assessment;

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <span className="text-caption font-medium text-text-secondary">Strength</span>
        <span
          className={cn(
            'text-caption tabular-nums',
            score >= 3 ? 'text-ink' : 'text-text-secondary',
          )}
          // The label restates the bar, so the bar itself is decorative.
          aria-live="polite"
        >
          {score === 0 ? '' : strengthLabel}
        </span>
      </div>

      <div className="mt-2 flex gap-1.5" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <div
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full',
              'transition-[background-color] duration-quick ease-standard',
              index < score ? 'bg-brand-gradient' : 'bg-line',
            )}
          />
        ))}
      </div>

      <ul className="mt-4 space-y-2">
        {requirements.map((requirement) => (
          <li key={requirement.id} className="flex items-center gap-2.5">
            <span
              className={cn(
                'grid size-4 shrink-0 place-items-center rounded-full',
                'transition-colors duration-quick ease-standard',
                requirement.met
                  ? 'bg-brand text-white'
                  : // Hollow, not red. See the note above.
                    'border border-line-strong',
              )}
              aria-hidden
            >
              {requirement.met && <CheckIcon size={11} strokeWidth={3} />}
            </span>

            <span
              className={cn(
                'text-caption',
                requirement.met ? 'text-ink' : 'text-text-secondary',
              )}
            >
              {requirement.label}
            </span>

            {/* The visual state is colour and a glyph; this is its text equivalent. */}
            <span className="sr-only">{requirement.met ? ' -  met' : ' -  not yet met'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
