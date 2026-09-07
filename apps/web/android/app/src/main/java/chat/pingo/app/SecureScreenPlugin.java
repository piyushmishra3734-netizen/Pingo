package chat.pingo.app;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screenshots off, for as long as a view-once photo is on screen.
 *
 * <h2>Why it is not on for the whole app</h2>
 *
 * {@code FLAG_SECURE} is a window flag, and a window is all of PINGO. Left on
 * it would take away the screenshot of an ordinary conversation - which people
 * take, and which is nobody's secret - stop anyone screen-recording a bug for
 * us, and paint the app black in the recents switcher, which reads as broken
 * rather than as careful.
 *
 * It would also break screen sharing. {@code ScreenCapturePlugin} publishes the
 * phone's screen into a call through MediaProjection, and MediaProjection obeys
 * this flag: the feature would keep working and send black frames.
 *
 * So it goes on when a picture that is meant to be seen once is open, and off
 * the moment it closes. That is the only moment where the promise and the
 * platform disagree.
 *
 * <h2>What it does not do</h2>
 *
 * Nothing on the web, where no such API exists in any browser - a view-once
 * photo opened at pingochat.pages.dev can still be captured, and no amount of
 * native code changes that.
 *
 * And nothing at all about a second phone pointed at the screen. This closes
 * the one-button copy; it does not pretend to close the rest.
 */
@CapacitorPlugin(name = "SecureScreen")
public class SecureScreenPlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        apply(true);
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        apply(false);
        call.resolve();
    }

    /**
     * Window flags belong to the UI thread, and a plugin call does not arrive
     * on it. Setting them from here without the hop throws on some devices and
     * silently does nothing on others, which is the worse of the two.
     */
    private void apply(boolean secure) {
        if (getActivity() == null) {
            return;
        }

        getActivity()
            .runOnUiThread(() -> {
                if (secure) {
                    getActivity()
                        .getWindow()
                        .setFlags(
                            WindowManager.LayoutParams.FLAG_SECURE,
                            WindowManager.LayoutParams.FLAG_SECURE
                        );
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
            });
    }
}
