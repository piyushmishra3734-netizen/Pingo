package chat.pingo.app;

import android.content.ClipDescription;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.ContentInfoCompat;
import androidx.core.view.OnReceiveContentListener;
import androidx.core.view.ViewCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

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
 * <h3>Two halves, and this is only one of them</h3>
 *
 * The listener below is what a committed image arrives at. It is not what makes
 * the keyboard offer one: that is a declaration on the input connection, and it
 * lives in {@link PingoWebView}. This half was built first and alone, which is
 * why the GIF button went on saying the app did not support images - there was
 * a catcher in place and nothing was ever thrown.
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

    /*
     * What the keyboard is allowed to send, taken from the view rather than
     * written out again here.
     *
     * The two have to agree exactly: PingoWebView declares this list to the
     * keyboard, and this listener is what the keyboard's image is delivered to.
     * Two copies would let them drift, and the failure would be silent - a
     * keyboard offering a picture this listener then refuses.
     */
    private static final String[] ACCEPTED = PingoWebView.ACCEPTED_CONTENT;

    /** Request code for the microphone prompt raised on the page's behalf. */
    private static final int MIC_PERMISSION = 4711;

    /**
     * The page's request, held while Android asks the user.
     *
     * Granted straight away if the answer comes back yes, so somebody who
     * allows it does not also have to press call a second time.
     */
    private PermissionRequest pendingMicRequest;

    @Override
    public void onRequestPermissionsResult(
        int requestCode, String[] permissions, int[] results
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != MIC_PERMISSION || pendingMicRequest == null) {
            return;
        }

        boolean allowed = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (allowed) {
            pendingMicRequest.grant(
                new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE }
            );
        } else {
            pendingMicRequest.deny();
        }
        pendingMicRequest = null;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /*
         * Registered before super, which is where Capacitor builds the bridge.
         * A plugin added afterwards is not in the map the page asks, so
         * `Capacitor.isPluginAvailable('ScreenCapture')` answers false and the
         * share control hides itself on the one platform that needs it.
         */
        registerPlugin(ScreenCapturePlugin.class);
        registerPlugin(VideoTranscodePlugin.class);
        registerPlugin(CallAudioPlugin.class);

        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }

        /*
         * The page needs a way to say "I am ready now", because a share often
         * arrives before the WebView has loaded. Only flushShare is exposed -
         * an interface is a hole in the sandbox, and it should be exactly the
         * size of the one thing that has to cross.
         */
        webView.addJavascriptInterface(this, "AndroidShare");

        /*
         * Passkeys for the backup lock.
         *
         * Its own object rather than more methods on this one: the share
         * bridge is two small calls and this is a credential API, and putting
         * them on one interface would mean every method of both is reachable
         * from any page the WebView ever loads.
         */
        webView.addJavascriptInterface(new PasskeyBridge(this, webView), "AndroidPasskey");

        /*
         * The microphone, which a WebView refuses by default.
         *
         * `getUserMedia` inside a WebView does not go to the system permission
         * dialog. It calls `onPermissionRequest` on the host app, and an app
         * that does not implement it denies silently - which the page then
         * reports as no microphone at all. That is the "PINGO ke paas
         * microphone nahi hai" on every phone: the permission was in the
         * manifest, granted by the user, and never handed across.
         *
         * Two gates, and both have to pass. Android must have granted RECORD_AUDIO
         * to the app, and the app must then grant it to the page.
         */
        /*
         * Extends Capacitor's client. Emphatically not `WebChromeClient`.
         *
         * It was a bare `new WebChromeClient()`, which replaced
         * `BridgeWebChromeClient` outright - and that class is not decoration.
         * It carries `onShowFileChooser`, which is the only thing that makes
         * `<input type="file">` do anything at all; `onJsAlert` / `onJsConfirm`
         * / `onJsPrompt`, without which `confirm()` returns instantly and every
         * button behind one is dead; `onShowCustomView`, which is how a WebView
         * plays a video full-screen; and the geolocation prompt.
         *
         * So one line took out the gallery picker, a pile of buttons, and
         * story playback, and none of it failed loudly - a file input that
         * opens nothing looks exactly like a button that was never wired up,
         * which is what it was reported as.
         *
         * The mic handling below is the only reason to subclass at all;
         * everything else defers to the class that already does it.
         */
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            /*
             * Watched on the way past, not intercepted.
             *
             * Capacitor's implementation is what actually opens the chooser and
             * answers the page; this only wraps the callback so the chosen URIs
             * are recorded before the page is told about them. The page gets a
             * `File` with a name and a size and no URI, and the native side
             * needs the URI to transcode a video - see PickedFiles.
             */
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
            ) {
                return super.onShowFileChooser(view, (Uri[] uris) -> {
                    try {
                        PickedFiles.remember(MainActivity.this, uris);
                    } catch (Exception ignored) {
                        // Recording is a convenience. Never fail a pick for it.
                    }
                    callback.onReceiveValue(uris);
                }, params);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsAudio = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            wantsAudio = true;
                        }
                    }

                    if (!wantsAudio) {
                        /*
                         * Handed back rather than denied.
                         *
                         * This used to `deny()` everything that was not audio,
                         * on the reasoning that a WebChromeClient should not
                         * broaden what a page can reach. True - but denying is
                         * not neutral either, and the thing being denied was
                         * the camera, which Capacitor grants properly against
                         * the manifest and the user's own answer. Refusing it
                         * here meant `getUserMedia({ video: true })` failed on
                         * a phone whose owner had already said yes.
                         */
                        super.onPermissionRequest(request);
                        return;
                    }

                    boolean held = ContextCompat.checkSelfPermission(
                        MainActivity.this, Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED;

                    if (held) {
                        request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                        return;
                    }

                    /*
                     * Not granted yet, so ask - and deny this request rather
                     * than holding it open. The system dialog is asynchronous
                     * and the page has already been told no by the time it
                     * closes; the honest thing is for the page to be told to
                     * try again, which is what it says on screen.
                     */
                    pendingMicRequest = request;
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[] { Manifest.permission.RECORD_AUDIO },
                        MIC_PERMISSION
                    );
                });
            }
        });

        /*
         * Shared files are answered on their own path, so the client has to be
         * ours. Installed before the share is read, or the very share that
         * started the app would be described to a page that cannot fetch it.
         */
        sharedFiles = new SharedFiles(getContentResolver());
        getBridge().setWebViewClient(new PingoWebViewClient(getBridge(), sharedFiles));

        handleShare(getIntent());

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

    /*
     * `singleTask`, so a share into an already running app arrives here rather
     * than through onCreate. Without this the first share works and every one
     * after it silently does nothing, which is the classic shape of this bug.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent);
    }

    private String pendingText;
    /*
     * Renamed from `pendingImages`, because it is no longer only images.
     *
     * PINGO appears in the share sheet for anything now - a PDF, a video, a
     * spreadsheet - and every one of them arrives here the same way. The old
     * name was accurate when the manifest claimed images only, and the moment
     * that changed it became a comment that lies.
     */
    private final java.util.ArrayList<Uri> pendingFiles = new java.util.ArrayList<>();
    private SharedFiles sharedFiles;

    /**
     * Content shared into PINGO from another app.
     *
     * Collected first, delivered second. A share can arrive before the WebView
     * has finished loading - the app is often starting *because* of the share -
     * and posting into a page that does not exist yet loses it with nothing to
     * show for it. So it is held, and handed over when the page asks.
     */
    private void handleShare(Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }

        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text != null) {
            pendingText = text;
        }

        if (Intent.ACTION_SEND.equals(action)) {
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) {
                pendingFiles.add(single);
            }
        } else {
            java.util.ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) {
                pendingFiles.addAll(many);
            }
        }

        flushShare();
    }

    /**
     * Hands whatever is waiting to the page, if the page is listening.
     *
     * Called on arrival and again from JavaScript once a composer mounts, so
     * whichever of the two happens second is the one that delivers.
     */
    @android.webkit.JavascriptInterface
    public void flushShare() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            return;
        }

        if (pendingText != null) {
            final String script = "window.__pingoSharedText && window.__pingoSharedText("
                    + org.json.JSONObject.quote(pendingText) + ")";
            webView.post(() -> webView.evaluateJavascript(script, null));
            pendingText = null;
        }

        java.util.List<Uri> files = new java.util.ArrayList<>(pendingFiles);
        pendingFiles.clear();
        if (files.isEmpty() || sharedFiles == null) {
            return;
        }

        /*
         * Described, not delivered.
         *
         * Each file is registered and the page is handed a name, a type, a size
         * and a URL to fetch. It reads them itself, over the WebView's own
         * request path, so a shared video is streamed rather than turned into a
         * base64 string a third larger than the file.
         *
         * The name matters as much as the bytes: a document that arrives called
         * `shared-1754500000.bin` is a document nobody can identify afterwards.
         */
        java.util.List<org.json.JSONObject> described = new java.util.ArrayList<>();
        for (Uri uri : files) {
            org.json.JSONObject one = sharedFiles.offer(uri);
            if (one != null) described.add(one);
        }
        if (described.isEmpty()) {
            return;
        }

        final String script = "window.__pingoSharedFiles && window.__pingoSharedFiles("
                + SharedFiles.arrayOf(described) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    /**
     * Saves a picture to the phone gallery.
     *
     * The web does this with an anchor carrying `download`, and inside a WebView
     * that does nothing at all - no file, no error, no download notification.
     * Save on a Ping looked like it worked and never produced anything.
     *
     * MediaStore rather than a path. Writing to external storage directly needs
     * a permission on Android 9 and below and is refused outright on 10 and
     * above; MediaStore needs neither, because the file is created by the
     * provider on the app's behalf. Nothing here asks the user for anything.
     *
     * @param base64 the image bytes, as the page already has them
     * @param mime   used to pick the album entry's type
     * @return true when a file was written, so the page can say so honestly
     */
    /**
     * The same thing for a video, on the shelf a video belongs on.
     *
     * Not a parameter on `saveToGallery`, because the two differ in more than a
     * flag: a different MediaStore collection, a different default type, and a
     * different album directory. Sending a video through the image path does
     * not fail - it writes the bytes into `MediaStore.Images`, where the
     * gallery indexes it as a picture and shows a thumbnail that will not open.
     * A save that appears to work and produces something unplayable is worse
     * than one that refuses, which is why this exists rather than a branch.
     *
     * @param base64 the video bytes, as the page already has them
     * @param mime   used to pick the extension and the entry's type
     * @return true when a file was written, so the page can stop rather than
     *         also handing the URL to the system and downloading it twice
     */
    @android.webkit.JavascriptInterface
    public boolean saveVideoToGallery(String base64, String mime) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);

            String extension = "mp4";
            if (mime != null) {
                int slash = mime.indexOf('/');
                if (slash != -1) {
                    String subtype = mime.substring(slash + 1).split(";")[0].trim().toLowerCase();
                    // `quicktime` is the mime for `.mov`, and the subtype is not
                    // the extension for it - the one case where they differ.
                    if (subtype.equals("quicktime")) {
                        extension = "mov";
                    } else if (subtype.matches("[a-z0-9]+")) {
                        extension = subtype;
                    }
                }
            }
            String name = "PINGO-" + System.currentTimeMillis() + "." + extension;

            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Video.Media.MIME_TYPE, mime == null ? "video/mp4" : mime);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(
                        MediaStore.Video.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_MOVIES + "/PINGO");
            }

            Uri target = getContentResolver()
                    .insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
            if (target == null) {
                return false;
            }

            try (OutputStream out = getContentResolver().openOutputStream(target)) {
                if (out == null) {
                    return false;
                }
                out.write(bytes);
            }

            return true;
        } catch (Exception failed) {
            return false;
        }
    }

    @android.webkit.JavascriptInterface
    public boolean saveToGallery(String base64, String mime) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            /*
             * The extension comes from the type rather than from a list of the
             * two formats somebody thought of at the time. A GIF filed as
             * `.jpg` is a still picture as far as most galleries are concerned,
             * and a GIF is now something a keyboard can send.
             */
            String extension = "jpg";
            if (mime != null) {
                int slash = mime.indexOf('/');
                if (slash != -1) {
                    String subtype = mime.substring(slash + 1).split(";")[0].trim().toLowerCase();
                    if (subtype.matches("[a-z0-9]+") && !subtype.equals("jpeg")) {
                        extension = subtype;
                    }
                }
            }
            String name = "PINGO-" + System.currentTimeMillis() + "." + extension;

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Images.Media.MIME_TYPE, mime == null ? "image/jpeg" : mime);

            /*
             * Its own album from Android 10 onward.
             *
             * RELATIVE_PATH does not exist below that, and setting it there
             * throws rather than being ignored - so the older path lets the
             * provider choose, which lands in Pictures.
             */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(
                        MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/PINGO");
            }

            Uri target = getContentResolver()
                    .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (target == null) {
                return false;
            }

            try (OutputStream out = getContentResolver().openOutputStream(target)) {
                if (out == null) {
                    return false;
                }
                out.write(bytes);
            }

            return true;
        } catch (Exception failed) {
            return false;
        }
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
