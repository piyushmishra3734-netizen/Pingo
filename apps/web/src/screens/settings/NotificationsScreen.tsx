import { useEffect, useState } from 'react';

import { Group, InfoRow, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Notifications.
 *
 * **Mute All is not a seventh switch - it is a master.** While it is on the
 * others are disabled rather than silently ignored, so the screen cannot show
 * "Messages: on" to someone who will not receive any.
 *
 * The permission state is surfaced at the top, because every switch below it is
 * meaningless if the browser is refusing notifications outright - and that is a
 * fact the user can only fix in their browser, not here.
 */
export function NotificationsScreen() {
  const { preferences, update } = usePreferences();
  const n = preferences.notifications;

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    'unsupported',
  );

  useEffect(() => {
    if ('Notification' in window) setPermission(Notification.permission);
  }, []);

  const ask = async () => {
    if (!('Notification' in window)) return;
    setPermission(await Notification.requestPermission());
  };

  return (
    <SettingsPage title="Notifications">
      {permission !== 'granted' && (
        <Group
          note={
            permission === 'denied'
              ? 'Your browser is blocking notifications for this site. Turn them back on in its site settings, nothing here can override that.'
              : undefined
          }
        >
          <InfoRow
            label={
              permission === 'unsupported'
                ? 'Notifications are not supported here'
                : permission === 'denied'
                  ? 'Notifications are blocked'
                  : 'Notifications are off'
            }
            value={permission === 'default' ? 'Turn on' : undefined}
            {...(permission === 'default' ? { onClick: () => void ask() } : {})}
          />
        </Group>
      )}

      <Group title="Mute">
        <ToggleRow
          label="Mute All"
          description="Silences everything below."
          checked={n.muteAll}
          onChange={(muteAll) => update('notifications', { muteAll })}
        />
      </Group>

      <Group title="What to notify me about">
        <ToggleRow
          label="Messages"
          checked={n.messages}
          disabled={n.muteAll}
          onChange={(messages) => update('notifications', { messages })}
        />
        <ToggleRow
          label="Groups"
          checked={n.groups}
          disabled={n.muteAll}
          onChange={(groups) => update('notifications', { groups })}
        />
        <ToggleRow
          label="Calls"
          checked={n.calls}
          disabled={n.muteAll}
          onChange={(calls) => update('notifications', { calls })}
        />
        <ToggleRow
          label="Communities"
          checked={n.communities}
          disabled={n.muteAll}
          onChange={(communities) => update('notifications', { communities })}
        />
      </Group>

      <Group
        title="Reminders"
        note="The only two reminders PINGO will ever send. No re-engagement nudges, no “you have unread messages”."
      >
        <ToggleRow
          label="Streak Reminder"
          description="Before a streak is about to break."
          checked={n.streakReminder}
          disabled={n.muteAll}
          onChange={(streakReminder) => update('notifications', { streakReminder })}
        />
        <ToggleRow
          label="Friend Birthday"
          checked={n.friendBirthday}
          disabled={n.muteAll}
          onChange={(friendBirthday) => update('notifications', { friendBirthday })}
        />
      </Group>

      <Group
        title="Quiet Hours"
        note="Saved on this device. Push delivery is not built yet, so nothing is scheduled against these times so far."
      >
        <ToggleRow
          label="Quiet Hours"
          description={`${n.quietHoursStart} - ${n.quietHoursEnd}`}
          checked={n.quietHours}
          onChange={(quietHours) => update('notifications', { quietHours })}
        />
        {n.quietHours && (
          <div className="flex items-center gap-3 px-3 py-3">
            <span className="min-w-0 flex-1 text-body text-ink">From</span>
            <input
              type="time"
              value={n.quietHoursStart}
              onChange={(event) =>
                update('notifications', { quietHoursStart: event.target.value })
              }
              className="rounded-md bg-sunken px-2 py-1 text-caption text-ink"
              aria-label="Quiet hours start"
            />
            <span className="text-caption text-text-secondary">to</span>
            <input
              type="time"
              value={n.quietHoursEnd}
              onChange={(event) => update('notifications', { quietHoursEnd: event.target.value })}
              className="rounded-md bg-sunken px-2 py-1 text-caption text-ink"
              aria-label="Quiet hours end"
            />
          </div>
        )}
      </Group>

      {/* Page-level caveat, not a per-row one. */}
      <p className="px-1 pb-4 text-caption text-text-tertiary">
        These choices are saved on this device. They start affecting delivery once push
        notifications are built.
      </p>
    </SettingsPage>
  );
}
