import { formatFileSize, formatTime, type Message } from '@pingo/core';
import {
  CheckDoubleIcon,
  CheckIcon,
  FileIcon,
  PingoDot,
  cn,
} from '@pingo/ui';

import { SnapBubble } from './SnapBubble.js';
import { VoiceNote } from './VoiceNote.js';

/**
 * A message bubble.
 *
 * Outgoing messages carry the brand gradient; incoming ones sit on Soft White.
 * That single asymmetry is enough to tell the two apart, so neither needs an
 * avatar, a name, or an alignment marker beside it.
 *
 * Corner shaping does the grouping work: a run of messages from one author keeps
 * square-ish corners where it meets its neighbours and rounds fully at the ends,
 * so a cluster reads as one utterance. The timestamp appears once per cluster,
 * on the last bubble — repeating it on every line is the fastest way to make a
 * thread look cluttered.
 */

export interface MessageBubbleProps {
  message: Message;
  mine: boolean;
  /** Position within its author cluster, which decides corner shaping. */
  position: 'single' | 'first' | 'middle' | 'last';
  /** Shown on the cluster's final bubble only. */
  showMeta: boolean;
}

/**
 * Corner radii per cluster position. The 6px inner corner is the "seam" — small
 * enough to read as joined, large enough to stay in the rounded design language.
 */
const SHAPE = {
  mine: {
    single: 'rounded-lg',
    first: 'rounded-lg rounded-br-[6px]',
    middle: 'rounded-lg rounded-r-[6px]',
    last: 'rounded-lg rounded-tr-[6px]',
  },
  theirs: {
    single: 'rounded-lg',
    first: 'rounded-lg rounded-bl-[6px]',
    middle: 'rounded-lg rounded-l-[6px]',
    last: 'rounded-lg rounded-tl-[6px]',
  },
} as const;

export function MessageBubble({ message, mine, position, showMeta }: MessageBubbleProps) {
  const voiceNote = message.attachments.find((a) => a.kind === 'audio');
  const file = message.attachments.find((a) => a.kind === 'file');
  const hasBody = message.body.trim().length > 0;

  // System notices are not bubbles at all — they are centred captions.
  if (message.system) {
    return (
      <div className="py-2 text-center">
        <span className="text-caption text-text-tertiary">{message.body}</span>
      </div>
    );
  }

  /*
   * A snap gets no bubble either, for the same reason: the picture *is* the
   * message. It is rounded and capped in height so a portrait shot cannot push
   * the rest of the thread off screen.
   */
  if (message.snap) {
    return (
      <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
        <div className="animate-bubble-in">
          <SnapBubble message={message} snap={message.snap} mine={mine} />
          <span className="mt-0.5 block text-caption text-text-tertiary">
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  /*
   * A sticker gets no bubble.
   *
   * The bubble exists to group text and mark who said it; a sticker is already
   * a distinct object with its own silhouette, and wrapping it in a coloured
   * rectangle makes it look like a pasted image rather than a sticker. Every
   * messaging product that ships stickers arrives at the same answer.
   */
  if (message.sticker) {
    return (
      <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
        <div className="animate-bubble-in">
          <img
            src={message.sticker.url}
            // `body` is the emoji fallback, which makes a real alt text.
            alt={message.body}
            draggable={false}
            className="size-32 select-none object-contain"
            onError={(event) => {
              // Pack gone, or offline. The emoji is a better fallback than a
              // broken-image icon, and it is already in `body`.
              const image = event.currentTarget;
              const text = document.createElement('span');
              text.className = 'text-[4rem] leading-none';
              text.textContent = message.body;
              image.replaceWith(text);
            }}
          />
          <span className="mt-0.5 block text-caption text-text-tertiary">
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'group relative max-w-[68%] min-w-0 animate-bubble-in',
          // Media-bearing bubbles need more room than a line of text.
          (voiceNote || file) && 'max-w-[85%] sm:max-w-[22rem]',
        )}
      >
        <div
          className={cn(
            'px-4 py-2.5',
            SHAPE[mine ? 'mine' : 'theirs'][position],
            mine
              ? 'bg-brand-gradient text-white shadow-brand'
              // Incoming bubbles are white on the near-white page, so they need a
              // shadow to read at all — Soft White against Background is only two
              // steps of luminance apart and disappears entirely without one.
              : 'bg-surface text-ink shadow-sm',
            // A failed send desaturates and outlines, rather than turning red.
            message.status === 'failed' && 'opacity-60 ring-1 ring-danger/40',
          )}
        >
          {voiceNote && (
            <VoiceNote
              attachment={voiceNote}
              tone={mine ? 'outgoing' : 'incoming'}
              className={cn(hasBody && 'mb-2')}
            />
          )}

          {file && (
            <div className={cn('flex items-center gap-3', hasBody && 'mb-2')}>
              <span
                className={cn(
                  'grid size-10 shrink-0 place-items-center rounded-md',
                  mine ? 'bg-white/20 text-white' : 'bg-surface text-brand',
                )}
                aria-hidden
              >
                <FileIcon size={20} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body">{file.fileName}</span>
                {file.size !== undefined && (
                  <span
                    className={cn(
                      'block text-caption',
                      mine ? 'text-white/70' : 'text-text-secondary',
                    )}
                  >
                    {formatFileSize(file.size)}
                  </span>
                )}
              </span>
            </div>
          )}

          {hasBody && (
            // `break-words` so a pasted URL cannot widen the bubble past its max.
            <p className="text-body break-words whitespace-pre-wrap">{message.body}</p>
          )}
        </div>

        {message.reactions.length > 0 && (
          <div
            className={cn(
              // Reactions straddle the bubble's lower edge, as on most platforms.
              'flex -mt-1.5 gap-1',
              mine ? 'justify-end pr-2' : 'justify-start pl-2',
            )}
          >
            {message.reactions.map((reaction) => (
              <span
                key={reaction.emoji}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full',
                  'bg-surface px-2 py-0.5 shadow-sm',
                  'text-caption',
                )}
              >
                <span aria-hidden>{reaction.emoji}</span>
                {reaction.userIds.length > 1 && (
                  <span className="text-text-secondary tabular-nums">
                    {reaction.userIds.length}
                  </span>
                )}
                <span className="sr-only">
                  {reaction.emoji} from {reaction.userIds.length} person
                  {reaction.userIds.length === 1 ? '' : 's'}
                </span>
              </span>
            ))}
          </div>
        )}

        {showMeta && (
          <div
            className={cn(
              'mt-1 flex items-center gap-1 px-1',
              mine ? 'justify-end' : 'justify-start',
            )}
          >
            <span className="text-caption text-text-tertiary">
              {formatTime(message.createdAt)}
            </span>

            {message.editedAt && (
              <span className="text-caption text-text-tertiary">· edited</span>
            )}

            {mine && <DeliveryIndicator status={message.status} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Delivery state, as the board's double-check.
 *
 * Only `read` is brand-coloured. Earlier states stay grey so the eye is drawn to
 * the one transition that carries meaning for the sender: they've seen it.
 */
function DeliveryIndicator({ status }: { status: Message['status'] }) {
  if (status === 'sending') {
    return <PingoDot state="loading" size={3} label="Sending" className="ml-0.5" />;
  }

  if (status === 'failed') {
    return <span className="text-caption text-danger">Not sent</span>;
  }

  if (status === 'read') {
    return <CheckDoubleIcon size={14} className="text-brand" title="Read" />;
  }

  if (status === 'delivered') {
    return <CheckDoubleIcon size={14} className="text-text-tertiary" title="Delivered" />;
  }

  return <CheckIcon size={14} className="text-text-tertiary" title="Sent" />;
}
