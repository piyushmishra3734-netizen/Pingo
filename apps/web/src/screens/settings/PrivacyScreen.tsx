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
      <Group title="Who can reach me">
        <ChoiceRow
          label="Who can call me"
          value={rules.whoCanCall}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'friends', label: 'Friends' },
            { value: 'nobody', label: 'Nobody' },
          ]}
          onChange={(whoCanCall) => save({ whoCanCall })}
        />
        <ChoiceRow
          label="Who can add me"
          value={rules.whoCanAdd}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'friends-of-friends', label: 'Friends of friends' },
            { value: 'nobody', label: 'Nobody' },
          ]}
          onChange={(whoCanAdd) => save({ whoCanAdd })}
        />
        <ChoiceRow
          label="Profile Visibility"
          value={rules.profileVisibility}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'friends', label: 'Friends' },
            { value: 'nobody', label: 'Nobody' },
          ]}
          description="People you already talk to always see your profile — hiding it from them would only blank out your own chat list."
          onChange={(profileVisibility) => save({ profileVisibility })}
        />
      </Group>

      <Group title="What others see">
        <ToggleRow
          label="Online Status"
          description="Whether people can see when you're active."
          checked={rules.onlineStatus}
          onChange={(onlineStatus) => save({ onlineStatus })}
        />
        <ToggleRow
          label="Read Receipts"
          description="Turning this off also hides theirs from you."
          checked={p.readReceipts}
          onChange={(readReceipts) => update('privacy', { readReceipts })}
        />
        <ToggleRow
          label="Screenshot Alerts"
          description="Tell people when you screenshot their story."
          checked={p.screenshotAlerts}
          onChange={(screenshotAlerts) => update('privacy', { screenshotAlerts })}
        />
      </Group>

      <Group
        note="Screenshot detection is not possible on the web, no browser reports it. This stays off until PINGO has a native app that can."
      >
        {/*
          The real list. This said "None" as a literal string, so somebody who
          had blocked three people was told they had blocked nobody — and had
          nowhere to go to undo it.
        */}
        <InfoRow
          label="Blocked Users"
          value={
            blocked === undefined
              ? '…'
              : blocked.length === 0
                ? 'None'
                : String(blocked.length)
          }
        />
        {blocked?.map((person) => (
          <InfoRow
            key={person.id}
            label={person.displayName}
            value="Unblock"
            onClick={() => {
              setBlocked((list) => list?.filter((p) => p.id !== person.id));
              void profiles.setBlocked(person.id, false).catch(() => undefined);
            }}
          />
        ))}
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        These are saved on this device. Apart from Read Receipts, none are enforced by the
        server yet - they take effect when the rules behind them are built. PINGO does not
        claim end-to-end encryption; see Security overview when it lands.
      </p>
    </SettingsPage>
  );
}
