import { useProfile, type Profile } from '@pingo/core';
import { Avatar, LoadingState, MuteIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Group, SettingsPage } from '../../features/settings/controls.js';
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
  const confirm = useConfirm();

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
         * Centred and given room, because an empty list is the good outcome
         * here rather than a missing feature. A bare line of grey text against
         * the top of the page reads as something failing to load.
         */
        <div className="px-8 pt-14 text-center">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand"
          >
            <MuteIcon size={24} />
          </span>
          <p className="mt-4 text-body font-medium text-ink">Nobody is muted</p>
          <p className="mt-1.5 text-caption text-text-secondary">
            Muting someone hides their stories from your list without
            unfollowing them. They are never told, and they will appear here so
            you can undo it.
          </p>
        </div>
      ) : (
        <Group
          title={people.length === 1 ? '1 person' : `${people.length} people`}
          note="Their stories stay hidden from your list until you unmute them. They are never told."
        >
          {people.map((person) => (
            <div key={person.id} className="flex items-center gap-3 px-3 py-2.5">
              {/*
                The avatar says what the row is about before the words do: a
                muted person is shown quietened - dimmed, with the same glyph
                that muted them sitting on the picture - so the list reads as a
                set of people you stepped away from rather than a set of names
                with a button beside each.
              */}
              <span className="relative shrink-0">
                <span className="block opacity-60 saturate-50">
                  <Avatar
                    name={person.displayName}
                    id={person.id}
                    {...(person.avatarUrl ? { src: person.avatarUrl } : {})}
                    size="md"
                  />
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'absolute -right-0.5 -bottom-0.5 grid size-[18px] place-items-center',
                    'rounded-full bg-surface text-text-secondary ring-1 ring-line shadow-sm',
                  )}
                >
                  <MuteIcon size={11} />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">
                  {person.displayName}
                </span>
                <span className="block truncate text-caption text-text-secondary">
                  @{person.username}
                </span>
              </span>

              {/*
                Once confirmed it takes effect where it is pressed - the list is
                driven by `mutedAuthors`, so the row leaves the moment the store
                updates. Nothing to tick, and no Save at the bottom.
              */}
              <button
                type="button"
                disabled={working === person.id}
                onClick={() => {
                  void (async () => {
                    /*
                     * Asked here too, so mute and unmute behave alike.
                     *
                     * On its own an unmute would not need a question - nothing
                     * is lost and it can be re-muted in a tap. But muting does
                     * ask, and a pair of opposite actions where only one
                     * confirms teaches that the quiet one is the safe one,
                     * which is exactly backwards.
                     */
                    const ok = await confirm({
                      title: `Unmute ${person.displayName}?`,
                      description: 'Their stories will appear in your list again.',
                      confirmLabel: 'Unmute',
                      tone: 'normal',
                    });
                    if (!ok) return;

                    setWorking(person.id);
                    await setAuthorMuted(person.id, false).finally(() =>
                      setWorking(undefined),
                    );
                  })();
                }}
                className={cn(
                  /*
                    A filled pill, not a word in brand colour. This is the one
                    thing the screen exists to do, and bare tinted text beside
                    a name reads as a link somebody forgot to style.
                  */
                  'focus-ring shrink-0 rounded-full px-3.5 py-1.5',
                  'bg-brand-soft text-caption font-semibold text-brand',
                  'transition-[background-color,transform] duration-instant',
                  'hover:bg-selected active:scale-[0.97]',
                  'disabled:opacity-60',
                )}
              >
                {working === person.id ? 'Unmuting…' : 'Unmute'}
              </button>
            </div>
          ))}
        </Group>
      )}
    </SettingsPage>
  );
}
