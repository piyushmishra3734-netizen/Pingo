package chat.pingo.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * What a notification needs to act without the app: where the server is, and
 * this device's push token and action key. The page hands them over each time
 * it starts ({@code configure}); they live in private SharedPreferences.
 *
 * <p>Also tells the notifier which chat is open ({@code setOpenChat}) and
 * takes a chat's notification down when the page reads it ({@code clearChat}).
 */
@CapacitorPlugin(name = "PushActions")
public class PushActions extends Plugin {

    private static final String PREFS = "pingo_push_actions";

    @PluginMethod
    public void configure(PluginCall call) {
        String url = call.getString("url");
        String anonKey = call.getString("anonKey");
        String key = call.getString("key");
        if (url == null || anonKey == null || key == null) {
            call.reject("url, anonKey and key are required");
            return;
        }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("url", url)
            .putString("anonKey", anonKey)
            .putString("key", key)
            .apply();
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> rememberToken(getContext(), token));
        call.resolve();
    }

    @PluginMethod
    public void setOpenChat(PluginCall call) {
        String id = call.getString("conversationId");
        ChatNotifier.openConversation = id == null || id.isEmpty() ? null : id;
        if (ChatNotifier.openConversation != null) ChatNotifier.clear(getContext(), ChatNotifier.openConversation);
        call.resolve();
    }

    @PluginMethod
    public void clearChat(PluginCall call) {
        ChatNotifier.clear(getContext(), call.getString("conversationId"));
        call.resolve();
    }

    static void rememberToken(Context context, String token) {
        if (token == null) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("token", token).apply();
    }

    private static final String TAG = "PingoPushAction";

    /**
     * Calls {@code push-action}. True when the server said ok. Never on the main thread.
     *
     * Tries twice when the network drops the first request: a reply typed in a
     * notification is gone once it is sent, so one flaky connection should not
     * lose it. Every failure says why in the log (a status code, or what was
     * missing), because a notification that quietly does nothing is otherwise
     * impossible to tell apart from one that never ran.
     */
    static boolean call(Context context, String action, String conversationId, String text) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String url = prefs.getString("url", null);
        String anonKey = prefs.getString("anonKey", null);
        String key = prefs.getString("key", null);
        String token = prefs.getString("token", null);
        if (url == null || anonKey == null || key == null || token == null) {
            Log.w(TAG, action + ": not configured (url=" + (url != null) + " anonKey=" + (anonKey != null)
                + " key=" + (key != null) + " token=" + (token != null) + "); open PINGO once to arm it");
            return false;
        }
        long began = System.currentTimeMillis();
        for (int attempt = 1; attempt <= 2; attempt++) {
            int code = post(url, anonKey, token, key, action, conversationId, text);
            if (code == 200) return true;
            Log.w(TAG, action + ": attempt " + attempt + " failed, " + (code < 0 ? "no answer" : "HTTP " + code));
            // A refusal will not change on a second try; only a missing answer might.
            if (code >= 0) return false;
            // Past about four seconds there is no room left in the receiver's ten for another go.
            if (System.currentTimeMillis() - began > 4000) return false;
        }
        return false;
    }

    /** One request. The HTTP status, or -1 when nothing answered. */
    private static int post(String url, String anonKey, String token, String key, String action, String conversationId, String text) {
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("key", key);
            body.put("action", action);
            body.put("conversationId", conversationId);
            if (text != null) body.put("text", text);
            connection = (HttpURLConnection) new URL(url + "/functions/v1/push-action").openConnection();
            connection.setRequestMethod("POST");
            // A cold function can take a few seconds to wake; the receiver is allowed about ten in all.
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(5000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("apikey", anonKey);
            connection.setRequestProperty("Authorization", "Bearer " + anonKey);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            return connection.getResponseCode();
        } catch (Exception e) {
            Log.w(TAG, action + ": " + e.getClass().getSimpleName() + " " + e.getMessage());
            return -1;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
