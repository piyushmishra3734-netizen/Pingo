import {
  ChoiceRow,
  Group,
  InfoRow,
  SettingsPage,
  ToggleRow,
} from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Privacy.
 *
 * ## The honest note at the bottom is the most important thing on this page
 *
 * Every control here saves a real preference, and **none of it is enforced
 * yet** — there is no server code that refuses a call or hides a profile. A
 * privacy screen that implies protection it does not provide is worse than no
 * screen at all, so the page says so once, plainly, at the end.
 *
 * Read Receipts is the exception and is marked as such: the chat service
 * already derives read state from `last_read_at`, so turning it off is a
 * setting with something on the other side of it.
 */
export function PrivacyScreen() {
  const { preferences, update } = usePreferences();
  const p = preferences.privacy;

  return (
    <SettingsPage title="Privacy">
      <Group title="Who can reach me">
        <ChoiceRow
          label="Who can call me"
          value={p.whoCanCall}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'friends', label: 'Friends' },
            { value: 'nobody', label: 'Nobody' },
          ]}
          onChange={(whoCanCall) => update('privacy', { whoCanCall })}
        />
        <ChoiceRow
          label="Who can add me"
          value={p.whoCanAdd}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'friends-of-friends', label: 'Friends of friends' },
            { value: 'nobody', label: 'Nobody' },
          ]}
          onChange={(whoCanAdd) => update('privacy', { whoCanAdd })}
        />
        <ChoiceRow
          label="Profile Visibility"
          value={p.profileVisibility}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'friends', label: 'Friends' },
            { value: 'nobody', label: 'Nobody' },
          ]}
          onChange={(profileVisibility) => update('privacy', { profileVisibility })}
        />
      </Group>

      <Group title="What others see">
        <ToggleRow
          label="Online Status"
          description="Whether people can see when you're active."
          checked={p.onlineStatus}
          onChange={(onlineStatus) => update('privacy', { onlineStatus })}
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
        note="Screenshot detection is not possible on the web — no browser reports it. This stays off until PINGO has a native app that can."
      >
        <InfoRow label="Blocked Users" value="None" />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        These are saved on this device. Apart from Read Receipts, none are enforced by the
        server yet — they take effect when the rules behind them are built. PINGO does not
        claim end-to-end encryption; see Security overview when it lands.
      </p>
    </SettingsPage>
  );
}
