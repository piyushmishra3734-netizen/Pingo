import { cn } from '@pingo/ui';

import { useT } from '../i18n/useT.js';

/**
 * Quiet in-thread boundary between older and newly arrived messages.
 *
 * One per "away" session. Fade only - no slide - so it sits like a day
 * divider rather than a banner.
 */
export function NewMessagesDivider({ className }: { className?: string }) {
  const t = useT();
  return (
    <div
      role="separator"
      aria-label={t('thread.newMessages')}
      className={cn(
        'flex items-center gap-3 py-3',
        'motion-safe:animate-[fade-in_var(--duration-quick)_var(--ease-standard)_both]',
        className,
      )}
    >
      <span className="h-px min-w-0 flex-1 bg-divider" aria-hidden />
      <span className="shrink-0 text-caption text-text-tertiary">{t('thread.newMessages')}</span>
      <span className="h-px min-w-0 flex-1 bg-divider" aria-hidden />
    </div>
  );
}
