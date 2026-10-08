package chat.pingo.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
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

    /**
     * The exact page for one switch, where the phone has one: {@code target}
     * is "autostart" or "battery".
     *
     * Each maker hides these in its own security app, under names that move
     * between versions, so there is a list of candidates per maker, tried in
     * order. Many of them are not exported on a given version and refuse to
     * open; the next one is tried. Whatever is left falls back to the app's
     * own settings page, which every phone has and where both switches can be
     * reached by hand.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "battery");
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String pkg = getContext().getPackageName();

        if ("autostart".equals(target)) {
            for (String[] c : autostartPages(maker)) {
                if (start(component(c[0], c[1]))) {
                    call.resolve();
                    return;
                }
            }
        } else {
            if (has(maker, "xiaomi", "redmi", "poco")) {
                // MIUI and HyperOS: the app's own "Battery saver" choice, where "No restrictions" is.
                Intent miui = component("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity");
                miui.putExtra("package_name", pkg);
                miui.putExtra("package_label", "PINGO");
                if (start(miui)) {
                    call.resolve();
                    return;
                }
            }
            // Android 12 and up (Pixel, Samsung, Motorola and most others): the app's battery page, with Unrestricted on it.
            Intent usage = new Intent("android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL");
            usage.setData(Uri.parse("package:" + pkg));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && start(usage)) {
                call.resolve();
                return;
            }
        }
        start(appSettings());
        call.resolve();
    }

    /** Where each maker keeps its autostart list, newest first. */
    private static String[][] autostartPages(String maker) {
        if (has(maker, "xiaomi", "redmi", "poco")) {
            return new String[][] {
                { "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" },
            };
        }
        if (has(maker, "oppo", "realme")) {
            return new String[][] {
                { "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
                { "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity" },
                { "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity" },
                { "com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity" },
            };
        }
        if (has(maker, "oneplus")) {
            return new String[][] {
                { "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity" },
                { "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
            };
        }
        if (has(maker, "vivo", "iqoo")) {
            return new String[][] {
                { "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },
                { "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager" },
                { "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity" },
            };
        }
        if (has(maker, "huawei", "honor")) {
            return new String[][] {
                { "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
                { "com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity" },
                { "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity" },
            };
        }
        if (has(maker, "asus")) {
            return new String[][] { { "com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity" } };
        }
        if (has(maker, "infinix", "tecno", "itel")) {
            return new String[][] { { "com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity" } };
        }
        return new String[0][];
    }

    private static boolean has(String maker, String... names) {
        for (String n : names) {
            if (maker.contains(n)) return true;
        }
        return false;
    }

    private static Intent component(String pkg, String cls) {
        return new Intent().setComponent(new ComponentName(pkg, cls));
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
