import { linkify } from '@pingo/core';
import { cn } from '@pingo/ui';

/**
 * Message text with its links made clickable.
 *
 * ## Built as nodes, never as HTML
 *
 * The obvious implementation replaces URLs with `<a>` tags in a string and
 * hands the result to `dangerouslySetInnerHTML`. That turns every message into
 * markup the sender controls, so one person typing `<img onerror=…>` runs their
 * script in everybody else's chat. Segments come back as data and React makes
 * the elements, so a message can never be anything but text and anchors.
 *
 * ## Why the link colour depends on the bubble
 *
 * Outgoing bubbles are a saturated gradient; the brand colour on top of it is
 * unreadable. So links there are white and rely on the underline to say they
 * are links, which is the older and more reliable signal anyway.
 */

export interface MessageTextProps {
  body: string;
  /** Outgoing bubbles have a gradient behind them and need different colours. */
  mine: boolean;
  className?: string;
}

export function MessageText({ body, mine, className }: MessageTextProps) {
  const segments = linkify(body);

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            /*
             * `noopener` stops the opened page reaching back through
             * `window.opener`; `noreferrer` keeps this app's URL — which
             * contains a conversation id — out of the destination's logs.
             */
            rel="noopener noreferrer"
            // The bubble opens the context menu on long press and the row
            // navigates; neither should fire because a link was tapped.
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              'underline underline-offset-2 break-all',
              'transition-opacity duration-instant hover:opacity-80',
              mine ? 'text-white' : 'text-brand',
            )}
          >
            {segment.value}
          </a>
        ),
      )}
    </span>
  );
}
