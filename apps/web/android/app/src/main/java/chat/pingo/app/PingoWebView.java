package chat.pingo.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

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
