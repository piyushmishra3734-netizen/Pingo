import { useProfile, type Profile } from '@pingo/core';
import { Avatar, LoadingState, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { SettingsPage } from '../../features/settings/controls.js';
import { useStories } from '../../features/stories/StoryContext.js';

/**
 * Everyone whose stories you have hidden, and the way back.
 *
 * Muting somebody's stories took one tap from the viewer and could not be
 * undone from anywhere: their circle leaves the rail, so the control that would
 * unmute them leaves with it. The only way back was to be sent a story link
 * directly. This is the list that fixes that, and it is the whole reason the
 * screen exists.
 *
 * ## Names, from ids
 *
 * The service stores a mute as a user id, which is the right thing to store and
 * useless to read - "unmute 4f3c-…" is not a decision anybody can make. Each id
 * is resolved to a profile here, one request each, because a muted list is
 * short by nature: it holds the people somebody deliberately stepped away from,
 * not a roster.
 *
 * An id that will not resolve - a deleted account - is dropped rather than
 * shown as a blank row. Their stories are gone either way, so the mute has
 * nothing left to act on.
 */

export function MutedStoriesScreen() {
  const { mutedAuthors, setAuthorMuted } = useStories();
  const { service: profiles } = useProfile();

  const [people, setPeople] = useState<Profile[]>();
  /** Who is mid-unmute, so their row can say so rather than sitting still. */
  const [working, setWorking] = useState<string>();

  useEffect(() => {
    let live = true;

    if (mutedAuthors.length === 0) {
      setPeople([]);
      return;
    }

    void Promise.all(
      mutedAuthors.map((id) => profiles.find(id).catch(() => null)),
    ).then((found) => {
      if (!live) return;
      setPeople(found.filter((person): person is Profile => person !== null));
    });

    return () => {
      live = false;
    };
  }, [mutedAuthors, profiles]);

  return (
    <SettingsPage title="Muted stories">
      {people === undefined ? (
        <LoadingState label="Loading" />
      ) : people.length === 0 ? (
        /*
         * Said plainly, because an empty list here is good news rather than a
         * missing feature - and somebody arriving from Settings has no other
         * way to learn what this page is for.
         */
        <p className="px-4 py-8 text-center text-body text-text-secondary">
          You have not muted anyone&apos;s stories. Muting someone hides their
          stories from your list without unfollowing them, and they are never told.
        </p>
      ) : (
        <ul className="px-2">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-2 py-2.5">
              <Avatar
                name={person.displayName}
                id={person.id}
                {...(person.avatarUrl ? { src: person.avatarUrl } : {})}
                size="md"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">
                  {person.displayName}
                </span>
                <span className="block truncate text-caption text-text-secondary">
                  @{person.username}
                </span>
              </span>

              {/*
                Unmute takes effect where it is pressed - the list is driven by
                `mutedAuthors`, so the row leaves the moment the store updates
                and there is nothing to tick or confirm.
              */}
              <button
                type="button"
                disabled={working === person.id}
                onClick={() => {
                  setWorking(person.id);
                  void setAuthorMuted(person.id, false).finally(() =>
                    setWorking(undefined),
                  );
                }}
                className={cn(
                  'focus-ring shrink-0 rounded-full px-3 py-1.5',
                  'text-caption font-medium text-brand',
                  'transition-colors duration-instant hover:bg-hover',
                  'disabled:opacity-60',
                )}
              >
                {working === person.id ? 'Unmuting…' : 'Unmute'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsPage>
  );
}
