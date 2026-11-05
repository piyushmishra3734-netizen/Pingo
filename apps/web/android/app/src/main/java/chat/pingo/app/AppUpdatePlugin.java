package chat.pingo.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Updating PINGO from inside PINGO: download the new APK, check it, hand it to
 * Android's installer.
 *
 * <h2>Where the bytes come from</h2>
 *
 * From Cloudflare, never from Supabase: the URL is the download Worker, which
 * serves the APK out of R2 (see {@code workers/download}). A 60 MB file pulled by
 * every phone costs the database nothing.
 *
 * <h2>What it does, and what it cannot</h2>
 *
 * <ul>
 *   <li>{@code download} streams to the app's own cache folder, resuming a
 *       partial file with a Range request (the Worker honours them), reports
 *       progress, and checks the SHA-256 the release script published. A file
 *       that does not match is deleted, not installed.</li>
 *   <li>{@code canInstall} / {@code openInstallSettings}: Android will not let an
 *       app install other apps until the person allows it, once, on a page of
 *       its own. The page is opened on PINGO's own switch.</li>
 *   <li>{@code install} gives the file to the system installer through a
 *       FileProvider. Android always asks the person to confirm; nothing here
 *       can skip that, and nothing should.</li>
 * </ul>
 *
 * An update is signed with the same key as the app, so Android refuses a file
 * that is not PINGO's even if the checks above were somehow fooled.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String FINAL_NAME = "PINGO-update.apk";
    private static final String PART_NAME = "PINGO-update.apk.part";
    /** Progress is reported at most this often; a bar cannot show more. */
    private static final long PROGRESS_EVERY_MS = 120;

    /** The broadcast the installer reports its progress to. */
    private static final String RESULT_ACTION = "chat.pingo.app.UPDATE_INSTALL_RESULT";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile PluginCall installCall;
    private BroadcastReceiver receiver;
    private volatile boolean cancelled = false;
    private volatile HttpURLConnection live;

    private File folder() {
        File dir = new File(getContext().getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String address = call.getString("url");
        final String expected = call.getString("sha256", "");
        final long hint = call.getLong("bytes", 0L);
        if (address == null || !address.startsWith("https://")) {
            call.reject("The update address is not valid.");
            return;
        }
        cancelled = false;
        worker.execute(() -> {
            File part = new File(folder(), PART_NAME);
            File done = new File(folder(), FINAL_NAME);
            try {
                //noinspection ResultOfMethodCallIgnored
                done.delete();
                long have = part.exists() ? part.length() : 0;

                HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
                live = connection;
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(30_000);
                connection.setRequestProperty("Accept-Encoding", "identity");
                if (have > 0) connection.setRequestProperty("Range", "bytes=" + have + "-");
                int status = connection.getResponseCode();

                boolean append = status == 206 && have > 0;
                if (status != 200 && status != 206) {
                    throw new java.io.IOException("Server answered " + status);
                }
                if (!append) have = 0;

                long total = totalOf(connection, have, hint);
                long received = have;
                long lastReport = 0;

                try (InputStream in = connection.getInputStream();
                     OutputStream out = new FileOutputStream(part, append)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        if (cancelled) throw new java.io.IOException("cancelled");
                        out.write(buffer, 0, read);
                        received += read;
                        long now = System.currentTimeMillis();
                        if (now - lastReport >= PROGRESS_EVERY_MS) {
                            lastReport = now;
                            report(received, total);
                        }
                    }
                }
                report(received, total > 0 ? total : received);

                if (total > 0 && part.length() != total) {
                    throw new java.io.IOException("The download ended early.");
                }
                if (expected != null && !expected.isEmpty()) {
                    String actual = sha256(part);
                    if (!expected.equalsIgnoreCase(actual)) {
                        //noinspection ResultOfMethodCallIgnored
                        part.delete();
                        throw new java.io.IOException("sha256 did not match");
                    }
                }
                if (!part.renameTo(done)) throw new java.io.IOException("Could not keep the download.");

                JSObject result = new JSObject();
                result.put("bytes", done.length());
                call.resolve(result);
            } catch (Exception e) {
                // A cancelled or dropped download keeps what it has, so the next try resumes.
                call.reject(e.getMessage() == null ? "The download failed." : e.getMessage());
            } finally {
                HttpURLConnection c = live;
                live = null;
                if (c != null) c.disconnect();
            }
        });
    }

    /** The full size of the file, whichever way the server says it. */
    private static long totalOf(HttpURLConnection connection, long have, long hint) {
        String range = connection.getHeaderField("Content-Range");
        if (range != null) {
            int slash = range.lastIndexOf('/');
            if (slash > 0) {
                try {
                    return Long.parseLong(range.substring(slash + 1).trim());
                } catch (NumberFormatException ignored) {
                    // fall through
                }
            }
        }
        long length = connection.getContentLengthLong();
        if (length > 0) return length + have;
        return hint;
    }

    private void report(long received, long total) {
        JSObject data = new JSObject();
        data.put("received", received);
        data.put("total", total);
        notifyListeners("progress", data);
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        HttpURLConnection c = live;
        if (c != null) {
            // Off the main thread: disconnecting a socket is a network call.
            worker.execute(c::disconnect);
        }
        call.resolve();
    }

    /** Whether Android lets PINGO install apps yet. Before Android 8 there is no such switch. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    /** Opens Android's "Install unknown apps" page on PINGO's own entry, so there is one switch to turn on. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings.");
        }
    }

    /**
     * Hands the downloaded file to Android's installer, as an install SESSION.
     *
     * Not an ACTION_VIEW on the file. That works, but on a phone with more than
     * one app that opens APKs (a store, a file manager, a terminal) Android asks
     * "Open with" first, which is a baffling thing to see in the middle of an
     * update. A session goes to the system installer alone, and the person gets
     * the system's own "Do you want to update this app?" and nothing else.
     *
     * {@code setAppPackageName} also means the installer refuses a file that is
     * not PINGO, whatever it is called.
     */
    @PluginMethod
    public void install(final PluginCall call) {
        final File file = new File(folder(), FINAL_NAME);
        if (!file.exists()) {
            call.reject("There is no downloaded update to install.");
            return;
        }
        worker.execute(() -> {
            try {
                Context context = getContext();
                PackageInstaller installer = context.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(context.getPackageName());
                int id = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(id)) {
                    try (InputStream in = new FileInputStream(file);
                         OutputStream out = session.openWrite("PINGO.apk", 0, file.length())) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                        session.fsync(out);
                    }
                    // Explicit by package: Android 14 refuses a mutable PendingIntent that is not.
                    Intent callback = new Intent(RESULT_ACTION).setPackage(context.getPackageName());
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent pending = PendingIntent.getBroadcast(context, id, callback, flags);
                    installCall = call;
                    session.commit(pending.getIntentSender());
                }
            } catch (Exception e) {
                installCall = null;
                call.reject("Could not open the installer.");
            }
        });
    }

    /** What the installer says back: the confirmation to show, a success, or why it failed. */
    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                PluginCall call = installCall;
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = confirmationOf(intent);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(confirm);
                    }
                    if (call != null) {
                        installCall = null;
                        call.resolve();
                    }
                } else if (status == PackageInstaller.STATUS_SUCCESS) {
                    if (call != null) {
                        installCall = null;
                        call.resolve();
                    }
                } else if (call != null) {
                    installCall = null;
                    String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                    call.reject(message != null ? message : "The install did not finish.");
                }
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(RESULT_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmationOf(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Already gone.
            }
            receiver = null;
        }
    }
}
