import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';

import { BUILD_ID } from '../../lib/build-id.js';

export interface AppVersion {
  /** What people read: "2.26.37.1" in the Android app, "Web" in a browser. */
  version: string;
  /** What support asks for: the versionCode in the app, the commit on the web. */
  build: string;
  native: boolean;
}

/**
 * The version this copy of PINGO actually is.
 *
 * Help used to print a hard-coded "0.1.0" and the Vite mode, which is the same
 * on every build - so the one question every support conversation starts with
 * had the same wrong answer on every phone. The installed app knows its own
 * versionName and versionCode; the web knows the commit it was built from.
 */
export function useAppVersion(): AppVersion {
  const native = Capacitor.isNativePlatform();
  const [version, setVersion] = useState<AppVersion>({ version: native ? '…' : 'Web', build: BUILD_ID, native });

  useEffect(() => {
    if (!native) return;
    let live = true;
    void App.getInfo()
      .then((info) => {
        if (live) setVersion({ version: info.version, build: `${info.build} · ${BUILD_ID}`, native });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [native]);

  return version;
}
