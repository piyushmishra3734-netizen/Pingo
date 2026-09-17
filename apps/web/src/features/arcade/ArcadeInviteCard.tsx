import { cn } from '@pingo/ui';
import { Gamepad2, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import type { ArcadeInvite } from './arcade-link.js';

/**
 * A PINGO Arcade invite in the thread: who is asking, and one button that
 * walks you into their room. The link it came as is never shown.
 *
 * Your own copy has no button - it is your room already, and joining it from
 * the guest's seat would put you opposite yourself.
 */
export function ArcadeInviteCard({ invite, mine }: { invite: ArcadeInvite; mine: boolean }) {
  const navigate = useNavigate();
  const join = () => {
    const params = new URLSearchParams({ room: invite.room, seat: invite.seat, from: invite.from });
    navigate(`/arcade?${params.toString()}`);
  };

  return (
    <div className={cn('flex min-w-[14rem] flex-col gap-2.5 py-0.5')}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#ff4f8b,#7a3cff)] text-2xl shadow-[0_4px_14px_rgba(255,79,139,0.35)]"
        >
          <Gamepad2 size={24} strokeWidth={2} className="text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-body font-semibold">PINGO Arcade</p>
          <p className={cn('text-caption', mine ? 'text-white/80' : 'text-text-secondary')}>
            {mine ? 'You sent a game invite' : `${invite.from || 'A friend'} invited you to play`}
          </p>
        </div>
      </div>
      {mine ? null : (
        <button
          type="button"
          onClick={join}
          className="rounded-full bg-[linear-gradient(#ff5d97,#d92a6c)] px-4 py-2.5 text-body font-bold text-white shadow-[0_4px_14px_rgba(255,79,139,0.35)] active:scale-[0.97]"
        >
          <span className="inline-flex items-center gap-1.5">
            <Play size={16} strokeWidth={2.5} fill="currentColor" aria-hidden />
            Join game
          </span>
        </button>
      )}
    </div>
  );
}
