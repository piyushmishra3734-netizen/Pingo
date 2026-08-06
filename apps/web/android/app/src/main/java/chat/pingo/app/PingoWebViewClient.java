package chat.pingo.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Capacitor's web view client, plus one path of our own.
 *
 * Everything the app loads is answered by Capacitor's local server, which is
 * exactly right and has no notion of a file another app just handed us. Rather
 * than copying that file somewhere the server can see - a copy of a video, on a
 * phone, to send it once - this answers one path directly from the share's own
 * content URI.
 *
 * A subclass rather than a replacement: {@code super} still handles every other
 * request, so navigation, assets and the bridge behave exactly as they did.
 */
public class PingoWebViewClient extends BridgeWebViewClient {

    private final SharedFiles shared;

    public PingoWebViewClient(Bridge bridge, SharedFiles shared) {
        super(bridge);
        this.shared = shared;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (shared.handles(request)) {
            return shared.serve(request);
        }
        return super.shouldInterceptRequest(view, request);
    }
}
