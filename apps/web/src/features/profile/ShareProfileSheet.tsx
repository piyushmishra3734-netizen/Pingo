import { CheckIcon, LinkIcon, ShareIcon, cn } from '@pingo/ui';
import { useMemo, useState } from 'react';

import { Sheet, SheetCancel, SheetItem } from './Sheet.js';
import { encodeQr, qrPath } from './qr.js';

/**
 * Sharing a profile: a code to point a camera at, a link to paste, and the
 * device's own share sheet where there is one.
 *
 * Three ways rather than one because they are three different situations. The
 * QR is for someone standing next to you. The copied link is for pasting into
 * something PINGO knows nothing about. Native share is for everything else, and
 * it is the only one that might be missing — `navigator.share` is absent on most
 * desktop browsers, so it is offered only when it exists rather than shown as a
 * button that does nothing.
 */

/** The public form of a profile link. Deliberately the handle, not the id. */
export function profileLink(username: string): string {
  return `${window.location.origin}/profile/${username}`;
}

export function ShareProfileSheet({
  username,
  displayName,
  onClose,
}: {
  username: string;
  displayName: string;
  onClose: () => void;
}) {
  const link = profileLink(username);
  const [copied, setCopied] = useState(false);

  /*
   * Encoded once per link. A profile link is short enough that this is well
   * under a millisecond, but it runs eight mask candidates and it would
   * otherwise repeat on every keystroke elsewhere in the tree.
   */
  const qr = useMemo(() => {
    try {
      const modules = encodeQr(link);
      return { size: modules.length, path: qrPath(modules) };
    } catch {
      // Only reachable for a link longer than version 6 can carry, which this
      // product cannot produce. The sheet still works without the picture.
      return undefined;
    }
  }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused. The link is on screen and selectable,
      // so there is still a way to take it.
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: displayName, url: link });
      onClose();
    } catch {
      // Cancelling the OS sheet rejects. Not an error, and not worth saying.
    }
  };

  return (
    <Sheet title="Share profile" description={`@${username}`} onClose={onClose}>
      {qr && (
        <div className="mt-4 flex justify-center">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <svg
              // The quiet zone is padding on the wrapper, so the viewBox is
              // exactly the code — no arithmetic to keep in step.
              viewBox={`0 0 ${qr.size} ${qr.size}`}
              className="block size-44"
              role="img"
              aria-label={`QR code for ${link}`}
              shapeRendering="crispEdges"
            >
              {/*
                Always black on white, in both themes. A QR code inverted for
                dark mode is unreadable to about half of the scanners in the
                world, and it is not worth finding out which half.
              */}
              <path d={qr.path} fill="#000" />
            </svg>
          </div>
        </div>
      )}

      <p className="mt-4 truncate rounded-lg bg-hover px-3 py-2.5 text-center text-caption text-text-secondary">
        {link}
      </p>

      <div className="mt-3 flex flex-col gap-1.5">
        <SheetItem
          icon={copied ? <CheckIcon size={20} className="text-online" /> : <LinkIcon size={20} />}
          label={copied ? 'Link copied' : 'Copy link'}
          onClick={() => void copy()}
        />

        {typeof navigator.share === 'function' && (
          <SheetItem icon={<ShareIcon size={20} />} label="Share…" onClick={() => void share()} />
        )}

        <SheetCancel onClick={onClose} label="Done" />
      </div>
    </Sheet>
  );
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
