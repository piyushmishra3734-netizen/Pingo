package chat.pingo.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page's side of {@link MusicService}: it says what is playing, and hears
 * back the buttons pressed on the notification, the lock screen and headphones.
 *
 * {@code update({ title, artist, artwork, playing, positionMs, durationMs, speed, hasNext, hasPrev })}
 * {@code clear()}
 * Event {@code action}: {@code { action: play|pause|next|prev|stop|seek, positionMs }}
 */
@CapacitorPlugin(name = "MediaControls")
public class MediaControlsPlugin extends Plugin {

    @Override
    public void load() {
        MusicService.listener = (action, positionMs) -> {
            JSObject event = new JSObject();
            event.put("action", action);
            if (positionMs >= 0) event.put("positionMs", positionMs);
            notifyListeners("action", event);
        };
    }

    @Override
    protected void handleOnDestroy() {
        MusicService.listener = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void update(PluginCall call) {
        MusicService.Info info = new MusicService.Info();
        info.title = call.getString("title", "");
        info.artist = call.getString("artist", "");
        info.artwork = call.getString("artwork", "");
        info.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        info.positionMs = Math.max(0, call.getDouble("positionMs", 0d).longValue());
        info.durationMs = Math.max(0, call.getDouble("durationMs", 0d).longValue());
        info.speed = call.getFloat("speed", 1f);
        info.hasNext = Boolean.TRUE.equals(call.getBoolean("hasNext", false));
        info.hasPrev = Boolean.TRUE.equals(call.getBoolean("hasPrev", false));
        MusicService.show(getContext(), info);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        MusicService.hide();
        call.resolve();
    }
}
