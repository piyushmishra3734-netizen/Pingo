import { formatFileSize, useChat, type FileAttachment, type VideoEdit } from '@pingo/core';
import { FileIcon, cn } from '@pingo/ui';
import { useState } from 'react';

import { saveImage } from '../native/save-image.js';
import { saveVideoBlob } from '../native/save-video.js';
import { useOfflineVideo } from './useOfflineVideo.js';
import { storedVideo } from './video-vault.js';
import { VideoPlayer } from './VideoPlayer.js';
import { ImageViewer } from '../profile/ImageViewer.js';

/**
 * An attached file, rendered as whatever it actually is.
 *
 * ## Why a filename was not enough
 *
 * Everything that is not a photo or a voice note arrives here as `kind: 'file'`
 * - a PDF, a spreadsheet, and also a video and an image somebody sent through
 * the document picker instead of the camera. All of them rendered as the same
 * grey card with a name on it, so a video you were sent was a download, and a
 * picture you were sent was a filename. The card is right for a document and
 * wrong for the two kinds that can simply be shown.
 *
 * ## The mime type decides, not the extension
 *
 * A name can lie or be missing; the stored type is what the upload actually
 * declared. Anything unrecognised falls through to the card, which is the safe
 * end of the branch: a document that will not play is normal, a video rendered
 * as a broken player is not.
 */

export interface FileBubbleProps {
  file: FileAttachment;
  mine: boolean;
  /** Extra bottom margin when a caption follows. */
  spaced?: boolean;
  /**
   * The message this file arrived on.
   *
   * Needed only by video, and only to tell the server the copy is safely here -
   * the receipt is keyed on the message, not on the attachment.
   */
  messageId?: string;
  /** Playback marks the sender chose. Applied by the player, never to the file. */
  edit?: VideoEdit;
}

/** Stops the bubble's own tap, which opens the reaction bar. */
const swallow = {
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
};

export function FileBubble({ file, mine, spaced, messageId, edit }: FileBubbleProps) {
  const [viewing, setViewing] = useState(false);
  const [saved, setSaved] = useState(false);

  const mime = file.mimeType;
  const name = file.fileName || 'File';

  if (mime.startsWith('video/') && file.url) {
    return (
      <VideoBubble file={file} name={name} spaced={spaced} messageId={messageId} edit={edit} />
    );
  }

  if (mime.startsWith('image/') && file.url) {
    return (
      <div className={cn('w-full', spaced && 'mb-2')} {...swallow}>
        <button
          type="button"
          onClick={() => setViewing(true)}
          aria-label={`Open image: ${name}`}
          className={cn(
            'focus-ring block w-full overflow-hidden rounded-lg',
            'transition-transform duration-instant active:scale-[0.99]',
          )}
        >
          <img
            src={file.url}
            alt={name}
            onContextMenu={(event) => event.preventDefault()}
            className="max-h-[22rem] w-full rounded-lg object-cover"
          />
        </button>

        {viewing && (
          <ImageViewer
            src={file.url}
            alt={name}
            onClose={() => {
              setViewing(false);
              setSaved(false);
            }}
            footer={
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    void fetch(file.url)
                      .then((response) => response.blob())
                      .then(async (blob) => {
                        if (await saveImage(blob, name)) setSaved(true);
                      })
                      .catch(() => undefined);
                  }}
                  className={cn(
                    'focus-ring rounded-full px-5 py-2.5',
                    'bg-white/12 text-body text-white backdrop-blur-glass',
                    'transition-transform duration-instant active:scale-95',
                  )}
                >
                  {saved ? 'Saved to your photos' : 'Save'}
                </button>
              </div>
            }
          />
        )}
      </div>
    );
  }

  return (
    /*
     * A file you cannot open is a filename.
     *
     * `download` asks for the original name back, because the storage key is a
     * uuid and saving `9f3c-…` helps nobody.
     */
    <a
      href={file.url}
      download={name}
      target="_blank"
      rel="noopener noreferrer"
      {...swallow}
      className={cn(
        'focus-ring -m-1 flex items-center gap-3 rounded-lg p-1',
        'transition-opacity duration-instant hover:opacity-80',
        spaced && 'mb-2',
      )}
    >
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
        <span className="block truncate text-body">{name}</span>
        {file.size !== undefined && (
          <span
            className={cn('block text-caption', mine ? 'text-white/70' : 'text-text-secondary')}
          >
            {formatFileSize(file.size)}
          </span>
        )}
      </span>
    </a>
  );
}

/**
 * A received video, played from this device once it has been copied here.
 *
 * Split out from `FileBubble` because it needs state and `FileBubble` is a
 * branch table - the hook cannot live behind an `if` that returns early for
 * every other kind of file.
 *
 * The badge is not decoration. PINGO deletes its own copy as soon as everyone
 * has one, so "Saved on this device" is the difference between a video that
 * will still play on a plane and one that will not, and that is worth a line
 * of text the moment it becomes true.
 */
function VideoBubble({
  file,
  name,
  spaced,
  messageId,
  edit,
}: {
  file: FileAttachment;
  name: string;
  spaced?: boolean;
  messageId?: string;
  /** Playback marks the sender chose. Applied by the player, never to the file. */
  edit?: VideoEdit;
}) {
  const { service } = useChat();
  /** The file's own shape, once it has told us. `4/5` until then. */
  const [ratio, setRatio] = useState<number>();
  const { src, offline } = useOfflineVideo(file.id, file.url, () => {
    if (messageId) void service.confirmMediaReceived?.(messageId).catch(() => undefined);
  });

  return (
    <div className={cn('w-full', spaced && 'mb-2')} {...swallow}>
      {/*
        PINGO's player, the same one a shared video link gets.

        This used to be the browser's `controls`, which was defensible while
        nothing better existed - it already had a scrubber and a fullscreen
        button. But a video somebody sent and a video somebody linked are the
        same thing to whoever is reading, and Chrome's grey strip on one of
        them and PINGO's controls on the other made them look like two
        different features.

        The box holds the shape while the player fills it absolutely; `4/5`
        is the guess until the file reports its own, which is the portrait
        clip most videos in a chat turn out to be.
      */}
      {/*
        A stated width, because nothing else here has one.

        The player fills this box absolutely and so contributes no intrinsic
        width, and a message bubble is sized to its contents - so `w-full`
        resolves against nothing at all. Two attempts to fix that with a
        *floor* both failed, and the second failed instructively: the floor
        became the size. 240px wide and 135px tall is not a video, it is a
        stamp, and at that height a tap aimed at the play button lands on the
        controls instead - which is why it appeared not to play inline while
        playing perfectly in fullscreen.

        So the box states a width outright. `22rem` is roughly the image
        bubble's presence on a desktop thread, and `72vw` keeps it a bubble
        rather than the whole column on a phone.

        Inline rather than a utility: `min-w-[14rem]` was tried first and never
        reached the built stylesheet, so the class sat on the element doing
        nothing. A value the layout depends on should not be able to vanish
        between the source and the build - which is why `aspectRatio` was
        always inline too.
      */}
      <div
        className="relative w-full overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: String(ratio ?? 4 / 5), width: 'min(22rem, 72vw)' }}
      >
        {src && (
          <VideoPlayer
            src={src}
            edit={edit}
            onShape={(shape) => setRatio(Math.min(Math.max(shape, 9 / 16), 16 / 9))}
          />
        )}
      </div>
      {/*
        Two different meanings of "saved", and both belong here.

        The badge is about PINGO: the vault has a copy, so this plays with the
        network off and the server may drop its own. The button is about the
        phone: put it in the gallery, where it sits beside everything else the
        camera took. Having the first is why the second costs no download.
      */}
      <div className="flex items-center gap-2 pt-1">
        {offline && (
          <p className="min-w-0 flex-1 truncate text-caption text-text-tertiary">
            Saved on this device
          </p>
        )}
        <GallerySave messageId={messageId} name={name} ready={offline} />
      </div>
    </div>
  );
}

/**
 * Puts a received video in the phone's gallery.
 *
 * The bytes are already here - the vault fetched them when the message
 * arrived - so this is a copy from one local place to another and needs no
 * network at all. That is why it only appears once `ready`: before the vault
 * has finished there is nothing to copy, and a button that would have to
 * download first is a different, slower promise than this one makes.
 */
function GallerySave({
  messageId,
  name,
  ready,
}: {
  messageId?: string;
  name: string;
  ready: boolean;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  if (!messageId || !ready) return null;

  const label =
    state === 'idle' ? 'Save' : state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : "Couldn't save";

  return (
    <button
      type="button"
      disabled={state !== 'idle'}
      onClick={() => {
        setState('saving');
        void storedVideo(messageId).then(async (blob) => {
          // Gone from the vault between the badge appearing and this press -
          // evicted under storage pressure. Nothing to copy, and saying so
          // beats a button that silently does nothing.
          if (!blob) return setState('failed');
          setState((await saveVideoBlob(blob, name)) ? 'saved' : 'failed');
        });
      }}
      className={cn(
        'focus-ring shrink-0 rounded-full px-2 py-0.5 text-caption font-medium',
        state === 'failed' ? 'text-danger' : state === 'saved' ? 'text-text-tertiary' : 'text-brand',
      )}
    >
      {label}
    </button>
  );
}
