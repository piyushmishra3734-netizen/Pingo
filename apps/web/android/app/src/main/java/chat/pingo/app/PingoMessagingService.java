package chat.pingo.app;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Where every push lands, with the app open or closed.
 *
 * <p>Capacitor's own service is replaced by this one in the manifest, and this
 * one still hands every message to it ({@code super}), so the page keeps its
 * {@code pushNotificationReceived} events. What it adds is the two silent kinds
 * the server sends to an app this new:
 * <ul>
 *   <li>{@code type=chat}: a message, drawn as a WhatsApp-style conversation
 *       with Reply and Mark as read ({@link ChatNotifier}).</li>
 *   <li>{@code type=clear}: that chat was read somewhere; take it down.</li>
 * </ul>
 */
public class PingoMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");
        if ("chat".equals(type)) {
            ChatNotifier.onMessage(getApplicationContext(), data);
        } else if ("clear".equals(type)) {
            ChatNotifier.clear(getApplicationContext(), data.get("conversationId"));
        }
        super.onMessageReceived(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        PushActions.rememberToken(getApplicationContext(), token);
        super.onNewToken(token);
    }
}
