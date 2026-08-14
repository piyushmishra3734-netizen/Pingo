import { formatConversationTimestamp } from '@pingo/core';
import { LoadingState, cn } from '@pingo/ui';
import { useCallback, useEffect, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { useT } from '../../features/i18n/useT.js';
import { Group, SettingsPage } from '../../features/settings/controls.js';
import { deviceIdentity } from '../../lib/crypto/keys.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Every device signed in to this account, and a way to throw one off.
 *
 * ## The list is the key registry
 *
 * `device_keys` already held a row per device - that is the list a sender wraps
 * message keys for. Reading it here rather than inventing a sessions table
 * means the screen cannot disagree with reality: a device shown here is a
 * device that can read what you send next, and one that is gone cannot.
 *
 * ## What removing one does
 *
 * It stops that device being included in any future message, immediately. It
 * also leaves a tombstone the device reads on its next launch, at which point
 * it signs itself out and deletes its local copy of the conversation - see
 * `wipeRevokedDevice`. What it cannot do is reach a phone that is switched off
 * and wipe it before then, and the confirmation says so rather than implying a
 * power nothing has.
 *
 * ## This device is listed, not hidden
 *
 * Marked, and removable. Somebody sitting at a borrowed computer looking at
 * this screen should not have to work out which row is the one they are
 * holding, and hiding it would make the count disagree with the phone in their
 * hand.
 */
interface DeviceRow {
  device_id: string;
  label: string | null;
  created_at: string;
  last_seen_at: string;
}

export function DevicesScreen() {
  const t = useT();
  const confirm = useConfirm();
  const [rows, setRows] = useState<DeviceRow[]>();
  const [mine, setMine] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const client = getSupabaseClient();
    const { data: session } = await client.auth.getUser();
    const userId = session.user?.id;
    if (!userId) {
      setRows([]);
      return;
    }
    const { data } = await client
      .from('device_keys')
      .select('device_id,label,created_at,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false });
    setRows((data ?? []) as DeviceRow[]);
  }, []);

  useEffect(() => {
    void load();
    // The id is read from this device's own keys, not from the server, because
    // "which of these is me" is a local question.
    void deviceIdentity()
      .then((identity) => setMine(identity.deviceId))
      .catch(() => undefined);
  }, [load]);

  const remove = async (row: DeviceRow) => {
    const name = row.label || t('devices.unnamed');
    const go = await confirm({
      title: row.device_id === mine ? t('devices.removeThisTitle') : `Remove ${name}?`,
      description:
        row.device_id === mine
          ? t('devices.removeThisBlurb')
          : t('devices.removeBlurb'),
      confirmLabel: t('devices.remove'),
    });
    if (!go) return;

    setBusy(row.device_id);
    setError(undefined);
    try {
      const { error: failed } = await getSupabaseClient().rpc('revoke_device', {
        device: row.device_id,
      });
      if (failed) throw failed;
      await load();
    } catch {
      setError(t('devices.removeFailed'));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <SettingsPage title={t('page.devices')}>
      <Group title={t('devices.signedIn')} note={t('devices.note')}>
        {!rows ? (
          <LoadingState label={t('devices.loading')} />
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-caption text-text-tertiary">
            {t('devices.none')}
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.device_id} className="flex items-center gap-3 px-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">
                  {row.label || t('devices.unnamed')}
                  {row.device_id === mine && (
                    <span className="ml-2 text-caption text-brand">{t('devices.thisOne')}</span>
                  )}
                </span>
                <span className="block truncate text-caption text-text-tertiary">
                  {t('devices.lastSeen', {
                    when: formatConversationTimestamp(Date.parse(row.last_seen_at)),
                  })}
                </span>
              </span>

              <button
                type="button"
                disabled={busy !== undefined}
                onClick={() => void remove(row)}
                className={cn(
                  'focus-ring shrink-0 rounded-full px-3 py-1.5 text-caption font-medium',
                  'text-danger transition-colors duration-instant hover:bg-danger-soft',
                  'disabled:opacity-50',
                )}
              >
                {busy === row.device_id ? t('devices.removing') : t('devices.remove')}
              </button>
            </div>
          ))
        )}
      </Group>

      {error && <p className="px-1 text-caption text-danger">{error}</p>}
    </SettingsPage>
  );
}
