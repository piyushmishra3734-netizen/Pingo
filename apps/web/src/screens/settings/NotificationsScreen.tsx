
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ChoiceRow, Group, InfoRow, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';
import { useT } from '../../features/i18n/useT.js';


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
  const t = useT();
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
    <SettingsPage title={t('page.notifications')}>
      {permission !== 'granted' && (
        <Group note={permission === 'denied' ? t('notif.permDeniedNote') : undefined}>
          <InfoRow
            label={
              permission === 'unsupported'
                ? t('notif.permUnsupported')
                : permission === 'denied'
                  ? t('notif.permBlocked')
                  : t('notif.permOff')
            }
            value={permission === 'default' ? t('notif.permTurnOn') : undefined}
            {...(permission === 'default' ? { onClick: () => void ask() } : {})}
          />
        </Group>
      )}

      <Group title={t('notif.groupMute')}>
        <ToggleRow
          label={t('notif.muteAll')}
          description={t('notif.muteAllHint')}
          checked={n.muteAll}
          onChange={(muteAll) => update('notifications', { muteAll })}
        />
      </Group>

      <Group title={t('notif.groupAbout')}>
        <ToggleRow
          label={t('notif.messages')}
          checked={n.messages}
          disabled={n.muteAll}
          onChange={(messages) => update('notifications', { messages })}
        />
        <ToggleRow
          label={t('notif.groups')}
          checked={n.groups}
          disabled={n.muteAll}
          onChange={(groups) => update('notifications', { groups })}
        />
        <ToggleRow
          label={t('notif.calls')}
          checked={n.calls}
          disabled={n.muteAll}
          onChange={(calls) => update('notifications', { calls })}
        />
        <ToggleRow
          label={t('notif.friendRequests')}
          checked={n.friendRequests}
          disabled={n.muteAll}
          onChange={(friendRequests) => update('notifications', { friendRequests })}
        />
        <ToggleRow
          label={t('notif.stories')}
          checked={n.stories}
          disabled={n.muteAll}
          onChange={(stories) => update('notifications', { stories })}
        />
        <ToggleRow
          label={t('notif.ai')}
          description={t('notif.aiHint')}
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
      <Group title={t('notif.groupLock')} note={t('notif.lockNote')}>
        <ChoiceRow
          label={t('notif.preview')}
          value={n.preview}
          options={[
            { value: 'sender-only', label: t('notif.previewSender') },
            { value: 'sender-and-text', label: t('notif.previewText') },
            { value: 'hidden', label: t('notif.previewHidden') },
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
      <Group title={t('notif.groupPingo')} note={t('notif.pingoNote')}>
        <ToggleRow
          label={t('notif.journey')}
          description={t('notif.journeyHint')}
          checked={n.journey}
          disabled={n.muteAll}
          onChange={(journey) => update('notifications', { journey })}
        />
        <ToggleRow
          label={t('notif.marketing')}
          description={t('notif.marketingHint')}
          checked={n.marketing}
          disabled={n.muteAll}
          onChange={(marketing) => update('notifications', { marketing })}
        />
      </Group>

      <Group title={t('notif.groupQuiet')}>
        <ToggleRow
          label={t('notif.quietHours')}
          description={`${n.quietHoursStart} - ${n.quietHoursEnd}`}
          checked={n.quietHours}
          onChange={(quietHours) => update('notifications', { quietHours })}
        />
        {n.quietHours && (
          <div className="flex items-center gap-3 px-3 py-3">
            <span className="min-w-0 flex-1 text-body text-ink">{t('notif.quietFrom')}</span>
            <input
              type="time"
              value={n.quietHoursStart}
              onChange={(event) =>
                update('notifications', { quietHoursStart: event.target.value })
              }
              className="rounded-md bg-sunken px-2 py-1 text-caption text-ink"
              aria-label={t('notif.quietStartAria')}
            />
            <span className="text-caption text-text-secondary">{t('notif.quietTo')}</span>
            <input
              type="time"
              value={n.quietHoursEnd}
              onChange={(event) => update('notifications', { quietHoursEnd: event.target.value })}
              className="rounded-md bg-sunken px-2 py-1 text-caption text-ink"
              aria-label={t('notif.quietEndAria')}
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
