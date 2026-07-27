import { useChat, type Message, type PhotoRef } from '@pingo/core';
import { EyeIcon, ImageIcon, PingoDot, cn } from '@pingo/ui';
import { useState } from 'react';

import { MessageText } from './MessageText.js';

/**
 * A photo in the thread.
 *
 * ## Two shapes, one component
 *
 * An ordinary photo shows itself; a view-limited one shows a cover until it is
 * opened, because the whole point of a limit is that seeing it costs something.
 * They are one component because they are one message kind — splitting them
 * would mean two bubbles that have to agree on caption, corners and timestamp.
 *
 * ## The picture is the message
 *
 * No bubble behind it, like snaps and stickers: a photo wrapped in a coloured
 * rectangle reads as an attachment to something, and there is nothing else
 * here. The caption sits underneath in its own small bubble when there is one.
 */

export interface PhotoBubbleProps {
  message: Message;
  photo: PhotoRef;
  mine: boolean;
}

export function PhotoBubble({ message, photo, mine }: PhotoBubbleProps) {
  const { service } = useChat();

  /** Filled once a limited photo has been opened. Unlimited ones start with it. */
  const [url, setUrl] = useState(photo.url);
  const [viewsLeft, setViewsLeft] = useState(photo.viewsLeft);
  const [opening, setOpening] = useState(false);
  const [spent, setSpent] = useState(false);

  const caption = message.body.trim();
  const limited = photo.viewLimit !== undefined;

  const open = async () => {
    if (opening || url) return;
    setOpening(true);
    try {
      const view = await service.openPhoto(message.id);
      // Undefined means the views are used up, which reads the same as never
      // having had any — the thread does not explain which.
      if (!view) setSpent(true);
      else {
        setUrl(view.url);
        setViewsLeft(view.viewsLeft);
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
      <div className="animate-bubble-in max-w-[72%] min-w-0">
        {url ? (
          <img
            src={url}
            alt={caption || 'Photo'}
            className={cn(
              'max-h-[22rem] w-full rounded-lg object-cover',
              // A limited photo that is currently open is ringed, so it is
              // obvious this is the version that goes away.
              limited && 'ring-2 ring-brand',
            )}
          />
        ) : !limited ? (
          /*
           * An unlimited photo with no URL is one whose signing has not landed
           * — a slow round trip, or one that failed. It is emphatically not a
           * view-once cover, which is what it used to render: an ordinary photo
           * inviting you to spend a view it does not have.
           */
          <div
            className={cn(
              'grid h-40 w-56 place-items-center rounded-lg',
              'border border-line bg-surface',
            )}
          >
            <PingoDot state="loading" size={5} label="Loading photo" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void open()}
            disabled={spent || opening}
            className={cn(
              'focus-ring grid h-40 w-56 place-items-center rounded-lg',
              'border border-line bg-surface',
              'transition-colors duration-instant',
              !spent && 'hover:bg-hover',
            )}
          >
            <span className="flex flex-col items-center gap-2 text-text-secondary">
              {opening ? (
                <PingoDot state="loading" size={5} label="Opening" />
              ) : (
                <>
                  {spent ? <ImageIcon size={22} /> : <EyeIcon size={22} />}
                  <span className="text-caption">
                    {spent
                      ? 'Photo expired'
                      : mine
                        ? 'View once — tap to see yours'
                        : 'Tap to view once'}
                  </span>
                </>
              )}
            </span>
          </button>
        )}

        {/*
          Only for the recipient, and only while it means something. Telling the
          sender how many views *they* have left is nonsense — their own photo
          never counts against the limit.
        */}
        {limited && !mine && viewsLeft !== undefined && viewsLeft > 0 && (
          <p className="mt-1 text-caption text-text-tertiary">
            {viewsLeft} view{viewsLeft === 1 ? '' : 's'} left
          </p>
        )}

        {caption && (
          <p
            className={cn(
              'mt-1 rounded-lg px-3 py-2 text-body break-words whitespace-pre-wrap',
              mine ? 'bg-brand-gradient text-white' : 'bg-surface text-ink shadow-sm',
            )}
          >
            <MessageText body={caption} mine={mine} />
          </p>
        )}
      </div>
    </div>
  );
}
