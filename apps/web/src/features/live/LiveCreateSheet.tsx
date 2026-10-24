/**
 * What happens when the `+` on the story rail is tapped.
 *
 * YouTube's create sheet, not a settings menu: two large cards side by side,
 * one per medium. Story keeps its existing composer; Live opens the live
 * camera. The red pulse dot on the Live card is the whole explanation of what
 * tapping it does - your friends hear about it the moment you start.
 */

import { CameraIcon, VideoIcon, cn } from '@pingo/ui';
import { PenLine } from 'lucide-react';

import { Sheet, SheetCancel } from '../../components/Sheet.js';

export function LiveCreateSheet({
  onPickStory,
  onPickLive,
  onPickNote,
  onClose,
}: {
  onPickStory: () => void;
  onPickLive: () => void;
  /** Instagram puts a note in the same chooser; absent hides the row. */
  onPickNote?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Create" onClose={onClose} hideTitle>
      <div className="mt-1 grid grid-cols-2 gap-2.5" role="group" aria-label="Create">
        <button
          type="button"
          onClick={onPickStory}
          className={cn(
            'focus-ring flex flex-col items-center gap-2 rounded-3xl border border-line/50 bg-sunken/50 px-3 py-6',
            'transition-transform duration-[160ms] ease-standard active:scale-[0.97]',
          )}
        >
          <span className="grid size-13 place-items-center rounded-full bg-brand-soft text-brand">
            <CameraIcon size={24} />
          </span>
          <span className="text-body font-semibold text-ink">Story</span>
          <span className="text-center text-caption leading-snug text-text-tertiary">
            Photos and clips, up for a day
          </span>
        </button>

        <button
          type="button"
          onClick={onPickLive}
          className={cn(
            'focus-ring relative flex flex-col items-center gap-2 overflow-hidden rounded-3xl px-3 py-6',
            'bg-ink text-white',
            'transition-transform duration-[160ms] ease-standard active:scale-[0.97]',
          )}
        >
          <span className="relative">
            <span className="grid size-13 place-items-center rounded-full bg-danger text-white">
              <VideoIcon size={24} />
            </span>
            <span className="absolute -top-0.5 -right-0.5 flex size-3.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-70" />
              <span className="relative inline-flex size-3.5 rounded-full border-2 border-ink bg-danger" />
            </span>
          </span>
          <span className="text-body font-semibold">Live</span>
          <span className="text-center text-caption leading-snug text-white/60">
            Go live - friends are notified
          </span>
        </button>
      </div>
      {onPickNote && (
        <button
          type="button"
          onClick={onPickNote}
          className="focus-ring mt-2.5 flex w-full items-center gap-3 rounded-3xl border border-line/50 bg-sunken/50 px-4 py-3.5 text-left transition-transform duration-[160ms] ease-standard active:scale-[0.98]"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#14161c] text-[#ff2d92]">
            <PenLine size={20} strokeWidth={2.2} />
          </span>
          <span className="min-w-0">
            <span className="block text-body font-semibold text-ink">Note</span>
            <span className="block text-caption leading-snug text-text-tertiary">A line or a song on your circle, up for a day</span>
          </span>
        </button>
      )}
      <SheetCancel onClick={onClose} />
    </Sheet>
  );
}
