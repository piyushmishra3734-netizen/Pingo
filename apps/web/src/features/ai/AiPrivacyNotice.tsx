import { InfoIcon, cn } from '@pingo/ui';

/**
 * Honesty without breaking the “person in chat” frame.
 *
 * AI threads are not end-to-end encrypted. This is a quiet caption-level card,
 * not a robot banner.
 */
export function AiPrivacyNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start justify-center gap-1.5 px-4 pt-2 pb-1',
        'text-center text-caption leading-snug text-text-tertiary',
        className,
      )}
    >
      <InfoIcon size={12} className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden />
      <span>Messages are processed to generate replies. Not end-to-end encrypted.</span>
    </p>
  );
}
