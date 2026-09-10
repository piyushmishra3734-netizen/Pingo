import { InviteView } from '../InviteScreen.js';

/**
 * The post-sign-in invitation, at `/dev/invite-lab`, with a made-up mission.
 *
 * The real screen needs a session and a mission still in progress, and sends
 * itself on to the chats otherwise - so without this there is no way to look at
 * it short of making a fresh account.
 */
export function InviteLab() {
  return (
    <InviteView
      progress={{
        missionId: 'lab',
        title: 'MYTHIC PIONEER',
        description: 'Refer 5 friends to unlock',
        badgeId: 'mythic_pioneer',
        referralCode: '7K2MQ9XP',
        count: 2,
        required: 5,
        friends: [],
        unlocked: false,
      }}
    />
  );
}
