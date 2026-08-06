
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ChoiceRow, Group, InfoRow, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
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
  const navigate = useNavigate();
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
          label="Friend requests"
          checked={n.friendRequests}
          disabled={n.muteAll}
          onChange={(friendRequests) => update('notifications', { friendRequests })}
        />
        <ToggleRow
          label="Stories"
          checked={n.stories}
          disabled={n.muteAll}
          onChange={(stories) => update('notifications', { stories })}
        />
        <ToggleRow
          label="PINGO AI"
          description="Replies from your AI chat."
          checked={n.ai}
          disabled={n.muteAll}
          onChange={(ai) => update('notifications', { ai })}
        />
      </Group>

      {/*
        Lock screen preview.

        The default sends no message text at all - only who it is from - so
        nothing readable passes through Google's servers on the way to a locked
        phone. The middle option is a trade somebody may want to make about
        their own messages, and it says plainly what it costs rather than
        hiding it behind a friendly label.
      */}
      <Group
        title="Lock screen"
        note="With previews on, the text of your messages travels through Google's notification service to reach your lock screen. On the default it never does - only who sent it."
      >
        <ChoiceRow
          label="Preview"
          value={n.preview}
          options={[
            { value: 'sender-only', label: 'Sender only' },
            { value: 'sender-and-text', label: 'Sender + preview' },
            { value: 'hidden', label: 'Hide everything' },
          ]}
          onChange={(preview) => update('notifications', { preview })}
        />
      </Group>

      {/*
        Journey and marketing default to off and are the only two switches here
        that start that way. Everything above is somebody trying to reach you;
        these two are PINGO wanting your attention for its own reasons, and
        that is permission a product should be given rather than assume.
      */}
      <Group
        title="From PINGO"
        note="Both off unless you ask. Journey will never tell you a streak is about to break - see the philosophy: never pressure, never punish, never manipulate."
      >
        <ToggleRow
          label="Journey"
          description="Badges earned, and the occasional weekly reflection."
          checked={n.journey}
          disabled={n.muteAll}
          onChange={(journey) => update('notifications', { journey })}
        />
        <ToggleRow
          label="Product news"
          description="New features. Rare, and never about what you have not read."
          checked={n.marketing}
          disabled={n.muteAll}
          onChange={(marketing) => update('notifications', { marketing })}
        />
      </Group>

      <Group title="Quiet Hours">
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

      {/*
        This page used to end with "saved on this device… once push is built".
        Both halves are now false: these live on your account and the server
        reads them before it sends anything.
      */}
      {/*
        Not hidden behind a developer flag.

        Every question about push is asked after the fact by somebody who did
        not get a notification, and the answer is in a chain of eight things
        they cannot see. A page that shows the chain is worth more to them than
        it costs us - it holds nothing another person could not already learn by
        messaging them, and the product-wide figures on it are refused to anyone
        who is not an operator.
      */}
      <Group>
        <InfoRow
          label="Push diagnostics"
          value="Open"
          onClick={() => navigate('/settings/notifications/debug')}
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        Saved to your account, so they follow you to every device you sign in on.
      </p>
    </SettingsPage>
  );
}
