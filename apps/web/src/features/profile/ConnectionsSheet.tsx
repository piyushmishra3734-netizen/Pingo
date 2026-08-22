import { useChat, useProfile, type Conversation, type Profile } from '@pingo/core';
import { Avatar, LoadingState, UsersIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AchievementMark } from '../achievements/AchievementArt.js';
import { useAchievements } from '../achievements/useAchievements.js';
import { Sheet } from '../../components/Sheet.js';

/**
 * Who you are actually friends with, and which groups you are actually in.
 *
 * ## Why the number and the list can disagree
 *
 * The count on a profile can carry a display seed - see
 * `20260801120000_profile_display_seeds.sql`. A seed is a number, and a number
 * is all it is: there are no people behind it. So these lists are built from
 * rows and show exactly the real ones, which is the only honest thing a list
 * can do. Somebody comparing the two will find the list shorter, and that is
 * the right way round: the product would rather under-promise in the place
 * where names are named.
 *
 * ## Yours only
 *
 * Both open from your own profile and nowhere else. Who somebody is friends
 * with, and which groups they are in, is a map of their private life - a
 * follower list is a public thing on a public network, and this is neither.
 * Visiting another profile leaves the numbers as numbers.
 */

export function FriendsSheet({ onClose }: { onClose: () => void }) {
  const { service } = useProfile();
  const navigate = useNavigate();
  const [people, setPeople] = useState<Profile[]>();
  /* Every visible card in one query, same cache as everywhere else. */
  const cardAchievements = useAchievements((people ?? []).map((p) => p.id));

  useEffect(() => {
    let live = true;

    void service
      .listMutualIds()
      .then(async (ids) => {
        /*
         * One lookup each, which a friends list can afford: this is the
         * people somebody actually knows, not a follower graph, so it is
         * short by nature. An id that will not resolve - a deleted account -
         * is dropped rather than shown as a blank row.
         */
        const found = await Promise.all(ids.map((id) => service.find(id).catch(() => null)));
        if (!live) return;
        setPeople(found.filter((person): person is Profile => person !== null));
      })
      .catch(() => {
        if (live) setPeople([]);
      });

    return () => {
      live = false;
    };
  }, [service]);

  return (
    <Sheet
      title="Friends"
      description="People who follow you, and who you follow back."
      onClose={onClose}
    >
      {people === undefined ? (
        <div className="py-6">
          <LoadingState label="Loading" />
        </div>
      ) : people.length === 0 ? (
        <Empty
          line="No friends yet"
          hint="Following somebody who follows you back makes you friends, and they will be listed here."
        />
      ) : (
        <ul className="mt-2 max-h-[55vh] overflow-y-auto">
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/profile/${person.username}`);
                }}
                className={cn(
                  'focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left',
                  'transition-colors duration-instant hover:bg-hover active:bg-pressed',
                )}
              >
                <Avatar
                  name={person.displayName}
                  id={person.id}
                  {...(person.avatarUrl ? { src: person.avatarUrl } : {})}
                  size="md"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-body font-medium text-ink">
                    <span className="truncate">{person.displayName}</span>
                    {/* The same mark as the chat list, on the compact card. */}
                    <AchievementMark achievement={cardAchievements.lead(person.id)} />
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    @{person.username}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function GroupsSheet({ onClose }: { onClose: () => void }) {
  const { conversations } = useChat();
  const navigate = useNavigate();

  /*
   * Straight off the conversation list rather than a request of its own: being
   * in a group *is* having its conversation, and the list is already loaded and
   * already live. A second source would be a second answer to the same
   * question, and the two would disagree the first time one of them was stale.
   */
  const groups = conversations.filter(
    (chat: Conversation) => chat.kind === 'group' || chat.kind === 'community',
  );

  return (
    <Sheet title="Groups" description="Groups and communities you are in." onClose={onClose}>
      {groups.length === 0 ? (
        <Empty
          line="No groups yet"
          hint="Groups you are added to, and ones you start, will be listed here."
        />
      ) : (
        <ul className="mt-2 max-h-[55vh] overflow-y-auto">
          {groups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/chats/${group.id}`);
                }}
                className={cn(
                  'focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left',
                  'transition-colors duration-instant hover:bg-hover active:bg-pressed',
                )}
              >
                <Avatar
                  name={group.title}
                  id={group.id}
                  {...(group.avatarUrl ? { src: group.avatarUrl } : {})}
                  size="md"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">
                    {group.title}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {group.participantIds.length === 1
                      ? '1 member'
                      : `${group.participantIds.length} members`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** Nothing here yet, said as the good outcome rather than as a failure. */
function Empty({ line, hint }: { line: string; hint: string }) {
  return (
    <div className="px-6 pt-8 pb-4 text-center">
      <span
        aria-hidden
        className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand"
      >
        <UsersIcon size={22} />
      </span>
      <p className="mt-3 text-body font-medium text-ink">{line}</p>
      <p className="mt-1.5 text-caption text-text-secondary">{hint}</p>
    </div>
  );
}
