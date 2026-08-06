package chat.pingo.app;

import android.content.ClipDescription;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.view.ContentInfoCompat;
import androidx.core.view.OnReceiveContentListener;
import androidx.core.view.ViewCompat;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * The Android shell, plus the one thing a WebView cannot do on its own.
 *
 * <h2>Keyboard GIFs and stickers</h2>
 *
 * Gboard sends an image by committing content to the focused input, and a
 * WebView refuses it: there is no paste event, no file, nothing. Every route
 * from the web side has been tried and none of them work - a contenteditable
 * does not help, and the keyboard simply has nowhere to put the image. So the
 * picture has to be caught in Java and handed across.
 *
 * <h3>Why setOnReceiveContentListener rather than onCreateInputConnection</h3>
 *
 * The old way is to subclass the view and wrap its InputConnection with
 * InputConnectionCompat, which means owning the WebView Capacitor creates -
 * possible, and a fight with every Capacitor upgrade. AndroidX 1.7 added a
 * listener that sits on any view and receives the same content, so nothing has
 * to be subclassed and nothing about the bridge changes.
 *
 * <h3>Base64 rather than a file path</h3>
 *
 * The URI a keyboard hands over is a content:// permission grant, valid for
 * this activity and this moment. Passing the string to JavaScript would hand
 * over something the WebView cannot open. The bytes are read while the grant is
 * alive and given to the page directly, which is also why a large GIF is worth
 * the copy: correctness first, and keyboard images are small.
 */
public class MainActivity extends BridgeActivity {

    /** What the keyboard is allowed to send. Images only - nothing else is expected. */
    private static final String[] ACCEPTED = new String[] { "image/*" };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }

        ViewCompat.setOnReceiveContentListener(webView, ACCEPTED, new OnReceiveContentListener() {
            @Override
            public ContentInfoCompat onReceiveContent(android.view.View view, ContentInfoCompat payload) {
                /*
                 * Split first, so anything that is not an image carries on to the
                 * platform's own handling. Swallowing everything here would break
                 * ordinary text paste, which arrives through this same listener.
                 */
                android.util.Pair<ContentInfoCompat, ContentInfoCompat> parts =
                        payload.partition(item -> item.getUri() != null);

                ContentInfoCompat uriContent = parts.first;
                ContentInfoCompat remaining = parts.second;

                if (uriContent != null) {
                    android.content.ClipData clip = uriContent.getClip();
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri uri = clip.getItemAt(i).getUri();
                        if (uri != null) {
                            deliver(webView, uri, clip.getDescription());
                        }
                    }
                }

                return remaining;
            }
        });
    }

    /**
     * Reads the image and hands it to the page.
     *
     * Failures are swallowed on purpose. A keyboard image that cannot be read is
     * a picture that does not appear, and there is nothing the person holding
     * the phone can do about it - an error dialog over the keyboard would be
     * noise about something they did not ask to go wrong.
     */
    private void deliver(WebView webView, Uri uri, ClipDescription description) {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) {
                return;
            }

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }

            String mime = getContentResolver().getType(uri);
            if (mime == null && description != null && description.getMimeTypeCount() > 0) {
                mime = description.getMimeType(0);
            }
            if (mime == null) {
                mime = "image/png";
            }

            String base64 = Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP);
            final String script =
                    "window.__pingoKeyboardImage && window.__pingoKeyboardImage("
                            + "'" + base64 + "','" + mime + "')";

            // evaluateJavascript has to run on the UI thread; the read above does not.
            webView.post(() -> webView.evaluateJavascript(script, null));
        } catch (Exception ignored) {
            // See the note above.
        }
    }
}
