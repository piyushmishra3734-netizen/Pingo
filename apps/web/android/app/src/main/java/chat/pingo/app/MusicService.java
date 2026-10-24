package chat.pingo.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.net.wifi.WifiManager;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The song playing in PINGO, on the phone itself: the notification shade, the
 * lock screen, Quick Settings' media player, headphones and the car.
 *
 * <h2>Why this exists</h2>
 *
 * The music plays inside the WebView, and Android's WebView, unlike Chrome,
 * never tells the system about it: {@code navigator.mediaSession} is accepted
 * and ignored. So a song played in PINGO had no player anywhere outside the
 * app. This is that player. The page drives it ({@link MediaControlsPlugin})
 * and every button pressed here goes back to the page, which owns the audio.
 *
 * <h2>Foreground while playing</h2>
 *
 * A foreground service of type mediaPlayback, as every music app uses, which
 * is also what keeps Android from pausing the app a minute after the screen
 * goes off. Paused, it steps out of the foreground and leaves the notification
 * behind, so it can be swiped away like Spotify's. Only framework classes, so
 * nothing new to download into the build.
 */
public class MusicService extends Service {

    static final String CHANNEL = "music";
    static final int NOTIFICATION_ID = 7301;

    static final String ACTION_UPDATE = "chat.pingo.app.music.UPDATE";
    static final String ACTION_CONTROL = "chat.pingo.app.music.CONTROL";

    /** What the page last said. Read by the service when it starts. */
    static final class Info {
        String title = "";
        String artist = "";
        String artwork = "";
        boolean playing;
        long positionMs;
        long durationMs;
        float speed = 1f;
        boolean hasNext;
        boolean hasPrev;
    }

    static volatile Info latest;
    private static volatile MusicService instance;

    /** Hands a button press to the page. Set by the plugin while the bridge is alive. */
    interface Listener {
        void onAction(String action, long positionMs);
    }

    static volatile Listener listener;

    private MediaSession session;
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private String artworkUrl = "";
    private Bitmap artwork;
    private boolean foreground;

    /**
     * How long the service stays in the foreground after the song stops.
     *
     * Between two songs the player reports "not playing" for as long as the next
     * one takes to start (a lookup and a download on a poor connection). Leaving the
     * foreground at that moment is what stopped the music with the screen off:
     * Android lets a backgrounded app freeze, and does not let it climb back into
     * the foreground. So the service waits; a song that starts again cancels it, and
     * a pause that stays a pause leaves the foreground (and can be swiped away)
     * after this.
     */
    private static final long LINGER_MS = 25_000;
    private final Runnable leaveForeground = new Runnable() {
        @Override public void run() {
            Info info = latest;
            if (info != null && info.playing) return;
            if (foreground) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_DETACH);
                else stopForeground(false);
                foreground = false;
            }
            releaseLocks();
            if (info != null && session != null) manager().notify(NOTIFICATION_ID, build(info));
        }
    };

    /** Keep the CPU and the Wi-Fi radio awake while music plays with the screen off. */
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private void holdLocks() {
        try {
            if (wakeLock == null) {
                PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (power != null) wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pingo:music");
            }
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
            if (wifiLock == null) {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "pingo:music");
            }
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (RuntimeException ignored) {
            // A phone that refuses the lock still plays; it may just sleep sooner.
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (RuntimeException ignored) {
            // Already gone.
        }
    }

    /** Shows or refreshes the player. Starts the service the first time. */
    static void show(Context context, Info info) {
        latest = info;
        MusicService running = instance;
        if (running != null) {
            running.apply();
            return;
        }
        Intent start = new Intent(context, MusicService.class).setAction(ACTION_UPDATE);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(start);
            else context.startService(start);
        } catch (RuntimeException notAllowed) {
            // Android 12+ refuses to start one from the background. The next
            // update from the page while it is on screen starts it.
        }
    }

    /** Takes the player away: the song was closed. */
    static void hide() {
        latest = null;
        MusicService running = instance;
        if (running != null) running.stopEverything();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        ensureChannel();
        session = new MediaSession(this, "PINGO Music");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play", -1); }
            @Override public void onPause() { send("pause", -1); }
            @Override public void onSkipToNext() { send("next", -1); }
            @Override public void onSkipToPrevious() { send("prev", -1); }
            @Override public void onStop() { send("stop", -1); }
            @Override public void onSeekTo(long pos) { send("seek", pos); }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_CONTROL.equals(action)) {
            String what = intent.getStringExtra("what");
            if (what != null) send(what, -1);
            // A press can arrive after the service was restarted with nothing to show.
            if (latest == null) { stopEverything(); return START_NOT_STICKY; }
        }
        if (latest == null) {
            // Started with nothing to show: still has to go foreground once, or Android kills the app.
            startAsForeground(baseBuilder().setContentTitle("PINGO Music").build());
            stopEverything();
            return START_NOT_STICKY;
        }
        // Started by startForegroundService (the page, or a button on the
        // notification): it must go foreground now, whatever happens next.
        if (!foreground) startAsForeground(build(latest));
        apply();
        return START_NOT_STICKY;
    }

    private void send(String action, long positionMs) {
        Listener l = listener;
        if (l != null) l.onAction(action, positionMs);
        else if ("stop".equals(action)) stopEverything();
    }

    /** Brings the session and the notification up to date with {@link #latest}. */
    private void apply() {
        Info info = latest;
        if (info == null || session == null) return;

        MediaMetadata.Builder meta = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, info.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, info.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, "PINGO Music");
        if (info.durationMs > 0) meta.putLong(MediaMetadata.METADATA_KEY_DURATION, info.durationMs);
        if (artwork != null && info.artwork.equals(artworkUrl)) meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(meta.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
        if (info.hasNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (info.hasPrev) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(info.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                info.positionMs, info.playing ? info.speed : 0f)
            .build());

        Notification notification = build(info);
        if (info.playing) {
            main.removeCallbacks(leaveForeground);
            holdLocks();
            startAsForeground(notification);
        } else {
            // Updated in place, still foreground: it leaves only if nothing starts within LINGER_MS.
            manager().notify(NOTIFICATION_ID, notification);
            main.removeCallbacks(leaveForeground);
            main.postDelayed(leaveForeground, LINGER_MS);
        }

        if (!info.artwork.isEmpty() && !info.artwork.equals(artworkUrl)) loadArtwork(info.artwork);
    }

    private void startAsForeground(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            foreground = true;
        } catch (RuntimeException notAllowed) {
            // Resumed from the background on a phone that will not allow it: still shown, just not foreground.
            manager().notify(NOTIFICATION_ID, notification);
        }
    }

    private Notification.Builder baseBuilder() {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        return b.setSmallIcon(R.drawable.ic_notification).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC);
    }

    private Notification build(Info info) {
        Notification.Builder b = baseBuilder()
            .setContentTitle(info.title)
            .setContentText(info.artist)
            .setSubText("PINGO Music")
            .setOngoing(info.playing)
            .setContentIntent(session.getController().getSessionActivity())
            .setDeleteIntent(control("stop", 9));
        if (artwork != null && info.artwork.equals(artworkUrl)) b.setLargeIcon(artwork);

        int shown = 0;
        int[] compact;
        if (info.hasPrev) { b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", control("prev", 1)).build()); shown++; }
        int playIndex = shown;
        b.addAction(info.playing
            ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pause", control("pause", 2)).build()
            : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Play", control("play", 3)).build());
        shown++;
        if (info.hasNext) { b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", control("next", 4)).build()); shown++; }
        compact = shown == 3 ? new int[] {0, 1, 2} : shown == 2 ? new int[] {0, 1} : new int[] {playIndex};

        if (!showsMediaStyle()) {
            // A plain ongoing notification with the same buttons; see showsMediaStyle().
            return b.build();
        }
        b.setCategory(Notification.CATEGORY_TRANSPORT);
        b.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(compact));
        return b.build();
    }

    /**
     * Whether this phone draws a media-style notification.
     *
     * Measured on a vivo phone running OriginOS 7: Android's SystemUI had the
     * session (playing, with its title) and the foreground service, yet the shade
     * showed no player and no notification for it, while every other ongoing
     * notification was there. vivo's shade does not draw media-style notifications
     * from other apps. A plain ongoing notification with the same Previous /
     * Pause / Next buttons does show, so on vivo and iQOO that is what is posted;
     * the media session behind it is unchanged, so headphones, the car and the
     * lock screen still work. Every other phone gets the media notification.
     */
    private static boolean showsMediaStyle() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(java.util.Locale.ROOT);
        return !(maker.contains("vivo") || maker.contains("iqoo"));
    }

    private PendingIntent control(String what, int code) {
        Intent intent = new Intent(this, MusicService.class).setAction(ACTION_CONTROL).putExtra("what", what);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? PendingIntent.getForegroundService(this, code, intent, flags)
            : PendingIntent.getService(this, code, intent, flags);
    }

    private void loadArtwork(String url) {
        artworkUrl = url;
        artwork = null;
        loader.execute(() -> {
            Bitmap bitmap = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                try (InputStream in = connection.getInputStream()) {
                    bitmap = BitmapFactory.decodeStream(in);
                }
            } catch (Exception ignored) {
                // No picture: the player still works.
            } finally {
                if (connection != null) connection.disconnect();
            }
            Bitmap loaded = bitmap;
            main.post(() -> {
                if (!url.equals(artworkUrl) || loaded == null) return;
                artwork = loaded;
                apply();
            });
        });
    }

    private void stopEverything() {
        main.removeCallbacks(leaveForeground);
        releaseLocks();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        foreground = false;
        manager().cancel(NOTIFICATION_ID);
        stopSelf();
    }

    private NotificationManager manager() {
        return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Music", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("The song playing in PINGO");
        channel.setShowBadge(false);
        manager().createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        instance = null;
        main.removeCallbacks(leaveForeground);
        releaseLocks();
        if (session != null) { session.setActive(false); session.release(); session = null; }
        loader.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
