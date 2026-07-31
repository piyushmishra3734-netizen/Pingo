import { useProfile, type ReportReason } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useState } from 'react';

import { Sheet, SheetCancel } from '../../components/Sheet.js';

/**
 * Reporting someone, or one of their posts.
 *
 * ## Why the reasons are a fixed list
 *
 * A free-text box alone puts the whole job of classification on the person who
 * is already having a bad time, and produces a queue nobody can triage. A short
 * list of the things people actually report, with room to explain underneath,
 * is what makes a report actionable.
 *
 * ## Why it does not say what happens next
 *
 * There is no moderation queue in the product yet, and promising a review that
 * has no one behind it would be a lie printed in a dialog. The confirmation says
 * what is true: it has been recorded. Blocking is offered in the same breath,
 * because that is the part that takes effect immediately.
 */

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'spam', label: 'Spam', hint: 'Repeated or unwanted messages' },
  { value: 'harassment', label: 'Harassment or bullying', hint: 'Targeted at someone' },
  { value: 'nudity', label: 'Nudity or sexual content', hint: '' },
  { value: 'hate', label: 'Hate speech', hint: 'Attacks on a group of people' },
  { value: 'scam', label: 'Scam or fraud', hint: 'Trying to take money or details' },
  { value: 'other', label: 'Something else', hint: '' },
];

export function ReportSheet({
  subjectName,
  userId,
  postId,
  onClose,
  onBlock,
}: {
  subjectName: string;
  userId?: string;
  postId?: string;
  onClose: () => void;
  /** Offered after a report is filed. Absent when there is nobody to block. */
  onBlock?: () => void;
}) {
  const { service } = useProfile();

  const [reason, setReason] = useState<ReportReason>();
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await service.report({ userId, postId, reason, details });
      setSent(true);
    } catch {
      setError('That did not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Sheet title="Report sent" description="It has been recorded." onClose={onClose}>
        <p className="mt-3 text-body text-text-secondary">
          Nothing is shared with {subjectName} - they are not told a report was made.
        </p>

        <div className="mt-4 flex flex-col gap-1.5">
          {onBlock && (
            <button
              type="button"
              onClick={onBlock}
              className={cn(
                'focus-ring w-full rounded-lg px-4 py-3 text-left text-body text-danger',
                'transition-colors duration-instant hover:bg-hover active:bg-pressed',
              )}
            >
              Block {subjectName} as well
            </button>
          )}
          <SheetCancel onClick={onClose} label="Done" />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={postId ? 'Report this post' : `Report ${subjectName}`}
      description="Tell us what is wrong. They are not told about this."
      onClose={onClose}
    >
      <div className="mt-4 flex flex-col gap-1" role="radiogroup" aria-label="Reason">
        {REASONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={reason === option.value}
            onClick={() => setReason(option.value)}
            className={cn(
              'focus-ring flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left',
              'transition-colors duration-instant hover:bg-hover',
              reason === option.value && 'bg-hover',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full border-2',
                reason === option.value ? 'border-brand' : 'border-line',
              )}
            >
              {reason === option.value && <span className="size-2.5 rounded-full bg-brand" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body text-ink">{option.label}</span>
              {option.hint && (
                <span className="block text-caption text-text-secondary">{option.hint}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      <textarea
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        placeholder="Anything else we should know? (optional)"
        aria-label="More detail"
        rows={3}
        maxLength={1000}
        className={cn(
          'focus-ring mt-3 w-full resize-none rounded-lg border border-line bg-page',
          'px-3 py-2.5 text-body text-ink placeholder:text-text-tertiary',
        )}
      />

      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!reason || sending}
          className={cn(
            'focus-ring w-full rounded-full px-5 py-3 text-body font-medium',
            'bg-brand-gradient text-white shadow-brand',
            'transition-transform duration-instant active:scale-[0.98]',
            (!reason || sending) && 'opacity-50',
          )}
        >
          {sending ? 'Sending…' : 'Send report'}
        </button>
        <SheetCancel onClick={onClose} />
      </div>
    </Sheet>
  );
}
