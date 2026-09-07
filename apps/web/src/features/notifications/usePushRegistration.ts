import { useAuth } from '@pingo/core';
import { useCallback, useEffect } from 'react';

import { currentPlatform, isNative } from '../native/shell.js';
import { requestWebPushToken } from '../../lib/firebase/web-push.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Registers this device to receive push notifications.
 *
 * ## Permission is asked for late, and only once
 *
 * Not at launch. A notification prompt on first open is asking for something
 * before the person knows what they would be agreeing to, and Android only
 * gives you one refusal before the dialog stops appearing at all - spend it on
 * a stranger and you have lost push for that install permanently. This runs
 * once there is a session, which means somebody who has signed in and therefore
 * has conversations that could notify them.
 *
 * `checkPermissions` comes first so a device that already granted or already
 * refused is never asked again.
 *
 * ## The token belongs to the device, and devices change hands
 *
 * FCM reissues tokens on reinstall and hands the same one back to whoever signs
 * in next on that handset. So registration is an upsert keyed on the token, not
 * on the user: the row is *claimed*, and a previous owner's claim is replaced
 * rather than left beside it. Without that, signing in as somebody else on a
 * shared phone would deliver their messages to the previous account's tray.
 *
 * ## A browser is registered the same way
 *
 * Web push goes through FCM too, so a browser produces the same kind of token
 * an Android phone does and lands in the same row of the same table. Everything
 * downstream - backoff, pruning, idempotency - is unaware there are two
 * platforms, which is the point: a second delivery path would mean a second
 * place for a delivery bug to live.
 *
 * The two differ only in how the token is obtained, which is why that is the
 * only branch below.
 */
export function usePushRegistration(): void {
  const { session } = useAuth();
  const userId = session?.user.id;

  /**
   * One call, whichever platform produced the token.
   *
   * ## Why this is an RPC and not an upsert
   *
   * It used to be `.upsert(..., { onConflict: 'token' })`, and that returned
   * 403 for anybody whose browser or handset had ever been signed into a second
   * account. `ON CONFLICT DO UPDATE` makes Postgres apply the SELECT policy as
   * well as the UPDATE one to the row being claimed, and the row belongs to the
   * previous owner by definition - so the one case the deliberately loose
   * UPDATE policy existed to allow was the one case that could never happen.
   *
   * Reproduced against the live database before changing anything: `42501, new
   * row violates row-level security policy (USING expression)`. It showed up as
   * 43 accounts and 74 registered devices against 6 push tokens.
   *
   * `register_device_token` does the claim inside the database instead. See its
   * migration for why the read policy was not simply loosened.
   *
   * The token's owner is `auth.uid()` on the server, so `userId` is no longer
   * sent - it is only used to know whether there is a session at all.
   */
  const remember = useCallback(
    (token: string) => {
      if (!userId) return;
      void getSupabaseClient()
        .rpc('register_device_token', { p_token: token, p_platform: currentPlatform() })
        .then(({ error }) => {
          /*
           * Said out loud now, which it was not before.
           *
           * This used to end in `.then(undefined, () => undefined)`, and that
           * silence is the whole reason a 403 on every registration went
           * unnoticed: nothing reached the console, and `on_notification_push`
           * treats a missing device row as an ordinary skip rather than a
           * failure, so nothing reached `push_failures` either.
           *
           * Console only, matching the sibling failure paths below: there is
           * nothing the person holding the phone can do about it.
           */
          if (error) console.warn('[pingo/push] could not register token', error);
        });
    },
    [userId],
  );

  // ---- Web ------------------------------------------------------------------

  useEffect(() => {
    if (!userId || isNative()) return;

    let cancelled = false;
    void requestWebPushToken().then((token) => {
      if (!cancelled && token) remember(token);
    });

    return () => {
      cancelled = true;
    };
  }, [userId, remember]);

  // ---- Android / iOS --------------------------------------------------------

  useEffect(() => {
    if (!userId || !isNative()) return;

    let cancelled = false;
    const listeners: { remove: () => void }[] = [];

    void (async () => {
      /*
       * Imported here rather than at module scope.
       *
       * The web build has no push plugin implementation, and a top-level import
       * would pull it into every bundle and run its registration side effects
       * in a browser that cannot use them.
       */
      const { PushNotifications } = await import('@capacitor/push-notifications');

      /*
       * The channel has to exist before anything can arrive on it.
       *
       * Every push carries `channelId: 'pingo_messages'`, and on Android 8 and
       * up a notification naming a channel that was never created is dropped
       * without a sound, a log line, or anything else to notice. The server was
       * sending correctly and the phone was throwing it away.
       *
       * Created here rather than in the manifest because a channel is a runtime
       * object - importance, vibration and lights are set once at creation and
       * cannot be raised later, so it belongs where the values live rather than
       * in XML that only claims a default.
       *
       * `createChannel` is idempotent: calling it for one that exists updates
       * the name and description and leaves everything the user has since
       * changed alone, which is exactly right.
       */
      if (currentPlatform() === 'android') {
        await PushNotifications.createChannel({
          id: 'pingo_messages',
          name: 'Messages',
          description: 'Messages, Pings, calls and friend requests.',
          // HIGH, not MAX: it lights the screen and makes a sound without
          // taking over as a full-screen interruption. A message is not a call.
          importance: 4,
          visibility: 1,
          vibration: true,
          lights: true,
        }).catch(() => undefined);
      }

      const current = await PushNotifications.checkPermissions();
      let granted = current.receive === 'granted';

      if (current.receive === 'prompt' || current.receive === 'prompt-with-rationale') {
        const asked = await PushNotifications.requestPermissions();
        granted = asked.receive === 'granted';
      }

      // 'denied' lands here and goes no further. Asking again is what makes an
      // OS stop showing the dialog at all.
      if (!granted || cancelled) return;

      const registration = await PushNotifications.addListener(
        'registration',
        (token) => remember(token.value),
      );
      listeners.push(registration);

      const failure = await PushNotifications.addListener(
        'registrationError',
        (error) => {
          /*
           * Console only, and deliberately. There is nothing the person holding
           * the phone can do about a failed FCM handshake, and a message saying
           * "notifications are broken" would be alarming about something that
           * usually fixes itself on the next launch.
           */
          console.warn('[pingo/push] registration failed', error);
        },
      );
      listeners.push(failure);

      await PushNotifications.register();
    })();

    return () => {
      cancelled = true;
      for (const listener of listeners) listener.remove();
    };
  }, [userId, remember]);
}
