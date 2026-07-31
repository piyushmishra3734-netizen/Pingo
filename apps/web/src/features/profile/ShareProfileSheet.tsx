import { CheckIcon, LinkIcon, ShareIcon, cn } from '@pingo/ui';
import { useState } from 'react';

/**
 * Sharing a link to a profile.
 *
 * The sheet that used to live here - a plain black-on-white QR with a link
 * under it - has been replaced by `QrCodeSheet`, which is the branded surface
 * and carries the same three actions. What is left is the two pieces that had
 * nothing to do with the picture: the canonical form of a profile link, and the
 * inline share row the post viewer uses.
 *
 * Native share is the only one of the three that might be missing  - 
 * `navigator.share` is absent on most desktop browsers - so it falls back to
 * copying rather than being shown as a button that does nothing.
 */

/** The public form of a profile link. Deliberately the handle, not the id. */
export function profileLink(username: string): string {
  return `${window.location.origin}/profile/${username}`;
}

/** The same three actions, as a row of buttons. Used inside the post viewer. */
export function ShareLinkButton({
  link,
  label,
  className,
}: {
  link: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const go = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url: link });
        return;
      } catch {
        // Cancelled, or refused. Fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Nothing left to try, and nothing worth interrupting the user over.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void go()}
      aria-label={label}
      className={cn('focus-ring rounded-full p-2 transition-transform duration-instant active:scale-90', className)}
    >
      {copied ? <CheckIcon size={24} /> : <ShareIcon size={24} />}
    </button>
  );
}
