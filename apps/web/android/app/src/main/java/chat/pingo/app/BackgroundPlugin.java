package chat.pingo.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Letting PINGO keep running in the background.
 *
 * <h2>Why it is asked for</h2>
 *
 * Android's battery optimisation pauses an app soon after it leaves the
 * screen, and many phones (Xiaomi, Oppo, Vivo, Realme, Samsung) go further and
 * stop it outright. For a chat app that means messages that arrive late, music
 * that stops with the screen, and a call that rings only once the app is
 * opened. WhatsApp is on those phones' own allow-lists; PINGO has to ask.
 *
 * <h2>How</h2>
 *
 * {@code ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS} shows the system's own
 * one-tap dialog ("Let app always run in background?"), which needs the
 * matching permission in the manifest. PINGO is installed from its own site,
 * not the Play Store, so the store's restriction on that permission does not
 * apply. If a phone has no such dialog, the general battery settings list is
 * opened instead, and failing that the app's own settings page.
 *
 * The answer is not returned from {@link #request}: the dialog reports
 * nothing back. The page checks {@link #status} again when it returns to the
 * foreground.
 */
@CapacitorPlugin(name = "Background")
public class BackgroundPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("unrestricted", isUnrestricted());
        out.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        call.resolve(out);
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void request(PluginCall call) {
        Context context = getContext();
        if (isUnrestricted()) {
            call.resolve();
            return;
        }
        Intent ask = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        ask.setData(Uri.parse("package:" + context.getPackageName()));
        if (!start(ask) && !start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) {
            start(appSettings());
        }
        call.resolve();
    }

    /** The app's own settings page, where "Battery" and, on some phones, "Autostart" live. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        start(appSettings());
        call.resolve();
    }

    private Intent appSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        return intent;
    }

    private boolean isUnrestricted() {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return power == null || power.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private boolean start(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }
}
