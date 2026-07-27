import { cn } from '@pingo/ui';
import { useEffect, useMemo, useState } from 'react';

import { SnapEditor } from '../camera/SnapEditor.js';

/**
 * Reviewing pictures before they are sent.
 *
 * ## One at a time, with the rest on a shelf
 *
 * Multi-select is normal — nobody picks one holiday photo — but editing several
 * at once is not a thing anyone does. So the batch is a filmstrip and exactly
 * one picture is being worked on, which keeps the editor identical to the
 * single-photo case rather than growing a second mode for "many".
 *
 * ## The caption belongs to the batch, not the picture
 *
 * WhatsApp attaches one caption per image; this attaches one to the send. Three
 * photos of the same thing want one sentence about them, and asking three times
 * is three chances to leave two blank. A per-photo caption is a reasonable thing
 * to want later, and the shape here does not prevent it.
 *
 * ## View limit is a property of the send
 *
 * "Keep in chat" or "View once" — the same control the schema models, so there
 * is no separate disappearing-photo feature with rules of its own.
 */

export interface PhotoComposerProps {
  files: File[];
  onCancel: () => void;
  /** Called once per picture, in order, with the flattened result. */
  onSend: (photos: Blob[], caption: string, viewLimit: number | undefined) => Promise<void>;
}

export function PhotoComposer({ files, onCancel, onSend }: PhotoComposerProps) {
  /** Object URLs, made once per file and revoked together. */
  const sources = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => sources.forEach(URL.revokeObjectURL), [sources]);

  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState('');
  const [once, setOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /**
   * Pictures already flattened, by position.
   *
   * Kept so moving along the filmstrip and back does not lose the drawing on
   * the one you left — the editor is remounted per picture, and its state goes
   * with it.
   */
  const [edited, setEdited] = useState<Record<number, Blob>>({});

  const last = index === sources.length - 1;

  const finish = async (blob: Blob) => {
    const all = { ...edited, [index]: blob };
    setEdited(all);

    if (!last) {
      setIndex((i) => i + 1);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      /*
       * Every picture, in the order they were chosen. Any the user skipped past
       * without editing are flattened by the editor anyway, because reaching
       * the end means each one went through it.
       */
      const blobs = sources.map((_, position) => all[position]).filter(Boolean) as Blob[];
      await onSend(blobs, caption.trim(), once ? 1 : undefined);
    } catch {
      setError('Those did not send. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-500 bg-ink">
      <SnapEditor
        // Remounted per picture, so strokes and text never bleed across.
        key={index}
        src={sources[index]!}
        onCancel={onCancel}
        onDone={(blob) => void finish(blob)}
        busy={busy}
        doneLabel={last ? (sources.length > 1 ? 'Send all' : 'Send') : 'Next photo'}
        extras={
          <div className="space-y-2">
            {error && (
              <p role="alert" className="text-center text-caption text-danger">
                {error}
              </p>
            )}

            {sources.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {sources.map((src, position) => (
                  <button
                    key={src}
                    type="button"
                    aria-label={`Photo ${position + 1} of ${sources.length}`}
                    aria-current={position === index}
                    // Only backwards: going forward is what the confirm button
                    // does, and it is the thing that flattens the current edit.
                    disabled={position > index}
                    onClick={() => setIndex(position)}
                    className={cn(
                      'focus-ring size-12 shrink-0 overflow-hidden rounded-lg',
                      'ring-2 transition-[opacity,box-shadow] duration-instant',
                      position === index ? 'ring-white' : 'ring-white/20',
                      position > index && 'opacity-40',
                    )}
                  >
                    <img src={src} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Add a caption"
              aria-label="Caption"
              maxLength={1000}
              className={cn(
                'focus-ring w-full rounded-full border border-white/20 bg-white/10',
                'px-4 py-2.5 text-body text-white placeholder:text-white/50',
              )}
            />

            <button
              type="button"
              role="switch"
              aria-checked={once}
              onClick={() => setOnce((was) => !was)}
              className={cn(
                'focus-ring flex w-full items-center justify-between rounded-full',
                'border border-white/20 px-4 py-2.5 text-left',
                'transition-colors duration-instant',
                once ? 'bg-white/20' : 'bg-transparent',
              )}
            >
              <span className="text-body text-white">View once</span>
              <span className="text-caption text-white/60">
                {once ? 'Opens once, then gone' : 'Stays in the chat'}
              </span>
            </button>
          </div>
        }
      />
    </div>
  );
}
