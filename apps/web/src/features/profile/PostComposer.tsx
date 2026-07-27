import { cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';

import { SnapEditor } from '../camera/SnapEditor.js';

import { Overlay } from '../../components/Overlay.js';

/**
 * Publishing a post: the picture, then the words.
 *
 * Reuses `SnapEditor` rather than growing a second editor. A post is a picture
 * somebody wants to look right, which is the same problem the camera already
 * solved — drawing, text, rotation, and a flatten at the end. Building a
 * separate one for profiles would mean two editors drifting apart, and the
 * second one always being the worse of the two.
 *
 * The caption sits in the editor's `extras` slot, where the chat photo composer
 * puts its own. Same position, same behaviour, nothing new to learn.
 */

export interface PostComposerProps {
  file: File;
  /** Shown on the confirm button, so "Replace" reads as a replacement. */
  confirmLabel?: string;
  /** Prefills when editing an existing post's picture. */
  initialCaption?: string;
  onCancel: () => void;
  onDone: (image: Blob, caption: string) => Promise<void>;
}

export function PostComposer({
  file,
  confirmLabel = 'Share',
  initialCaption = '',
  onCancel,
  onDone,
}: PostComposerProps) {
  const src = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  const [caption, setCaption] = useState(initialCaption);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const finish = async (blob: Blob) => {
    setBusy(true);
    setError(undefined);
    try {
      await onDone(blob, caption.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not post. Try again.');
      setBusy(false);
    }
  };

  return (
    <Overlay>
      <div className="fixed inset-0 z-500 bg-ink">
        <SnapEditor
          src={src}
          onCancel={onCancel}
          onDone={(blob) => void finish(blob)}
          busy={busy}
          doneLabel={confirmLabel}
          extras={
            <div className="space-y-2">
              {error && (
                <p role="alert" className="text-center text-caption text-danger">
                  {error}
                </p>
              )}

              <textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Write a caption"
                aria-label="Caption"
                rows={2}
                maxLength={2200}
                className={cn(
                  'focus-ring w-full resize-none rounded-lg border border-white/20 bg-white/10',
                  'px-4 py-2.5 text-body text-white placeholder:text-white/50',
                )}
              />
            </div>
          }
        />
      </div>
    </Overlay>
  );
}
