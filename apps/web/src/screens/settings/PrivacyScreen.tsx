import { OPEN_PRIVACY, useProfile, type PrivacySettings, type Profile } from '@pingo/core';
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

/**
 * Privacy.
 *
 * ## Which of these actually do something
 *
 * Two of them do, and both are enforced where the fact is published rather
 * than where it is displayed, which is the only place a privacy switch can be
 * honoured without trusting everybody else's copy of the app:
 *
 *   · **Show activity status** stops the presence channel from saying "here"
 *     and stops the heartbeat writing `last_seen_at`. Between them those are
 *     the only two things that report somebody as present, so with both quiet
 *     there is nothing for another client to be asked not to draw.
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

  const save = (changes: Partial<PrivacySettings>) => {
    // Optimistic, then written. A switch that waits for a round trip before it
    // moves feels broken on a slow connection.
    setRules((current) => ({ ...current, ...changes }));
    void profiles.updatePrivacySettings(changes).catch(() => undefined);
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
        <ToggleRow
          label={t('privacy.onlineStatus')}
          description={t('privacy.onlineStatusHint')}
          checked={rules.onlineStatus}
          onChange={(onlineStatus) => save({ onlineStatus })}
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
              setBlocked((list) => list?.filter((p) => p.id !== person.id));
              void profiles.setBlocked(person.id, false).catch(() => undefined);
            }}
          />
        ))}
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">{t('privacy.footer')}</p>
    </SettingsPage>
  );
}
