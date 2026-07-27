import { cn } from '@pingo/ui';

/**
 * How many times this Ping may be opened.
 *
 * ## Why the sender chooses, and why two is the default
 *
 * A fixed limit is a rule about somebody else's picture. Two is right often
 * enough to be the default — long enough to look twice, short enough to still
 * be a Ping — but a single view and a picture meant to stay are both ordinary
 * things to want, and neither should require a different feature.
 *
 * ## Keep in Chat is a different mechanism, not a bigger number
 *
 * One and two views are ephemeral: the bytes come only from `openPing`, and
 * asking is what spends the view. Keep in Chat is an ordinary photo message,
 * which stays in the thread and can be reopened freely. They are separate
 * because they are separate promises — and folding them into one would give the
 * ephemeral path a mode where it never expires and never destroys anything.
 *
 * The control says so, in the smallest words that are still true. Somebody
 * choosing "Keep in Chat" should know they are choosing something that lasts.
 */

export type PingViews = 1 | 2 | null;

const OPTIONS: { value: PingViews; label: string; hint: string }[] = [
  { value: 1, label: '1 view', hint: 'One look, then gone' },
  { value: 2, label: '2 views', hint: 'Two looks, then gone' },
  { value: null, label: 'Keep in chat', hint: 'Stays like a photo' },
];

export function PingViewLimit({
  value,
  onChange,
}: {
  value: PingViews;
  onChange: (value: PingViews) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">How many times this Ping can be opened</legend>

      <div
        role="radiogroup"
        aria-label="How many times this Ping can be opened"
        className="flex gap-1.5"
      >
        {OPTIONS.map((option) => {
          const on = value === option.value;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(option.value)}
              className={cn(
                'focus-ring min-w-0 flex-1 rounded-lg px-2 py-2.5 text-center',
                'transition-[background-color,transform] duration-instant ease-standard',
                'active:scale-[0.97]',
                on
                  ? 'bg-brand-gradient text-white shadow-brand'
                  : 'bg-white/10 text-white/80 hover:bg-white/20',
              )}
            >
              <span className="block truncate text-caption font-medium">{option.label}</span>
              <span
                className={cn(
                  'block truncate text-caption',
                  on ? 'text-white/75' : 'text-white/50',
                )}
              >
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
