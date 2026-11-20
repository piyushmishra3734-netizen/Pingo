import { cn } from '@pingo/ui';
import { Gamepad2 } from 'lucide-react';

import type { ArcadeInvite } from './arcade-link.js';

/**
 * A PINGO Arcade invite in the thread: who asked. The Arcade is closed for
 * now, so there is no Join button - the card just says the game is not open,
 * rather than leading somewhere that sends you back.
 */
export function ArcadeInviteCard({ invite, mine }: { invite: ArcadeInvite; mine: boolean }) {
  return (
    <div className={cn('flex min-w-[14rem] flex-col gap-2.5 py-0.5')}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#ff4f8b,#7a3cff)] text-2xl opacity-60"
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
      <p className={cn('text-caption font-semibold', mine ? 'text-white/80' : 'text-text-secondary')}>
        The Arcade is closed for now
      </p>
    </div>
  );
}
