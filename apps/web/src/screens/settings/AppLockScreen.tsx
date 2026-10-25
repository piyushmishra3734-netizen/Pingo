import { useAuth } from '@pingo/core';
import { useState } from 'react';

import { ChoiceRow, Group, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
import { PinGate } from '../../features/lock/PinGate.js';
import { disableAppLock, enableAppLock, setAppLockDelay, useAppLock, type AppLockDelay } from '../../features/lock/app-lock.js';

/**
 * PINGO lock.
 *
 * Turning it on asks for a PIN (made now, if the device has none), and from then
 * on the app asks for it every time it opens and whenever it has been left for
 * the chosen time. Turning it off asks for the PIN first, so somebody holding an
 * unlocked phone cannot quietly remove it.
 *
 * It is the same PIN as locked chats, but opening PINGO does not open them.
 */
export function AppLockScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const lock = useAppLock(uid);
  // What the pad is for right now: making the lock, or proving it to remove it.
  const [asking, setAsking] = useState<'enable' | 'disable'>();

  return (
    <SettingsPage title="PINGO lock">
      <Group
        note="Uses the same PIN as your locked chats. PINGO asks for it when it opens, and after you leave it for the time below. Your locked chats stay locked until you open them."
      >
        <ToggleRow
          label="Lock PINGO with a PIN"
          description={lock.on ? 'On. PINGO opens only with your PIN.' : 'Off. Anyone with your phone can open PINGO.'}
          checked={lock.on}
          onChange={(next) => setAsking(next ? 'enable' : 'disable')}
          disabled={!uid}
        />
      </Group>

      {lock.on && (
        <Group title="Ask for the PIN">
          <ChoiceRow
            label="After leaving PINGO"
            description="How long it can be left before it asks again. It always asks after the app is closed."
            value={String(lock.delay)}
            options={[
              { value: '0', label: 'Right away' },
              { value: '60', label: '1 minute' },
              { value: '300', label: '5 minutes' },
            ]}
            onChange={(next) => setAppLockDelay(Number(next) as AppLockDelay)}
          />
        </Group>
      )}

      {asking && uid && (
        <PinGate
          mode="app"
          verifyHint={asking === 'disable' ? 'Enter your PIN to turn the lock off.' : 'Enter your PIN to turn the lock on.'}
          onCancel={() => setAsking(undefined)}
          onSuccess={() => {
            if (asking === 'enable') enableAppLock(uid);
            else disableAppLock();
            setAsking(undefined);
          }}
        />
      )}
    </SettingsPage>
  );
}
