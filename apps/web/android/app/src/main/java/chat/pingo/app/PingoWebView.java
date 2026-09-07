package chat.pingo.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.webkit.WebView;

import androidx.core.view.inputmethod.EditorInfoCompat;
import androidx.core.view.inputmethod.InputConnectionCompat;

import com.getcapacitor.CapacitorWebView;

/**
 * The WebView, with one thing added: it tells the keyboard it takes pictures.
 *
 * <h2>Why the GIF button said "this app doesn't support inserting images"</h2>
 *
 * Gboard decides whether to let you send a GIF by reading
 * {@code EditorInfo.contentMimeTypes} off the input connection of whatever has
 * focus. Nothing was ever writing it. {@code MainActivity} sets an
 * {@code OnReceiveContentListener}, which is the half that <em>receives</em> a
 * picture - but a keyboard that believes the field takes text only never sends
 * one, so that half had nothing to receive and the search results stayed grey.
 *
 * Capacitor's own {@code CapacitorWebView} overrides
 * {@code onCreateInputConnection} for its input-capture option and passes
 * {@code outAttrs} straight through untouched, so there was no seam to put this
 * in without a subclass. Hence this class, and hence
 * {@code res/layout/capacitor_bridge_layout_main.xml}, which shadows the
 * library's copy of that layout so this view is the one inflated. The id has to
 * stay {@code webview} - the bridge looks it up by that name.
 *
 * <h2>Why the connection is wrapped</h2>
 *
 * Declaring the types is what makes the keyboard offer a GIF; wrapping is what
 * makes the committed image arrive. {@code createWrapper} routes the keyboard's
 * {@code commitContent} to the view's receive-content listener, which is the
 * one {@code MainActivity} registered. Declare without wrapping and the keyboard
 * offers a GIF that then goes nowhere - worse than the grey button, because it
 * looks like it worked.
 */
public class PingoWebView extends CapacitorWebView {

    /**
     * What the keyboard may send.
     *
     * Images only, and deliberately the wildcard: a keyboard's sticker packs are
     * WebP as often as GIF, and listing types by hand is a list that goes stale
     * the next time one of them changes format. Anything that is not an image
     * is not something a chat composer knows what to do with.
     */
    public static final String[] ACCEPTED_CONTENT = new String[] { "image/*" };

    public PingoWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
        refuseImageLongPress();
    }

    /**
     * No "Save image" sheet on a long press.
     *
     * <h2>What this is fixing</h2>
     *
     * A view-once photo is opened full screen, and holding it brought up
     * Android's own menu with Save image on it. PINGO deliberately offers no
     * save button for a view-limited photo - see {@code PhotoBubble} - so the
     * platform was handing over the one thing the product had refused to.
     *
     * <h2>Why the web guard did not cover it</h2>
     *
     * {@code App.tsx} already cancels {@code contextmenu} for every image and
     * video, which is what stops this in a browser. A WebView does not raise
     * that event for its own long-press menu: it hit-tests the DOM natively and
     * shows the menu itself, so there was nothing for the page to cancel.
     *
     * <h2>Images only</h2>
     *
     * Long-pressing text still selects it, because copying a message is
     * something people do and this is not the place to take it away.
     * {@code IMAGE_TYPE} covers a bare picture and
     * {@code SRC_IMAGE_ANCHOR_TYPE} covers one wrapped in a link, which is what
     * every photo in a thread is - the bubble is a button.
     *
     * A screenshot is still a screenshot. That is a phone, and nothing here
     * pretends otherwise; this removes the one-tap copy that PINGO itself was
     * offering by omission.
     */
    private void refuseImageLongPress() {
        setOnLongClickListener(view -> {
            WebView.HitTestResult hit = getHitTestResult();
            int type = hit == null ? WebView.HitTestResult.UNKNOWN_TYPE : hit.getType();
            return type == WebView.HitTestResult.IMAGE_TYPE
                || type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE;
        });
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection connection = super.onCreateInputConnection(outAttrs);

        /*
         * Null means nothing in the page has focus that can be typed into. There
         * is no field for a GIF to land in, so there is nothing to advertise.
         */
        if (connection == null) {
            return null;
        }

        // Declared before wrapping: the wrapper reads the types back out of
        // outAttrs to decide what it will accept.
        EditorInfoCompat.setContentMimeTypes(outAttrs, ACCEPTED_CONTENT);

        return InputConnectionCompat.createWrapper(this, connection, outAttrs);
    }
}
