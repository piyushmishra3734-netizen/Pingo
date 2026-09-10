import { useState } from 'react';

import { InviteView } from '../InviteScreen.js';

/**
 * The post-sign-in invitation, at `/dev/invite-lab`, with a made-up mission.
 *
 * The real screen needs a session and a mission still in progress, and sends
 * itself on to the chats otherwise - so without this there is no way to look at
 * it short of making a fresh account. The buttons change how many friends have
 * joined, because the row is the part that changes most.
 */
export function InviteLab() {
  const [count, setCount] = useState(2);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 bg-sunken px-4 py-2">
        {[0, 2, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setCount(n)}
            className={
              count === n
                ? 'rounded-md bg-brand px-3 py-1 text-caption font-medium text-on-brand'
                : 'rounded-md bg-surface px-3 py-1 text-caption font-medium text-text-secondary'
            }
          >
            {n} joined
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <InviteView
          key={count}
          progress={{
            missionId: 'lab',
            title: 'MYTHIC PIONEER',
            description: 'Refer 5 friends to unlock',
            badgeId: 'mythic_pioneer',
            referralCode: '7K2MQ9XP',
            count,
            required: 5,
            friends: [],
            unlocked: false,
          }}
        />
      </div>
    </div>
  );
}
