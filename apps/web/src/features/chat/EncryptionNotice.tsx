import { LockIcon, cn } from '@pingo/ui';

import { useT } from '../i18n/useT.js';

/**
 * Quiet line under the typing indicator in a thread.
 *
 * Short on purpose: lock + "End-to-end encrypted". No list footer, no long
 * legal sentence - same beat as WhatsApp's small trust line.
 */

export function EncryptionNotice({ className }: { className?: string }) {
  const t = useT();
  return (
    <p
      className={cn(
        'flex items-center justify-center gap-1 px-4 pt-2 pb-1',
        'text-center text-caption text-text-tertiary',
        className,
      )}
    >
      <LockIcon size={11} className="shrink-0 text-text-tertiary" aria-hidden />
      <span>{t('thread.e2ee')}</span>
    </p>
  );
}
