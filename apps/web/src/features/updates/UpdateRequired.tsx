import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';

import { publicAppUrl } from '../../lib/public-origin.js';
import { isUpdateRequired, onUpdateRequired } from '../../lib/update-required.js';
import { loadLatest, useAppUpdate, type LatestBuild, type UpdateStage } from './app-update.js';
import { UpdateCard } from './UpdateCard.js';

/**
 * "A new version is out, and this one is outdated" - over everything, with no
 * way past it but updating.
 *
 * Shown when the database refuses this build (`PINGO_UPDATE_REQUIRED`, see
 * `lib/update-required.ts`). Nothing works underneath by then, so the honest
 * screen is one that says so and offers the one thing that helps, rather than a
 * chat list of errors.
 *
 * In the Android app it updates right here (download, check, install - see
 * `app-update.ts`); a web page has nothing to download and only needs to load
 * its new version.
 *
 * Dev only: `?update-required-preview` shows it, and `=progress`, `=install`,
 * `=permission` or `=error` show those stages.
 */

const DEMO: LatestBuild = {
  versionCode: 2604405,
  versionName: '2.26.44.5',
  bytes: 65_039_316,
  sha256: '',
  notes: ['PINGO Feedback: tell us what to build', 'The chat list opens faster', 'A calmer update screen'],
};

function previewParam(): UpdateStage['kind'] | undefined {
  if (!import.meta.env.DEV) return undefined;
  const params = new URLSearchParams(location.search);
  if (!params.has('update-required-preview')) return undefined;
  const value = params.get('update-required-preview');
  return value === 'progress' ? 'downloading' : value === 'install' || value === 'permission' || value === 'error' ? value : 'ready';
}

export function UpdateRequired() {
  const [shown, setShown] = useState(isUpdateRequired);
  useEffect(() => onUpdateRequired(() => setShown(true)), []);

  const preview = previewParam();
  const show = shown || preview !== undefined;
  const native = Capacitor.isNativePlatform();

  // What the newest build is, from Cloudflare - not the database, which is the thing refusing us.
  const [latest, setLatest] = useState<LatestBuild | null>(preview ? DEMO : null);
  useEffect(() => {
    if (!show || preview) return;
    let live = true;
    void loadLatest().then((found) => {
      if (live) setLatest(found);
    });
    return () => {
      live = false;
    };
  }, [show, preview]);

  const update = useAppUpdate(latest, preview);
  if (!show) return null;

  return (
    <UpdateCard
      mode="screen"
      version={latest?.versionName}
      bytes={latest?.bytes}
      notes={latest?.notes}
      stage={update.stage}
      inApp={update.inApp}
      web={!native && preview === undefined}
      onUpdate={native || preview ? update.start : () => window.location.reload()}
      onInstall={update.install}
      onAllow={update.allow}
      onCancel={update.cancel}
      fallbackHref={publicAppUrl('/download?update=1')}
    />
  );
}
