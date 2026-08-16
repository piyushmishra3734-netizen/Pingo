package chat.pingo.app;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screen sharing on Android, which the browser cannot do at all.
 *
 * <h2>Why this has to exist</h2>
 *
 * Chrome and Firefox on Android ship {@code getDisplayMedia} and reject every
 * call to it - the API is defined and not implemented - and a Chromium WebView
 * is no different. There is no web route to a phone's screen. {@code
 * MediaProjection} is the only one, and it is a platform API.
 *
 * <h2>Why it joins the call a second time</h2>
 *
 * MediaProjection produces frames in the app, and there is no supported way to
 * hand them to the WebView's own WebRTC stack. So the native side connects to
 * the same LiveKit room itself and publishes the screen from there.
 *
 * LiveKit evicts the existing participant when a second joins under the same
 * identity, so the web page's connection would be dropped the moment this one
 * arrived. The token this receives is minted for {@code <user>#screen} instead -
 * see the {@code screen} flag in the {@code livekit-token} function - and it is
 * a deliberately weaker pass: it may publish a screen and nothing else, and it
 * may not subscribe to anybody. A phone has no reason to download everybody
 * else's video a second time to render it nowhere.
 *
 * <h2>The consent dialog is not optional and cannot be pre-empted</h2>
 *
 * Android requires the system's own screen-capture dialog for every session,
 * and the result arrives on an activity callback rather than as a permission
 * grant. There is no way to remember it, and that is the point of it.
 *
 * <h2>The foreground service is not optional either</h2>
 *
 * From Android 14 a MediaProjection session must be owned by a foreground
 * service of type {@code mediaProjection}, and the service has to be running
 * <em>before</em> the projection is used. Starting it after is the mistake that
 * throws {@code SecurityException} on exactly the newest devices and works
 * everywhere else, which is the worst way for it to fail.
 */
@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {

    /** Held between the consent dialog and the service that will own it. */
    private String pendingUrl;
    private String pendingToken;

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        String token = call.getString("token");
        if (url == null || token == null) {
            call.reject("A room url and token are required.");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            call.reject("This device cannot capture its screen.");
            return;
        }

        pendingUrl = url;
        pendingToken = token;

        MediaProjectionManager manager =
                (MediaProjectionManager)
                        getContext().getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("This device cannot capture its screen.");
            return;
        }

        // The system dialog. Every session needs its own; there is no
        // remembering it, by design.
        startActivityForResult(call, manager.createScreenCaptureIntent(), "captureConsent");
    }

    @ActivityCallback
    private void captureConsent(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            /*
             * Declined, which is ordinary and not an error worth shouting
             * about. The web side shows a retry and the call carries on - the
             * same as somebody closing the picker on a desktop.
             */
            call.reject("Screen sharing was not allowed.");
            return;
        }

        Intent service = new Intent(getContext(), ScreenCaptureService.class);
        service.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
        service.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
        service.putExtra(ScreenCaptureService.EXTRA_URL, pendingUrl);
        service.putExtra(ScreenCaptureService.EXTRA_TOKEN, pendingToken);

        pendingUrl = null;
        pendingToken = null;

        /*
         * Foreground, and before the projection is touched. See the note above:
         * from Android 14 the projection belongs to the service, and starting
         * it the other way round fails only on the newest devices.
         */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(service);
        } else {
            getContext().startService(service);
        }

        call.resolve(new JSObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent service = new Intent(getContext(), ScreenCaptureService.class);
        service.setAction(ScreenCaptureService.ACTION_STOP);
        getContext().startService(service);
        call.resolve(new JSObject());
    }
}
