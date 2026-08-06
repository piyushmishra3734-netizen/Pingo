/**
 * Web push, on the same pipeline as Android.
 *
 * ## Why the Firebase SDK and not raw Web Push
 *
 * A browser can be pushed to directly with VAPID and `PushManager.subscribe`,
 * and that would avoid this dependency entirely. It would also mean a second
 * send path on the server: FCM speaks to device tokens, raw Web Push speaks to
 * endpoint subscriptions, and they are not the same thing. Two paths means two
 * places to fix a delivery bug and two sets of retry semantics.
 *
 * Going through FCM means a browser produces the same kind of token an Android
 * phone does, lands in the same table, and is sent by the same code that
 * already handles backoff, pruning and idempotency. The cost is a dependency;
 * the alternative was a parallel implementation of everything Phase 4 built.
 *
 * ## Nothing here is a secret
 *
 * A Firebase web config ships in every client that uses it - the API key is
 * restricted by origin rather than kept private, and the VAPID public key is
 * public by definition. They are read from `import.meta.env` so a different
 * project can be pointed at without editing code, not because they need hiding.
 */

/*
 * Named exactly as Firebase's own config object names them.
 *
 * The first version read `VITE_FIREBASE_SENDER_ID`, which is not what anybody
 * copying from the Firebase console would type - and a variable that is set
 * under a name nothing reads is indistinguishable from one that is missing.
 * The console says `messagingSenderId`, so this says the same.
 *
 * `authDomain` is taken from the environment rather than derived from the
 * project id: they are the same string for a default project and different the
 * moment a custom auth domain exists, and deriving it would break silently.
 */
const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
    `${import.meta.env.VITE_FIREBASE_PROJECT_ID as string}.firebaseapp.com`) as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

/**
 * Whether this browser can be pushed to at all.
 *
 * Four things have to be true, and each fails differently. Safari below 16.4
 * and every iOS browser outside a home-screen app simply have no push; asking
 * them produces an exception rather than a refusal.
 */
export function webPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** False when the project has not been configured, so callers can stay quiet. */
export function webPushConfigured(): boolean {
  return Boolean(CONFIG.apiKey && CONFIG.appId && CONFIG.messagingSenderId && VAPID_KEY);
}

/**
 * Asks the browser, then Firebase, for a token.
 *
 * Returns `undefined` for every ordinary "no" - unsupported browser, missing
 * config, permission refused - because none of those is an error the caller can
 * act on, and treating a refusal as a failure is what produces error toasts
 * about a feature somebody deliberately declined.
 *
 * The permission prompt is not raised here on a whim: the caller only reaches
 * this once there is a session, for the same reason as on Android. A browser
 * gives one refusal and then stops asking.
 */
export async function requestWebPushToken(): Promise<string | undefined> {
  if (!webPushSupported() || !webPushConfigured()) return undefined;

  try {
    if (Notification.permission === 'denied') return undefined;

    if (Notification.permission === 'default') {
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') return undefined;
    }

    /*
     * Imported here, not at module scope.
     *
     * The Firebase messaging SDK is a substantial amount of JavaScript, and
     * every visitor would pay for it at startup - including the ones who never
     * sign in, and every Android build, where it is dead weight. A dynamic
     * import keeps it out of the initial bundle and out of the app shell.
     */
    const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported }] = await Promise.all([
      import('firebase/app'),
      import('firebase/messaging'),
    ]);

    // Firebase's own check, which knows about browsers this one does not.
    if (!(await isSupported())) return undefined;

    const app = getApps().length > 0 ? getApps()[0]! : initializeApp(CONFIG as Record<string, string>);

    /*
     * The registration is passed explicitly.
     *
     * Left to itself, Firebase registers `/firebase-messaging-sw.js` at the
     * root scope - where PINGO's own PWA worker already lives. Registering it
     * under its own scope is what lets the two coexist instead of one
     * replacing the other, which would silently disable offline caching.
     */
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/firebase-cloud-messaging-push-scope',
    });

    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_KEY!,
      serviceWorkerRegistration: registration,
    });

    return token || undefined;
  } catch (cause) {
    // Console only. There is nothing the person at the keyboard can do about a
    // failed FCM handshake, and it usually resolves on the next load.
    console.warn('[pingo/push] web token failed', cause);
    return undefined;
  }
}
