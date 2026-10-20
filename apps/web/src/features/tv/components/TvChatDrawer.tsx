import { MessageCircle, X } from 'lucide-react';
import { useEffect } from 'react';

import { cn } from '@pingo/ui';
import { TvWatchChat } from './TvWatchChat.js';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The friend being watched along with, so the chat opens on theirs. */
  alongId?: string;
  /**
   * `browse` is a sheet over the whole Pingo TV page (a bottom sheet on a
   * phone, a drawer on a laptop). `overlay` is a small card in the corner of the
   * picture while it is full screen, so the film stays in view.
   */
  variant: 'browse' | 'overlay';
}

/** The same chat as the player's side panel, for the two places it has no panel. */
export function TvChatDrawer({ open, onClose, alongId, variant }: Props) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [open, onClose]);

  if (!open) return null;

  const panel = (
    <div
      role="dialog"
      aria-label="Chat"
      className={cn(
        'flex min-h-0 flex-col bg-[#0d0e14] text-white shadow-2xl',
        variant === 'browse'
          ? 'h-[74dvh] w-full rounded-t-2xl border-t border-white/10 md:h-full md:w-[390px] md:rounded-none md:border-l md:border-t-0'
          : 'absolute bottom-3 right-3 z-40 h-[min(62%,340px)] w-[min(calc(100%-1.5rem),300px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0d0e14]/85 backdrop-blur-xl animate-fadeIn',
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
        <MessageCircle className="size-4 text-brand" />
        <h3 className="flex-1 text-[15px] font-bold">Chat</h3>
        <button type="button" aria-label="Close chat" onClick={onClose} className="grid size-8 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white">
          <X className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 [&>div]:!min-h-0">
        <TvWatchChat {...(alongId ? { alongId } : {})} />
      </div>
    </div>
  );

  if (variant === 'overlay') return panel;

  return (
    <div className="fixed inset-0 z-[215] flex items-end justify-center md:justify-end">
      <div className="absolute inset-0 bg-black/60 animate-fadeIn" onClick={onClose} aria-hidden />
      <div className="relative flex w-full md:h-full md:w-auto">{panel}</div>
    </div>
  );
}
