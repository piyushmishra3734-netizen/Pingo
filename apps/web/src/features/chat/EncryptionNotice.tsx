import { LockIcon, cn } from '@pingo/ui';

/**
 * Quiet line under the typing indicator in a thread.
 *
 * Short on purpose: lock + "End-to-end encrypted". No list footer, no long
 * legal sentence - same beat as WhatsApp's small trust line.
 */

export function EncryptionNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center justify-center gap-1 px-4 pt-2 pb-1',
        'text-center text-caption text-text-tertiary',
        className,
      )}
    >
      <LockIcon size={11} className="shrink-0 text-text-tertiary" aria-hidden />
      <span>End-to-end encrypted</span>
    </p>
  );
}
