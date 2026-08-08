import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Tapping a notification opens the thread it came from.
 *
 * ## What it was doing instead
 *
 * `usePushRegistration` listens for `registration` and `registrationError` and
 * nothing else, so on Android a tap launched the app and left it wherever it
 * happened to be - usually the conversation list, sometimes the chat that was
 * open days ago. The notification says who wrote and what they said, and then
 * asks you to go and find them.
 *
 * ## The payload already carries what this needs
 *
 * Message content never goes into a push payload, so the notification is built
 * from ids: `subjectId` is the conversation. That is deliberate and it is also
 * exactly enough to route on - no lookup, nothing to decrypt, no round trip
 * between the tap and the thread opening.
 *
 * ## Why `replace`
 *
 * The app was not "on" a screen the user chose to leave; it was cold, or it was
 * where they last put it. Pushing a history entry would leave Back returning to
 * a screen they never asked for. Replacing means Back does what it always does
 * from a thread: goes to the list.
 */
export function usePushTapRouting(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let detach: (() => void) | undefined;
    let cancelled = false;

    void import('@capacitor/push-notifications')
      .then(({ PushNotifications }) =>
        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = (action.notification.data ?? {}) as Record<string, unknown>;
          const conversationId = typeof data.subjectId === 'string' ? data.subjectId : undefined;

          /*
           * A notification without a subject is a real case - a friend request,
           * a system notice - and it should still bring the app somewhere
           * sensible rather than doing nothing at all.
           */
          navigate(conversationId ? `/chats/${conversationId}` : '/chats', { replace: true });
        }),
      )
      .then((handle) => {
        if (cancelled) {
          void handle.remove();
          return;
        }
        detach = () => void handle.remove();
      })
      // No plugin off-device. The web build routes through the service
      // worker's own `notificationclick` instead.
      .catch(() => undefined);

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [navigate]);
}
