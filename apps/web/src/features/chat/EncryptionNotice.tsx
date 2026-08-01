import { LockIcon, cn } from '@pingo/ui';

/**
 * Quiet encryption copy, WhatsApp-style.
 *
 * Two surfaces, one voice:
 * - `list`   footer under the chat list
 * - `thread` sits just above the composer (under the typing indicator)
 *
 * Professional, short, no marketing tone. Lock icon is the only chrome.
 */

export function EncryptionNotice({
  variant,
  className,
}: {
  variant: 'list' | 'thread';
  className?: string;
}) {
  if (variant === 'list') {
    return (
      <p
        className={cn(
          'flex items-center justify-center gap-1.5 px-6 pt-6 pb-4',
          'text-center text-caption leading-relaxed text-text-tertiary',
          className,
        )}
      >
        <LockIcon size={12} className="shrink-0 text-text-tertiary" aria-hidden />
        <span>Your personal messages are end-to-end encrypted</span>
      </p>
    );
  }

  return (
    <div
      className={cn(
        'flex justify-center px-4 pb-2',
        className,
      )}
    >
      <p
        className={cn(
          'inline-flex max-w-sm items-start gap-1.5 rounded-lg px-3 py-2',
          'bg-selected/70 text-center text-caption leading-snug text-text-secondary',
        )}
      >
        <LockIcon
          size={12}
          className="mt-0.5 shrink-0 text-brand/70"
          aria-hidden
        />
        <span>
          Messages are end-to-end encrypted. Only people in this chat can read
          them.
        </span>
      </p>
    </div>
  );
}
