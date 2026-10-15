package chat.pingo.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

/**
 * Reply and Mark as read, pressed on a chat notification.
 *
 * <p>Runs with the app closed: it calls {@code push-action} with this
 * device's push token and action key ({@link PushActions}), off the main
 * thread, inside the few seconds {@link #goAsync} allows.
 */
public class NotificationActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String conversationId = intent.getStringExtra(ChatNotifier.EXTRA_CONVERSATION);
        if (conversationId == null) return;
        Context app = context.getApplicationContext();
        String action = intent.getAction();

        if (ChatNotifier.ACTION_READ.equals(action)) {
            // Gone at once, as on WhatsApp; the server then clears every other device.
            ChatNotifier.clear(app, conversationId);
            PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    PushActions.call(app, "read", conversationId, null);
                } finally {
                    pending.finish();
                }
            }).start();
            return;
        }

        if (ChatNotifier.ACTION_REPLY.equals(action)) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence typed = results == null ? null : results.getCharSequence(ChatNotifier.KEY_REPLY);
            String text = typed == null ? "" : typed.toString().trim();
            if (text.isEmpty()) return;
            PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    if (PushActions.call(app, "reply", conversationId, text)) {
                        ChatNotifier.onReplied(app, conversationId, text);
                    } else {
                        ChatNotifier.onReplyFailed(app, conversationId);
                    }
                } finally {
                    pending.finish();
                }
            }).start();
        }
    }
}
