import { useChat, type UserSettings } from '@pingo/core';
import {
  AccountIcon,
  BellIcon,
  HelpIcon,
  InfoIcon,
  ListGroup,
  ListRow,
  LockIcon,
  PaletteIcon,
  ShieldIcon,
  StorageIcon,
  Toggle,
  Wordmark,
  cn,
} from '@pingo/ui';
import { useCallback, useState } from 'react';

import { ScreenHeader } from '../components/ScreenHeader.js';

/**
 * Settings.
 *
 * The board shows a navigation list: Account, Privacy, Notifications, Appearance,
 * Data and Storage, Help & Support, About PINGO. Those are preserved as the
 * top-level structure, with the switches a user actually reaches for surfaced
 * inline rather than buried a level down.
 *
 * Toggles write through to the service immediately. There is no Save button,
 * because a settings screen with unsaved state is a settings screen that can lie
 * to you. Local state updates first so the switch never lags the finger.
 */
export function SettingsScreen() {
  const { currentUser, service } = useChat();
  const [settings, setSettings] = useState<UserSettings | undefined>(
    currentUser?.settings,
  );

  /**
   * Optimistic write. The switch moves now; the service catches up.
   * A failed write would roll back here — worth wiring when the real backend
   * lands and failure becomes possible.
   */
  const patch = useCallback(
    (change: Partial<UserSettings>) => {
      setSettings((previous) =>
        previous
          ? {
              ...previous,
              ...change,
              notifications: { ...previous.notifications, ...(change.notifications ?? {}) },
              privacy: { ...previous.privacy, ...(change.privacy ?? {}) },
            }
          : previous,
      );
      void service.updateSettings(change);
    },
    [service],
  );

  if (!settings || !currentUser) return null;

  return (
    <div className="h-full overflow-y-auto">
      <ScreenHeader title="Settings" showBack />

      <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-5">
        {/* ---- Account --------------------------------------------------- */}
        <ListGroup title="Account">
          <ListRow
            icon={<AccountIcon size={20} />}
            label={currentUser.name}
            description={`@${currentUser.handle}`}
            onClick={() => undefined}
          />
          <ListRow
            icon={<LockIcon size={20} />}
            label="Security"
            description="Two-factor authentication, active sessions"
            onClick={() => undefined}
          />
        </ListGroup>

        {/* ---- Privacy ---------------------------------------------------- */}
        <ListGroup title="Privacy">
          <ListRow
            icon={<ShieldIcon size={20} />}
            label="Read receipts"
            description="Let others know when you've read their messages"
            trailing={
              <Toggle
                checked={settings.privacy.readReceipts}
                onChange={(checked) => patch({ privacy: { ...settings.privacy, readReceipts: checked } })}
                label="Read receipts"
              />
            }
          />
          <ListRow
            icon={<ShieldIcon size={20} />}
            label="Typing indicators"
            description="Show when you're typing"
            trailing={
              <Toggle
                checked={settings.privacy.typingIndicators}
                onChange={(checked) =>
                  patch({ privacy: { ...settings.privacy, typingIndicators: checked } })
                }
                label="Typing indicators"
              />
            }
          />
          <ListRow
            icon={<ShieldIcon size={20} />}
            label="Last seen"
            description="Share when you were last active"
            trailing={
              <Toggle
                checked={settings.privacy.lastSeen}
                onChange={(checked) => patch({ privacy: { ...settings.privacy, lastSeen: checked } })}
                label="Last seen"
              />
            }
          />
          <ListRow
            icon={<ShieldIcon size={20} />}
            label="Who can see you're online"
            description={PRESENCE_LABEL[settings.privacy.presenceVisibility]}
            onClick={() => undefined}
          />
        </ListGroup>

        {/* ---- Notifications ---------------------------------------------- */}
        <ListGroup title="Notifications">
          <ListRow
            icon={<BellIcon size={20} />}
            label="Messages"
            trailing={
              <Toggle
                checked={settings.notifications.messages}
                onChange={(checked) =>
                  patch({ notifications: { ...settings.notifications, messages: checked } })
                }
                label="Message notifications"
              />
            }
          />
          <ListRow
            icon={<BellIcon size={20} />}
            label="Calls"
            trailing={
              <Toggle
                checked={settings.notifications.calls}
                onChange={(checked) =>
                  patch({ notifications: { ...settings.notifications, calls: checked } })
                }
                label="Call notifications"
              />
            }
          />
          <ListRow
            icon={<BellIcon size={20} />}
            label="Quiet hours"
            description={
              settings.notifications.quietHours
                ? `Silent from ${settings.notifications.quietHoursStart} to ${settings.notifications.quietHoursEnd}`
                : 'Off'
            }
            trailing={
              <Toggle
                checked={settings.notifications.quietHours}
                onChange={(checked) =>
                  patch({ notifications: { ...settings.notifications, quietHours: checked } })
                }
                label="Quiet hours"
              />
            }
          />
        </ListGroup>

        {/* ---- Appearance -------------------------------------------------- */}
        <ListGroup title="Appearance">
          <ListRow
            icon={<PaletteIcon size={20} />}
            label="Theme"
            description="Light"
            onClick={() => undefined}
          />
          <ListRow
            icon={<PaletteIcon size={20} />}
            label="Reduce motion"
            description="Minimise animation throughout PINGO"
            trailing={
              <Toggle
                checked={settings.reducedMotion}
                onChange={(checked) => patch({ reducedMotion: checked })}
                label="Reduce motion"
              />
            }
          />
        </ListGroup>

        {/* ---- Data, help, about ------------------------------------------ */}
        <ListGroup title="More">
          <ListRow
            icon={<StorageIcon size={20} />}
            label="Data and Storage"
            onClick={() => undefined}
          />
          <ListRow
            icon={<HelpIcon size={20} />}
            label="Help & Support"
            onClick={() => undefined}
          />
          <ListRow
            icon={<InfoIcon size={20} />}
            label="About PINGO"
            description="Version 0.1.0"
            onClick={() => undefined}
          />
        </ListGroup>

        {/* The wordmark as a quiet sign-off, echoing the board's settings screen. */}
        <div className={cn('flex flex-col items-center gap-1.5 pt-4 pb-2')}>
          <Wordmark size={13} tone="ink" className="opacity-25" />
          <span className="text-caption text-text-tertiary">Connect. Privately.</span>
        </div>
      </div>
    </div>
  );
}

const PRESENCE_LABEL: Record<UserSettings['privacy']['presenceVisibility'], string> = {
  everyone: 'Everyone',
  contacts: 'Contacts only',
  nobody: 'Nobody',
};
