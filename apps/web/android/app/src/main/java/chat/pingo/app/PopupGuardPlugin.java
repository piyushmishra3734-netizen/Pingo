package chat.pingo.app;

import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps an embedded video page from opening windows of its own.
 *
 * <h2>Why a switch and not a rule</h2>
 *
 * The ads on a streaming embed are mostly popups: the page calls
 * {@code window.open} on the first tap. A cross-origin iframe cannot be
 * reached from the page, and {@code sandbox} breaks the players that detect it,
 * so the only place left is the WebView.
 *
 * But the app itself uses {@code window.open} for real links (a story link, a
 * map), so blocking every window would break those. The page therefore turns
 * the guard on only while an embedded player is on screen, and off again after.
 *
 * Off, the WebView keeps its default of not supporting extra windows, exactly
 * as before this existed. On, it supports them and
 * {@link MainActivity}'s {@code onCreateWindow} refuses every one.
 *
 * {@code setActive({ active: boolean })}
 */
@CapacitorPlugin(name = "PopupGuard")
public class PopupGuardPlugin extends Plugin {

    @PluginMethod
    public void setActive(PluginCall call) {
        final boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        getActivity().runOnUiThread(() -> {
            WebView view = getBridge().getWebView();
            if (view != null) {
                WebSettings settings = view.getSettings();
                settings.setSupportMultipleWindows(active);
                settings.setJavaScriptCanOpenWindowsAutomatically(!active);
            }
            call.resolve();
        });
    }
}
