package chat.pingo.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * WhatsApp-style chat notifications, drawn by the app itself.
 *
 * <p>One notification per chat, keyed by the conversation. Each new message is
 * added to that chat's {@link NotificationCompat.MessagingStyle}, so the tray
 * shows the unread lines of the conversation (sender, picture, text) rather
 * than one entry per message. Reading the chat anywhere (here, in the app, on
 * another device) clears it: the server sends a silent "clear" push.
 *
 * <p>The unread lines are kept in SharedPreferences, not memory: the process
 * that receives one push is often not alive for the next.
 */
final class ChatNotifier {

    static final String CHANNEL = "pingo_messages";
    static final String KEY_REPLY = "pingo_reply_text";
    static final String ACTION_REPLY = "chat.pingo.app.REPLY";
    static final String ACTION_READ = "chat.pingo.app.MARK_READ";
    static final String EXTRA_CONVERSATION = "conversationId";

    private static final String PREFS = "pingo_chat_notifications";
    private static final int MAX_LINES = 8;

    /** The chat open on screen right now, set by the app; its messages do not ring. */
    static volatile String openConversation;

    private ChatNotifier() {}

    static int idFor(String conversationId) {
        return ("chat:" + conversationId).hashCode();
    }

    /** A chat push arrived: add its line and show the chat. */
    static void onMessage(Context context, Map<String, String> data) {
        String conversationId = data.get("conversationId");
        if (conversationId == null || conversationId.isEmpty()) return;
        // In the app already: the in-app banner says it, and the open chat says it best.
        // A tray entry would only repeat it.
        if (MainActivity.inForeground) return;

        String sender = orDefault(data.get("sender"), "PINGO");
        String text = orDefault(data.get("text"), "New message");
        String messageId = orDefault(data.get("messageId"), String.valueOf(System.currentTimeMillis()));
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject chat = new JSONObject(prefs.getString(conversationId, "{}"));
            JSONArray lines = chat.optJSONArray("lines");
            if (lines == null) lines = new JSONArray();
            // The same message twice (a retry) is one line.
            for (int i = 0; i < lines.length(); i++) {
                if (messageId.equals(lines.getJSONObject(i).optString("id"))) return;
            }
            JSONObject line = new JSONObject();
            line.put("id", messageId);
            line.put("who", sender);
            line.put("text", text);
            line.put("at", System.currentTimeMillis());
            lines.put(line);
            while (lines.length() > MAX_LINES) lines.remove(0);
            chat.put("lines", lines);
            chat.put("title", orDefault(data.get("chatTitle"), ""));
            chat.put("group", "1".equals(data.get("isGroup")));
            chat.put("avatar", orDefault(data.get("avatar"), chat.optString("avatar", "")));
            chat.put("kind", orDefault(data.get("kind"), "message"));
            prefs.edit().putString(conversationId, chat.toString()).apply();
            show(context, conversationId, chat, true);
        } catch (Exception ignored) {
            // A notification that cannot be drawn must never crash the push service.
        }
    }

    /** Adds what they just replied, then redraws quietly (as WhatsApp does). */
    static void onReplied(Context context, String conversationId, String text) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject chat = new JSONObject(prefs.getString(conversationId, "{}"));
            JSONArray lines = chat.optJSONArray("lines");
            if (lines == null) lines = new JSONArray();
            JSONObject line = new JSONObject();
            line.put("id", "me-" + System.currentTimeMillis());
            line.put("who", "");
            line.put("text", text);
            line.put("at", System.currentTimeMillis());
            lines.put(line);
            chat.put("lines", lines);
            prefs.edit().putString(conversationId, chat.toString()).apply();
            show(context, conversationId, chat, false);
        } catch (Exception ignored) {
        }
    }

    /** A reply that could not be sent: say so on the same notification. */
    static void onReplyFailed(Context context, String conversationId) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject chat = new JSONObject(prefs.getString(conversationId, "{}"));
            chat.put("failed", true);
            show(context, conversationId, chat, false);
        } catch (Exception ignored) {
        }
    }

    /** The chat was read: take it down and forget its lines. */
    static void clear(Context context, String conversationId) {
        if (conversationId == null || conversationId.isEmpty()) return;
        NotificationManagerCompat.from(context).cancel(idFor(conversationId));
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(conversationId).apply();
    }

    private static void show(Context context, String conversationId, JSONObject chat, boolean alert) throws Exception {
        ensureChannel(context);
        JSONArray lines = chat.optJSONArray("lines");
        if (lines == null || lines.length() == 0) return;

        Person me = new Person.Builder().setName("You").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        boolean group = chat.optBoolean("group");
        String title = chat.optString("title", "");
        if (group && !title.isEmpty()) {
            style.setConversationTitle(title);
            style.setGroupConversation(true);
        }

        Bitmap avatar = null;
        String avatarUrl = chat.optString("avatar", "");
        if (!group && !avatarUrl.isEmpty()) avatar = circle(download(avatarUrl));

        String lastSender = "PINGO";
        int unread = 0;
        for (int i = 0; i < lines.length(); i++) {
            JSONObject line = lines.getJSONObject(i);
            String who = line.optString("who", "");
            Person person = null;
            if (!who.isEmpty()) {
                Person.Builder builder = new Person.Builder().setName(who).setKey(who);
                if (avatar != null) builder.setIcon(IconCompat.createWithBitmap(avatar));
                person = builder.build();
                lastSender = who;
                unread++;
            }
            style.addMessage(line.optString("text"), line.optLong("at"), person);
        }

        int id = idFor(conversationId);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setStyle(style)
            .setContentTitle(group && !title.isEmpty() ? title : lastSender)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!alert)
            .setNumber(unread)
            .setShortcutId(conversationId)
            .setContentIntent(openIntent(context, conversationId, chat.optString("kind", "message")));
        if (avatar != null) builder.setLargeIcon(avatar);
        if (chat.optBoolean("failed")) builder.setSubText("Reply not sent. Tap to open.");

        RemoteInput input = new RemoteInput.Builder(KEY_REPLY).setLabel("Reply").build();
        NotificationCompat.Action reply = new NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send, "Reply", actionIntent(context, ACTION_REPLY, conversationId, true))
            .addRemoteInput(input)
            .setAllowGeneratedReplies(true)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build();
        NotificationCompat.Action read = new NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_view, "Mark as read", actionIntent(context, ACTION_READ, conversationId, false))
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build();
        builder.addAction(reply).addAction(read);

        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission withdrawn: nothing to show, nothing to crash over.
        }
    }

    /** Opens the chat the way a tapped push always has: Capacitor routes on these extras. */
    private static PendingIntent openIntent(Context context, String conversationId, String kind) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("google.message_id", "chat-" + conversationId + "-" + System.currentTimeMillis());
        intent.putExtra("kind", kind);
        intent.putExtra("subjectId", conversationId);
        intent.putExtra(EXTRA_CONVERSATION, conversationId);
        return PendingIntent.getActivity(context, idFor(conversationId), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent actionIntent(Context context, String action, String conversationId, boolean mutable) {
        Intent intent = new Intent(context, NotificationActionReceiver.class);
        intent.setAction(action);
        intent.putExtra(EXTRA_CONVERSATION, conversationId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // A reply's text is written into the intent by the system, so that one must be mutable.
        flags |= mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE;
        int request = (action + conversationId).hashCode();
        return PendingIntent.getBroadcast(context, request, intent, flags);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("New messages from your chats");
        manager.createNotificationChannel(channel);
    }

    private static Bitmap download(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            try (InputStream in = connection.getInputStream()) {
                return BitmapFactory.decodeStream(in);
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Bitmap circle(Bitmap source) {
        if (source == null) return null;
        int size = Math.min(source.getWidth(), source.getHeight());
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        int left = (source.getWidth() - size) / 2;
        int top = (source.getHeight() - size) / 2;
        canvas.drawBitmap(source, new Rect(left, top, left + size, top + size), new Rect(0, 0, size, size), paint);
        return out;
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
