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
 * ## The honest note at the bottom is the most important thing on this page
 *
 * Every control here saves a real preference, and **none of it is enforced
 * yet** - there is no server code that refuses a call or hides a profile. A
 * privacy screen that implies protection it does not provide is worse than no
 * screen at all, so the page says so once, plainly, at the end.
 *
 * Read Receipts is the exception and is marked as such: the chat service
 * already derives read state from `last_read_at`, so turning it off is a
 * setting with something on the other side of it.
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
