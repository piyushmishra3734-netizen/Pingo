package chat.pingo.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Telling Android that a call is a call.
 *
 * <h2>Why the volume was wrong</h2>
 *
 * A WebView plays WebRTC audio like any other page audio: on the music stream,
 * at whatever the media volume happens to be, with the routing a video gets. So
 * the phone's volume keys during a PINGO call were adjusting the same slider as
 * YouTube, the in-call volume curve never applied, and people turned the media
 * volume up to hear each other - which is exactly what was reported.
 *
 * {@code MODE_IN_COMMUNICATION} is what switches that. It moves playback to the
 * voice-call stream, so the volume keys reach the in-call slider that Android
 * remembers separately and that starts far louder for speech; it enables the
 * platform's own echo canceller and gain control on the capture side; and it
 * makes the earpiece-versus-speaker choice mean something.
 *
 * <h2>Why focus is requested too</h2>
 *
 * Without audio focus, music keeps playing underneath a call. With it, the
 * other app is asked to stop and told when to resume - which is the behaviour
 * every phone call on the device already has, and its absence is why a call
 * over a playing track was unintelligible.
 *
 * <h2>Why the page drives it</h2>
 *
 * The mode has to be set for the length of the call and put back afterwards, or
 * every other sound in the app comes out of the earpiece. Only the page knows
 * when a call starts and ends, so it says so.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    private AudioFocusRequest focus;
    private int previousMode = AudioManager.MODE_NORMAL;
    private boolean active = false;

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /** Call started. Speech routing, platform AEC, and the in-call volume slider. */
    @PluginMethod
    public void start(PluginCall call) {
        AudioManager manager = audio();
        if (manager == null) {
            call.reject("No audio service.");
            return;
        }

        try {
            if (!active) previousMode = manager.getMode();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(attributes)
                    .build();
                manager.requestAudioFocus(focus);
            } else {
                manager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                );
            }

            manager.setMode(AudioManager.MODE_IN_COMMUNICATION);

            /*
             * Speaker on by default, because a WebView call has no proximity
             * sensor behaviour and no earpiece affordance - somebody holding
             * the phone to their ear would get nothing. The page can turn it
             * off once there is a control for it.
             */
            boolean speaker = call.getBoolean("speaker", Boolean.TRUE);
            manager.setSpeakerphoneOn(Boolean.TRUE.equals(speaker));

            active = true;
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not switch to call audio.", e);
        }
    }

    /** Which ear it comes out of, while a call is running. */
    @PluginMethod
    public void setSpeaker(PluginCall call) {
        AudioManager manager = audio();
        if (manager == null) {
            call.reject("No audio service.");
            return;
        }
        manager.setSpeakerphoneOn(Boolean.TRUE.equals(call.getBoolean("on", Boolean.TRUE)));
        call.resolve();
    }

    /**
     * Call over. Everything goes back.
     *
     * Not optional and not best-effort from the page's point of view: a phone
     * left in communication mode plays every later notification and voice note
     * out of the earpiece at a whisper, and nothing in the app would explain
     * why. So this is safe to call twice and safe to call when no call ran.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        AudioManager manager = audio();
        if (manager == null) {
            call.resolve();
            return;
        }
        try {
            manager.setMode(previousMode);
            manager.setSpeakerphoneOn(false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focus != null) manager.abandonAudioFocusRequest(focus);
            } else {
                manager.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {
            // Restoring failed; there is nothing further to try and failing the
            // call teardown would be worse than a wrong audio mode.
        }
        focus = null;
        active = false;
        call.resolve();
    }
}
