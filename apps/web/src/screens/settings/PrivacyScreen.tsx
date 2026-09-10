import { OPEN_PRIVACY, useProfile, type PrivacySettings, type Profile } from '@pingo/core';
import { PingoDot } from '@pingo/ui';
import { useEffect, useState } from 'react';

import {
  ChoiceRow,
  Group,
  InfoRow,
  SettingsPage,
  ToggleRow,
} from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';
import { useT } from '../../features/i18n/useT.js';
import { refreshPresenceStatus, savePresenceStatus } from '../../features/presence/status.js';
import { presenceStatus, type PresenceStatus } from '../../features/settings/privacy-flags.js';

/**
 * Privacy.
 *
 * ## Which of these actually do something
 *
 * Two of them do, and both are enforced where the fact is published rather
 * than where it is displayed, which is the only place a privacy switch can be
 * honoured without trusting everybody else's copy of the app:
 *
 *   · **Status** - online, invisible or do not disturb. Anything but online
 *     stops the presence channel from saying "here"
 *     and stops the heartbeat writing `last_seen_at`. Between them those are
 *     the only two things that report somebody as present, so with both quiet
 *     there is nothing for another client to be asked not to draw. Do not
 *     disturb also silences every notification, pushed or in the app.
 *   · **Read receipts** holds the read cursor on the device and publishes it
 *     when a reply is sent - see `read-cursor.ts` - and hides other people's
 *     read state in return, which the hint has always promised.
 *
 * The rest still save a preference that nothing reads: no server code refuses
 * a call or hides a profile yet. A privacy screen that implies protection it
 * does not provide is worse than no screen at all, so the page says so once,
 * plainly, at the end.
 */
export function PrivacyScreen() {
  const t = useT();
  const { preferences, update } = usePreferences();
  const { service: profiles } = useProfile();
  const p = preferences.privacy;

  /*
   * The server's copy is the truth, read once on open.
   *
   * Until it arrives the open defaults are shown — which is what the database
   * assumes for an account that has never saved any — so the screen never
   * claims a restriction that is not actually in force.
   */
  const [rules, setRules] = useState<PrivacySettings>(OPEN_PRIVACY);
  const [blocked, setBlocked] = useState<Profile[]>();
  const [saveFailed, setSaveFailed] = useState(false);
  const [status, setStatus] = useState<PresenceStatus>(presenceStatus);

  useEffect(() => {
    let active = true;
    void profiles
      .privacySettings()
      .then((found) => {
        if (active) setRules(found);
      })
      .catch(() => undefined);
    void profiles
      .listBlocked()
      .then((people) => {
        if (active) setBlocked(people);
      })
      .catch(() => {
        if (active) setBlocked([]);
      });
    return () => {
      active = false;
    };
  }, [profiles]);

  useEffect(() => {
    let active = true;
    void refreshPresenceStatus().then((found) => {
      if (active && found) setStatus(found);
    });
    return () => {
      active = false;
    };
  }, []);

  /*
   * Optimistic, then written - and put back if the write does not land.
   *
   * The optimism is right: a switch that waits for a round trip before it moves
   * feels broken on a slow connection. Discarding the failure was not. A switch
   * left sitting on "nobody" while the server still holds "everyone" is the one
   * kind of wrong a privacy screen cannot afford - it does not just fail to
   * protect somebody, it tells them they are protected. The page already says
   * plainly which of these are enforced; it has to be equally plain when one of
   * them did not save.
   *
   * The rollback restores the previous values of exactly the keys that changed,
   * rather than re-reading the server, so a second switch flipped meanwhile
   * keeps its own state.
   */
  const save = (changes: Partial<PrivacySettings>) => {
    setSaveFailed(false);

    /*
     * Read from `rules`, not from inside the updater.
     *
     * React calls a functional update during render rather than at the moment
     * it is dispatched, so capturing the old values in there would be a bet on
     * that happening before the request comes back. `rules` is the value this
     * render drew, which is the one the person was looking at when they touched
     * the switch - so it is both correct and the obvious thing to read.
     */
    const before = Object.fromEntries(
      Object.keys(changes).map((key) => [key, rules[key as keyof PrivacySettings]]),
    ) as Partial<PrivacySettings>;

    setRules((current) => ({ ...current, ...changes }));

    void profiles.updatePrivacySettings(changes).catch((cause: unknown) => {
      setRules((current) => ({ ...current, ...before }));
      setSaveFailed(true);
      console.warn('Privacy settings did not save.', cause);
    });
  };

  /*
   * The same bargain as `save`: moved at once, put back if it did not land. A
   * status reading "invisible" while the server still says online is the one
   * kind of wrong this row cannot afford.
   */
  const chooseStatus = (next: PresenceStatus) => {
    const before = status;
    setSaveFailed(false);
    setStatus(next);
    void savePresenceStatus(next).catch((cause: unknown) => {
      setStatus(before);
      setSaveFailed(true);
      console.warn('Status did not save.', cause);
    });
  };

  return (
    <SettingsPage title={t('page.privacy')}>
      <Group title={t('privacy.groupReach')}>
        <ChoiceRow
          label={t('privacy.whoCanCall')}
          value={rules.whoCanCall}
          options={[
            { value: 'everyone', label: t('choice.everyone') },
            { value: 'friends', label: t('choice.friends') },
            { value: 'nobody', label: t('choice.nobody') },
          ]}
          onChange={(whoCanCall) => save({ whoCanCall })}
        />
        <ChoiceRow
          label={t('privacy.whoCanAdd')}
          value={rules.whoCanAdd}
          options={[
            { value: 'everyone', label: t('choice.everyone') },
            { value: 'friends-of-friends', label: t('choice.fof') },
            { value: 'nobody', label: t('choice.nobody') },
          ]}
          onChange={(whoCanAdd) => save({ whoCanAdd })}
        />
        <ChoiceRow
          label={t('privacy.profileVisibility')}
          value={rules.profileVisibility}
          options={[
            { value: 'everyone', label: t('choice.everyone') },
            { value: 'friends', label: t('choice.friends') },
            { value: 'nobody', label: t('choice.nobody') },
          ]}
          description={t('privacy.profileVisibilityHint')}
          onChange={(profileVisibility) => save({ profileVisibility })}
        />
      </Group>

      <Group title={t('privacy.groupSee')}>
        <ChoiceRow
          label={t('privacy.status')}
          description={t(STATUS_HINT[status])}
          value={status}
          options={[
            { value: 'online', label: t('privacy.statusOnline'), icon: <StatusIcon state="online" /> },
            {
              value: 'invisible',
              label: t('privacy.statusInvisible'),
              icon: <StatusIcon state="invisible" />,
            },
            { value: 'dnd', label: t('privacy.statusDnd'), icon: <StatusIcon state="dnd" /> },
          ]}
          onChange={chooseStatus}
        />
        <ToggleRow
          label={t('privacy.readReceipts')}
          description={t('privacy.readReceiptsHint')}
          checked={p.readReceipts}
          onChange={(readReceipts) => update('privacy', { readReceipts })}
        />
        <ToggleRow
          label={t('privacy.screenshotAlerts')}
          description={t('privacy.screenshotAlertsHint')}
          checked={p.screenshotAlerts}
          onChange={(screenshotAlerts) => update('privacy', { screenshotAlerts })}
        />
      </Group>

      <Group note={t('privacy.screenshotNote')}>
        {/*
          The real list. This said "None" as a literal string, so somebody who
          had blocked three people was told they had blocked nobody — and had
          nowhere to go to undo it.
        */}
        <InfoRow
          label={t('privacy.blockedUsers')}
          value={
            blocked === undefined
              ? '…'
              : blocked.length === 0
                ? t('choice.none')
                : String(blocked.length)
          }
        />
        {blocked?.map((person) => (
          <InfoRow
            key={person.id}
            label={person.displayName}
            value={t('privacy.unblock')}
            onClick={() => {
              // Same bargain as `save`: shown immediately, put back if it did
              // not take. Somebody who is still blocked must not vanish from
              // the only list that offers to unblock them.
              setSaveFailed(false);
              setBlocked((list) => list?.filter((p) => p.id !== person.id));
              void profiles.setBlocked(person.id, false).catch((cause: unknown) => {
                setBlocked((list) => (list ? [...list, person] : [person]));
                setSaveFailed(true);
                console.warn('Could not unblock.', cause);
              });
            }}
          />
        ))}
      </Group>

      {saveFailed && (
        <p role="status" className="px-1 pb-2 text-caption text-danger">
          {t('privacy.saveFailed')}
        </p>
      )}

      <p className="px-1 pb-4 text-caption text-text-tertiary">{t('privacy.footer')}</p>
    </SettingsPage>
  );
}

const STATUS_HINT = {
  online: 'privacy.statusOnlineHint',
  invisible: 'privacy.statusInvisibleHint',
  dnd: 'privacy.statusDndHint',
} as const;

/**
 * The mark each status wears, on the same page-coloured disc the avatar puts
 * it on - so the online dot does not vanish into the selected button, which is
 * drawn in the brand colour the dot is also drawn in.
 */
function StatusIcon({ state }: { state: PresenceStatus }) {
  return (
    <span className="grid place-items-center rounded-full bg-page p-[2px]">
      <PingoDot state={state} size={10} />
    </span>
  );
}
