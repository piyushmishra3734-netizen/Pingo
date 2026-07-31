import type { SharedHistory } from '@pingo/core';
import { ImageIcon, UsersIcon, cn } from '@pingo/ui';

/**
 * Shared With You - the PINGO part of a profile.
 *
 * Everything above it on this page is what the person is: their name, their
 * photo, their three posts. This is what the two of you are, and it is the
 * reason a PINGO profile is not a copy of somebody else's. The interesting fact
 * about a person you already know is the history, not the audience.
 *
 * ## Visible to exactly two people
 *
 * It is computed by `shared_with`, which takes one id and can only ever answer
 * about the caller. There is no version of this that a third person can see, by
 * construction rather than by a check in this file.
 *
 * ## Why a row is dropped rather than shown as zero
 *
 * "Mutual Groups 0" is a fact about nothing. Each line appears only when it has
 * something to say, and if none of them do the panel is absent entirely - which
 * is the honest state for two people who have just met.
 */

export function SharedWithPanel({ history }: { history: SharedHistory }) {
  const rows: { icon: React.ReactNode; label: string; value: string }[] = [];

  if (history.friendsSince) {
    rows.push({
      icon: <UsersIcon size={16} />,
      label: 'Friends since',
      value: new Date(history.friendsSince).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    });
  }

  if (history.mutualGroups > 0) {
    rows.push({
      icon: <UsersIcon size={16} />,
      label: 'Mutual groups',
      value: String(history.mutualGroups),
    });
  }

  if (history.photosShared > 0) {
    rows.push({
      icon: <ImageIcon size={16} />,
      label: 'Photos shared',
      value: String(history.photosShared),
    });
  }

  if (rows.length === 0) return null;

  return (
    <section
      aria-label="Shared with you"
      className={cn('mt-5 overflow-hidden rounded-xl bg-surface shadow-sm')}
    >
      <h2 className="px-4 pt-3.5 pb-1 text-caption font-medium text-text-tertiary uppercase">
        Shared with you
      </h2>

      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-4 py-3">
            <span className="shrink-0 text-text-tertiary" aria-hidden>
              {row.icon}
            </span>
            <dt className="min-w-0 flex-1 truncate text-body text-text-secondary">{row.label}</dt>
            <dd className="shrink-0 text-body font-medium text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
