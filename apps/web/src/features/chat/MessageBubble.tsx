import {
  formatEventTime,
  formatTime,
  useChat,
  type Message,
} from '@pingo/core';
import {
  CheckDoubleIcon,
  CheckIcon,
  PingoDot,
  cn,
} from '@pingo/ui';
import { useCallback } from 'react';

import {
  CallBubble,
  ContactBubble,
  EventBubble,
  LocationBubble,
} from './AttachmentBubbles.js';
import { FileBubble } from './FileBubble.js';
import { MessageText } from './MessageText.js';
import { PhotoBubble } from './PhotoBubble.js';
import { PingBubble } from './PingBubble.js';
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
 * on the last bubble - repeating it on every line is the fastest way to make a
 * thread look cluttered.
 */

export interface MessageBubbleProps {
  message: Message;
  mine: boolean;
  /** Position within its author cluster, which decides corner shaping. */
  position: 'single' | 'first' | 'middle' | 'last';
  /** Shown on the cluster's final bubble only. */
  showMeta: boolean;
  /**
   * Spread onto the bubble. Supplied by `MessageMenu`, which owns every way of
   * opening the context menu, docs/13 § 4.5.
   */
  trigger?: Record<string, unknown>;
  /** Reactions, rendered beneath. Passed in so the bubble stays presentational. */
  reactions?: React.ReactNode;
  /**
   * The message this one answers, already resolved by the thread.
   *
   * Absent when this is not a reply, or when the original is not in the loaded
   * page, the quote is then simply not drawn, because a placeholder saying
   * "message unavailable" is noise for something the reader can scroll to.
   */
  replyTo?: Message;
  /** Who wrote the quoted message. The bubble has no roster of its own. */
  replyToAuthor?: string;
  /** Tapping the quote goes to the original. Absent means the quote is inert. */
  onJumpToReply?: () => void;
}

/**
 * What a quoted message reads as in one line.
 *
 * A Ping or sticker has no text worth quoting, so it is named rather than shown
 * - quoting a sticker's emoji fallback would look like the person typed it.
 */
export function quoteText(message: Message): string {
  if (message.deleted) return 'This message was deleted';
  if (message.call) return message.call.callKind === 'video' ? 'Video call' : 'Voice call';
  if (message.location) return message.location.label ?? 'Location';
  if (message.contact) return message.contact.name;
  if (message.event) return message.event.title;
  if (message.photo) return message.body.trim() || 'Photo';
  if (message.ping) return 'Ping';
  if (message.sticker) return 'Sticker';
  if (message.attachments.some((a) => a.kind === 'audio')) return 'Voice message';
  return message.body.trim() || 'Attachment';
}

/**
 * Corner radii per cluster position. The 6px inner corner is the "seam" - small
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

export function MessageBubble({
  message,
  mine,
  position,
  showMeta,
  trigger,
  reactions,
  replyTo,
  replyToAuthor,
  onJumpToReply,
}: MessageBubbleProps) {
  const { service } = useChat();

  /*
   * Which way this bubble comes in from.
   *
   * Held once rather than branched at each of the five places a bubble is
   * rendered - a voice note, a photo, a sticker and a tombstone are all
   * bubbles, and they were all rising from below identically.
   */
  const arrive = mine ? 'animate-bubble-in-mine' : 'animate-bubble-in';

  const voiceNote = message.attachments.find((a) => a.kind === 'audio');
  const file = message.attachments.find((a) => a.kind === 'file');
  const hasBody = message.body.trim().length > 0;

  const resolveVoiceUrl = useCallback(
    async (path: string) => {
      if (!service.signVoiceUrl) return undefined;
      return service.signVoiceUrl(path);
    },
    [service],
  );

  /*
   * Deleted, and said so.
   *
   * WhatsApp's answer, and the right one: the bubble stays on its author's side
   * at its place in time, because "something was here and is gone" is itself
   * information - silently removing the message would edit the past instead.
   * Italic and muted so it never reads as text somebody wrote.
   */
  if (message.deleted) {
    return (
      <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
        <div
          id={`message-${message.id}`}
          className={cn(
            'max-w-[68%] px-4 py-2.5', arrive,
            SHAPE[mine ? 'mine' : 'theirs'][position],
            'border border-line bg-surface',
          )}
        >
          <p className="text-body italic text-text-tertiary">
            {mine ? 'You deleted this message' : 'This message was deleted'}
          </p>
          {/*
            The deletion's own time, not the send time, and labelled.
            The tombstone keeps its original place in the thread, so an
            unlabelled later time would read as a message out of sequence  - 
            "Deleted" is what makes it a different kind of fact.
          */}
          <span
            className="mt-1 block text-caption text-text-tertiary"
            title={`Sent ${formatTime(message.createdAt)}`}
          >
            Deleted {formatEventTime(message.deletedAt ?? message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  // System notices are not bubbles at all - they are centred captions.
  if (message.system) {
    return (
      <div className="py-2 text-center">
        <span className="text-caption text-text-tertiary">{message.body}</span>
      </div>
    );
  }

  /*
   * The three card kinds. Each *is* the whole message, so like a photo they
   * replace the bubble rather than sitting inside one.
   */
  if (message.location || message.contact || message.event || message.call) {
    return (
      <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
        <div
          id={`message-${message.id}`}
          /*
            These cards had no menu at all.

            Every branch that replaces the bubble - a location, a contact, an
            event, a call, a photo, a Ping - returned its own markup and quietly
            dropped `trigger` on the way. So the one thing every message is
            supposed to offer, holding it to reply or delete it, worked on text
            and on nothing else. A shared location could not be deleted by its
            own sender.
          */
          {...trigger}
          className={cn(arrive, 'max-w-[72%] min-w-0', 'outline-none')}
        >
          {message.location && <LocationBubble location={message.location} mine={mine} />}
          {message.contact && <ContactBubble contact={message.contact} mine={mine} />}
          {message.event && <EventBubble event={message.event} mine={mine} />}
          {message.call && <CallBubble call={message.call} mine={mine} outgoing={mine} />}
          {showMeta && (
            <span className="mt-1 block text-caption text-text-tertiary">
              {formatTime(message.createdAt)}
            </span>
          )}
        </div>
      </div>
    );
  }

  /*
   * A photo is the message, so it gets no bubble either - its caption gets one
   * of its own underneath. Before the Ping branch because the two are mutually
   * exclusive and this is the commoner of the pair.
   */
  if (message.photo) {
    return (
      // Wrapped rather than passed down: the trigger belongs to "this message",
      // not to the picture, and PhotoBubble already owns its own tap.
      <div id={`message-${message.id}`} {...trigger} className="w-full outline-none">
        <PhotoBubble message={message} photo={message.photo} mine={mine} />
      </div>
    );
  }

  /*
   * A Ping gets no bubble either, for the same reason: the picture *is* the
   * message. It is rounded and capped in height so a portrait shot cannot push
   * the rest of the thread off screen.
   */
  if (message.ping) {
    return (
      <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
        <div id={`message-${message.id}`} {...trigger} className={cn(arrive, 'outline-none')}>
          <PingBubble message={message} ping={message.ping} mine={mine} />
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
        <div className={arrive}>
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
        /*
          Jump-to-original scrolls to this. Without it that action silently does
          nothing, which is the failure mode hardest to notice.
        */
        id={`message-${message.id}`}
        // Every way of opening the menu lands here: press, right-click, keyboard.
        {...trigger}
        className={cn(
          'group relative max-w-[68%] min-w-0',
          arrive,
          // Focusable for the keyboard openers, never outlined by a press  - 
          // the menu appearing is the feedback.
          'outline-none',
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
              /*
                Incoming bubbles are glass, the same glass as the header and
                the composer.

                They were an opaque white card needing a shadow to be seen at
                all against a near-white page. With a wallpaper behind, that
                card is the one surface in the conversation that refuses to
                admit there is anything behind it - and one material used
                everywhere is what the whole look depends on. The sent bubble
                keeps the brand gradient: it is the mark that identifies PINGO
                at a glance, and it is the one thing worth not being glass.
              */
              : 'glass-surface text-ink',
            // A failed send desaturates and outlines, rather than turning red.
            message.status === 'failed' && 'opacity-60 ring-1 ring-danger/40',
          )}
        >
          {replyTo && (
            /*
             * The quote sits inside the bubble, tinted against it rather than
             * given its own colour: it is part of this message, not a second
             * one stacked above it. A left rule carries the "quoted" reading
             * without needing a label to say so.
             */
            <button
              type="button"
              onClick={onJumpToReply}
              disabled={!onJumpToReply}
              className={cn(
                'mb-1.5 flex w-full flex-col items-start gap-0.5 rounded-md',
                'border-l-2 px-2 py-1 text-left',
                'transition-opacity duration-instant',
                onJumpToReply && 'hover:opacity-80',
                /*
                  Tinted against the bubble it sits in, both sides. On an
                  incoming bubble that bubble is now glass, so a solid `bg-hover`
                  panel inside it was the one opaque rectangle left in the
                  conversation - a quote is part of this message, and it should
                  be made of the same thing the message is.
                */
                mine
                  ? 'border-white/60 bg-white/15 text-white/85'
                  : 'border-brand bg-white/22 text-text-secondary',
              )}
            >
              {replyToAuthor && (
                <span className="text-caption font-medium">{replyToAuthor}</span>
              )}
              <span className="line-clamp-2 text-caption break-words opacity-90">
                {quoteText(replyTo)}
              </span>
            </button>
          )}

          {voiceNote && (
            <VoiceNote
              attachment={voiceNote}
              tone={mine ? 'outgoing' : 'incoming'}
              className={cn(hasBody && 'mb-2')}
              resolveUrl={resolveVoiceUrl}
            />
          )}

          {file && <FileBubble file={file} mine={mine} spaced={hasBody} />}

          {hasBody && (
            // `break-words` so a pasted URL cannot widen the bubble past its max.
            <p className="text-body break-words whitespace-pre-wrap">
              <MessageText body={message.body} mine={mine} />
              {message.editedAt && (
                /*
                 * Inside the bubble, on the edited message itself - not with
                 * the cluster timestamp, which appears once per run and would
                 * leave three of four edited messages unmarked. Trailing the
                 * text is WhatsApp's placement and the reason it works: you
                 * read the change and the marker in one movement.
                 *
                 * It carries the edit's own time, so the bubble states both
                 * moments: the meta line below is when it was sent, this is
                 * when it changed. Neither is inferable from the other, and
                 * the second is the one that just happened.
                 */
                <span
                  title={`Sent ${formatTime(message.createdAt)}`}
                  className={cn(
                    'ml-1.5 align-baseline text-caption whitespace-nowrap',
                    mine ? 'text-white/70' : 'text-text-tertiary',
                  )}
                >
                  Edited {formatEventTime(message.editedAt)}
                </span>
              )}
            </p>
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

        {reactions}

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

            {/* "Edited" lives in the bubble now - see above. */}
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
