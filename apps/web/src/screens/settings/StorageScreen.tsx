import { useCallback, useEffect, useState } from 'react';

import { Group, InfoRow, SettingsPage } from '../../features/settings/controls.js';

/**
 * Storage.
 *
 * Real numbers, from the browser. `navigator.storage.estimate()` reports what
 * this origin is actually using, and Clear Cache actually deletes the Cache
 * Storage entries — so the figure moves afterwards.
 *
 * The breakdown by kind (media, voice, video) is **not** shown, because the
 * browser does not expose it. Inventing a split would be the kind of made-up
 * detail that looks like data and is not; the total is real, so the total is
 * what appears.
 *
 * Signing-in data is never cleared here. Wiping a session under a button
 * labelled "Clear Cache" would be a surprise ejection from the product.
 */
export function StorageScreen() {
  const [usage, setUsage] = useState<{ used: number; quota: number } | undefined>();
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  const measure = useCallback(async () => {
    if (!navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate();
    setUsage({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
  }, []);

  useEffect(() => {
    void measure();
  }, [measure]);

  const clear = async () => {
    setClearing(true);
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      setCleared(true);
      await measure();
    } finally {
      setClearing(false);
    }
  };

  return (
    <SettingsPage title="Storage">
      <Group
        title="On this device"
        note="Reported by your browser for this site. It includes cached files and offline data."
      >
        <InfoRow label="Used" value={usage ? formatBytes(usage.used) : '—'} />
        <InfoRow label="Available" value={usage ? formatBytes(usage.quota) : '—'} />
      </Group>

      <Group
        title="Cache"
        note={
          cleared
            ? 'Cleared. Your account and messages are untouched — only cached files were removed.'
            : 'Removes cached files only. You stay signed in and nothing is deleted from your account.'
        }
      >
        <InfoRow
          label="Clear Cache"
          value={clearing ? 'Clearing…' : 'Clear'}
          onClick={() => void clear()}
          destructive
        />
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        A breakdown by media, voice notes and videos is not shown because browsers do not
        report one. The total above is measured, not estimated by us.
      </p>
    </SettingsPage>
  );
}

/** Bytes to something a person can read. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}
