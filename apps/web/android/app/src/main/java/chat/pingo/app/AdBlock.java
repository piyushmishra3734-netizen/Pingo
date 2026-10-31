package chat.pingo.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.util.Collections;

/**
 * Refuses requests to known ad networks while an embedded player is on screen.
 *
 * <h2>Why here</h2>
 *
 * A streaming embed is a cross-origin iframe, so the page cannot reach into it,
 * and {@code sandbox} would stop its ads but also trips the players that detect
 * it. The WebView, though, sees every request the iframe makes, whoever's page
 * it is. Answering the ad hosts with an empty response here needs nothing from
 * the player and nothing it can detect beyond a script that did not load.
 *
 * <h2>Only while a player is on screen</h2>
 *
 * Switched by {@link PopupGuardPlugin}, the same switch that refuses popups, so
 * the rest of the app never passes through the list.
 *
 * <h2>The list is short on purpose</h2>
 *
 * Ad networks and pop-under services only. A host that also serves video or the
 * player's own code does not belong here: blocking one of those is a black
 * rectangle, which is worse than an ad.
 */
final class AdBlock {

    private static volatile boolean active = false;

    private static final String[] HOSTS = {
        // Google ads
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "pagead2.googlesyndication.com", "tpc.googlesyndication.com",
        // Pop-under and push-ad networks that streaming embeds use
        "popads.net", "popcash.net", "propellerads.com", "propellerclick.com", "onclickads.net",
        "onclkds.com", "exoclick.com", "exosrv.com", "exdynsrv.com", "juicyads.com", "adsterra.com",
        "highperformanceformat.com", "profitableratecpm.com", "effectivegatecpm.com", "realsrv.com",
        "trafficjunky.net", "clickadu.com", "hilltopads.net", "adcash.com", "admaven.com", "ad-maven.com",
        "bidvertiser.com", "tsyndicate.com", "a-ads.com", "adnxs.com", "popunderjs.com", "clickaine.com",
        "go.oclasrv.com", "oclasrv.com", "ads.exosrv.com",
        // Native-ad widgets
        "taboola.com", "outbrain.com", "mgid.com", "revcontent.com",
    };

    private AdBlock() {}

    static void setActive(boolean value) {
        active = value;
    }

    /**
     * True when the top-level page is being sent somewhere else while a player is on screen.
     *
     * An embed's ad calls {@code window.top.location = ...}. For the WebView that
     * is a navigation of the app's own page to a foreign site, which Capacitor
     * hands to the system browser: the app jumps out to some web page. While a
     * player is showing nothing legitimate does that, so it is simply refused.
     * Loads inside the iframe itself are not main-frame requests and pass.
     */
    static boolean blocksTopNavigation(WebResourceRequest request, String currentUrl) {
        if (!active || !request.isForMainFrame()) return false;
        String target = request.getUrl().getHost();
        if (target == null) return false;
        String scheme = request.getUrl().getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
        String here = currentUrl == null ? null : android.net.Uri.parse(currentUrl).getHost();
        return here == null || !target.equalsIgnoreCase(here);
    }

    /** True when the request should be answered empty instead of being made. */
    static boolean blocks(WebResourceRequest request) {
        if (!active || request.isForMainFrame()) return false;
        String host = request.getUrl().getHost();
        if (host == null) return false;
        host = host.toLowerCase();
        for (String blocked : HOSTS) {
            if (host.equals(blocked) || host.endsWith("." + blocked)) {
                android.util.Log.d("PingoAdBlock", "blocked " + host);
                return true;
            }
        }
        return false;
    }

    static WebResourceResponse empty() {
        return new WebResourceResponse(
            "text/plain",
            "utf-8",
            204,
            "No Content",
            Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0])
        );
    }
}
