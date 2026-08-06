import { formatFileSize, type FileAttachment } from '@pingo/core';
import { FileIcon, cn } from '@pingo/ui';
import { useState } from 'react';

import { saveImage } from '../native/save-image.js';
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
}

/** Stops the bubble's own tap, which opens the reaction bar. */
const swallow = {
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
};

export function FileBubble({ file, mine, spaced }: FileBubbleProps) {
  const [viewing, setViewing] = useState(false);
  const [saved, setSaved] = useState(false);

  const mime = file.mimeType;
  const name = file.fileName || 'File';

  if (mime.startsWith('video/') && file.url) {
    return (
      <div className={cn('w-full', spaced && 'mb-2')} {...swallow}>
        {/*
          `controls` and nothing else.

          A custom player would need its own scrubber, its own fullscreen and
          its own answer for picture-in-picture on every platform. The built-in
          one already has all three, already matches what the phone does
          everywhere else, and its fullscreen button is the "video open ho"
          that was missing.

          `preload="metadata"` so the first frame and the duration are there
          without pulling the whole file down for a video nobody plays.
        */}
        <video
          src={file.url}
          controls
          preload="metadata"
          playsInline
          aria-label={name}
          className="max-h-[22rem] w-full rounded-lg bg-black object-contain"
        />
      </div>
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
