import { useChat, type Message, type PhotoRef } from '@pingo/core';
import { EyeIcon, ImageIcon, PingoDot, cn } from '@pingo/ui';

import { useState } from 'react';

import { saveImage } from '../native/save-image.js';
import { ImageViewer } from '../profile/ImageViewer.js';
import { MessageText } from './MessageText.js';

/**
 * A photo in the thread.
 *
 * ## Two shapes, one component
 *
 * An ordinary photo shows itself; a view-limited one shows a cover until it is
 * opened, because the whole point of a limit is that seeing it costs something.
 * They are one component because they are one message kind - splitting them
 * would mean two bubbles that have to agree on caption, corners and timestamp.
 *
 * ## The picture is the message
 *
 * No bubble behind it, like Pings and stickers: a photo wrapped in a coloured
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

  /*
   * What opening a limited photo returned, and only that.
   *
   * This used to be `useState(photo.url)`, which reads the prop once and then
   * ignores it for the life of the component. A signed URL lasts an hour and a
   * thread stays mounted for longer, so a re-signed photo arriving in props was
   * dropped and the bubble went on showing a URL that had expired. Taking the
   * prop directly means the freshest signature always wins; the state is only
   * for the one thing props cannot know, which is that this reader has spent a
   * view.
   */
  const [opened, setOpened] = useState<{ url: string; viewsLeft?: number } | undefined>(
    undefined,
  );
  const url = opened?.url ?? photo.url;
  const viewsLeft = opened?.viewsLeft ?? photo.viewsLeft;
  const [opening, setOpening] = useState(false);
  const [spent, setSpent] = useState(false);
  /*
   * Whether the picture is open full screen.
   *
   * A photo in a thread was a flat image: no tap, no zoom, no way to save it.
   * Every other messenger opens one, and somebody who has been sent a picture
   * usually wants to look at it properly rather than at thumbnail size inside
   * a bubble.
   */
  const [viewing, setViewing] = useState(false);
  const [saved, setSaved] = useState(false);

  const caption = message.body.trim();
  const limited = photo.viewLimit !== undefined;

  const open = async () => {
    if (opening || url) return;
    setOpening(true);
    try {
      const view = await service.openPhoto(message.id);
      // Undefined means the views are used up, which reads the same as never
      // having had any - the thread does not explain which.
      if (!view) setSpent(true);
      else setOpened({ url: view.url, viewsLeft: view.viewsLeft });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
      {/* Same rule as every other bubble: it arrives from its own side. */}
      <div
        className={cn(
          'max-w-[72%] min-w-0',
          mine ? 'animate-bubble-in-mine' : 'animate-bubble-in',
        )}
      >
        {url ? (
          /*
           * A button, not a bare image.
           *
           * Tapping a photo to see it properly is the one interaction people
           * arrive already knowing, and it was the one thing this bubble did
           * not do. A button rather than a click handler on the image, so it
           * is reachable by keyboard and announced as something you can open.
           */
          <button
            type="button"
            onClick={() => setViewing(true)}
            aria-label={caption ? `Open photo: ${caption}` : 'Open photo'}
            className={cn(
              'focus-ring block w-full overflow-hidden rounded-lg',
              'transition-transform duration-instant active:scale-[0.99]',
            )}
          >
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
          </button>
        ) : !limited ? (
          /*
           * An unlimited photo with no URL is one whose signing has not landed
           * - a slow round trip, or one that failed. It is emphatically not a
           * view-once cover, which is what it used to render: an ordinary photo
           * inviting you to spend a view it does not have.
           */
          <div
            className={cn(
              'grid h-40 w-56 place-items-center rounded-lg',
              'glass-water',
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
              'glass-water',
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
                        ? 'View once, tap to see yours'
                        : 'Tap to view once'}
                  </span>
                </>
              )}
            </span>
          </button>
        )}

        {/*
          Only for the recipient, and only while it means something. Telling the
          sender how many views *they* have left is nonsense - their own photo
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
              mine ? 'bg-brand-glass text-white' : 'glass-water text-ink',
            )}
          >
            <MessageText body={caption} mine={mine} />
          </p>
        )}
      </div>

      {viewing && url && (
        <ImageViewer
          src={url}
          alt={caption || 'Photo'}
          onClose={() => {
            setViewing(false);
            // The next open starts from "Save" again. A button still reading
            // "Saved" for a photo you came back to later is answering a
            // question nobody asked.
            setSaved(false);
          }}
          footer={
            <div className="flex flex-col items-center gap-3">
              {caption && (
                <p className="max-w-lg text-center text-body text-white/85">{caption}</p>
              )}

              {/*
                No save on a photo with a view limit.

                The whole promise of one is that it goes away, and a download
                button beside it would be the product handing over the tool to
                break its own word. A screenshot is still possible - that is a
                phone, not something PINGO controls - but it is not something
                PINGO should offer.
              */}
              {!limited && (
                <button
                  type="button"
                  onClick={() => {
                    void fetch(url)
                      .then((response) => response.blob())
                      .then(async (blob) => {
                        // Named after what it is. A GIF saved as `.gif` still
                        // moves in the gallery; saved as `.jpg` it may not.
                        const kind = blob.type.split('/')[1]?.split(';')[0] ?? 'jpg';
                        const day = new Date(message.createdAt).toISOString().slice(0, 10);
                        const ok = await saveImage(
                          blob,
                          `pingo-${day}.${kind === 'jpeg' ? 'jpg' : kind}`,
                        );
                        if (ok) setSaved(true);
                      })
                      .catch(() => undefined);
                  }}
                  className={cn(
                    'focus-ring flex items-center gap-2 rounded-full px-5 py-2.5',
                    'bg-white/12 text-body text-white backdrop-blur-glass',
                    'transition-transform duration-instant active:scale-95',
                  )}
                >
                  {/* Says what happened rather than resetting to "Save" - a
                      button that forgets is a button people press twice. */}
                  {saved ? 'Saved to your photos' : 'Save'}
                </button>
              )}
            </div>
          }
        />
      )}
    </div>
  );
}
