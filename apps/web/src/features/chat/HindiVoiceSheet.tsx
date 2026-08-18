import { cn } from '@pingo/ui';

import { useState } from 'react';

import { loadKokoro } from './kokoro.js';

/**
 * The one time somebody is asked about the 88 MB.
 *
 * ## Why there is a dialog at all
 *
 * The server voice cannot read Devanagari - it is English-only and answers
 * Hindi with a silent file - so a Hindi reply has nowhere to go unless the
 * device has a Hindi voice, and most do not. The engine that fixes it is 88 MB.
 *
 * Downloading that without asking, on a phone, on mobile data, is not a
 * decision to make on somebody's behalf. So it is asked once, the number is
 * stated in the first line rather than buried, and "not now" is a real answer
 * that leaves everything working exactly as it did.
 *
 * ## Why the number is repeated during the download
 *
 * 88 MB with a bar that only moves is a download people cancel around the
 * halfway mark, because there is no way to tell whether it is nearly done or
 * barely started. The percentage is the difference between waiting and giving
 * up.
 */

export interface HindiVoiceSheetProps {
  /** Dismissed, downloaded or not. */
  onClose: () => void;
  /** The download finished and Hindi can be spoken now. */
  onReady: () => void;
}

export function HindiVoiceSheet({ onClose, onReady }: HindiVoiceSheetProps) {
  const [progress, setProgress] = useState<number>();
  const [failed, setFailed] = useState(false);

  const downloading = progress !== undefined && !failed;

  const start = async () => {
    setFailed(false);
    setProgress(0);
    try {
      await loadKokoro(setProgress);
      onReady();
      onClose();
    } catch {
      // A dropped connection is the ordinary reason. Retrying is the ordinary
      // answer, so the button comes back rather than the sheet closing.
      setFailed(true);
      setProgress(undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
      <div className="bg-surface w-full max-w-sm rounded-2xl p-6">
        <h2 className="text-body font-medium text-ink">Hindi ki awaaz</h2>

        <p className="text-caption text-text-secondary mt-2">
          {/*
            The cost is the first thing said, and what it buys is the second.
            The other order is how people end up surprised by a bill or a data
            cap.
          */}
          Hindi bolne ke liye ek voice engine chahiye — <strong>88 MB</strong>, ek
          baar. Uske baad wo is device pe hi chalti hai: koi internet nahi, koi
          kharcha nahi.
        </p>

        <p className="text-caption text-text-tertiary mt-2">
          Abhi English aur Hinglish wali replies bina iske bhi bolti hain. Ye
          sirf Devanagari ke liye hai.
        </p>

        {downloading && (
          <div className="mt-4">
            <div className="bg-sunken h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-brand h-full rounded-full transition-[width] duration-instant"
                style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
              />
            </div>
            <p className="text-caption text-text-tertiary mt-2">
              {Math.round((progress ?? 0) * 100)}% — chalta rahega agar app khula rahe
            </p>
          </div>
        )}

        {failed && (
          <p className="text-caption text-danger mt-3">
            Download poora nahi hua. Dobara try karein?
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={downloading}
            className={cn(
              'focus-ring rounded-lg px-4 py-2 text-caption text-text-secondary',
              'hover:bg-hover disabled:opacity-40',
            )}
          >
            Abhi nahi
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={downloading}
            className={cn(
              'focus-ring bg-brand rounded-lg px-4 py-2 text-caption text-white',
              'transition-transform duration-instant active:scale-95 disabled:opacity-40',
            )}
          >
            {failed ? 'Phir se' : downloading ? 'Aa raha hai…' : 'Download karo'}
          </button>
        </div>
      </div>
    </div>
  );
}
