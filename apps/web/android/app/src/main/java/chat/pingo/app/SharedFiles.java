package chat.pingo.app;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Files another app shared into PINGO, held until the page asks for them.
 *
 * <h2>Why they are not simply handed over</h2>
 *
 * An image arriving from a keyboard is small, so it crosses the bridge as
 * base64 and becomes a File. A share is not small. Somebody sharing a video
 * from their gallery is sharing tens or hundreds of megabytes, and base64
 * inflates that by a third before a single byte reaches JavaScript - so the
 * cheap approach turns "share a video" into a way to run the app out of memory.
 *
 * So nothing is copied. The share's {@code content://} URI is kept here under
 * an id, and the page fetches it like any other URL: the WebView's own request
 * interception answers {@code /__pingo-share/<id>} by streaming the provider's
 * bytes straight through. The page receives a Blob, the file is read once, and
 * nothing is ever held whole in memory on either side.
 *
 * <h2>The grant is why this cannot wait</h2>
 *
 * A shared URI is a permission grant to this activity for this launch. It is
 * not a path that keeps working - so the page is told as soon as it is ready,
 * and an id that has been collected is dropped rather than kept around looking
 * valid.
 *
 * <h2>Ids are random, not sequential</h2>
 *
 * Anything running in the WebView can request these paths. A counter would let
 * a page read files shared into a previous session by guessing small numbers;
 * a random id is only known to whoever was told it.
 */
public final class SharedFiles {

    /** The path the page fetches. Not a real route - see the client below. */
    public static final String PREFIX = "/__pingo-share/";

    private final ContentResolver resolver;
    private final Map<String, Uri> byId = Collections.synchronizedMap(new HashMap<>());

    public SharedFiles(ContentResolver resolver) {
        this.resolver = resolver;
    }

    /**
     * Takes a shared URI and describes it for the page.
     *
     * @return the JSON the page needs to fetch it - id, name, type, size - or
     *     null when the provider will not say what it is holding, which is the
     *     one case where offering it would produce a nameless empty file.
     */
    public JSONObject offer(Uri uri) {
        if (uri == null) return null;

        String name = null;
        long size = -1;

        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameAt >= 0 && !cursor.isNull(nameAt)) name = cursor.getString(nameAt);
                if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt);
            }
        } catch (Exception ignored) {
            // A provider that refuses to be queried can still be readable, so
            // this is a missing name rather than a missing file.
        }

        String type = resolver.getType(uri);
        if (type == null) type = "application/octet-stream";
        if (name == null || name.isEmpty()) name = "shared";

        String id = java.util.UUID.randomUUID().toString();
        byId.put(id, uri);

        try {
            JSONObject described = new JSONObject();
            described.put("id", id);
            described.put("name", name);
            described.put("type", type);
            described.put("size", size);
            described.put("url", PREFIX + id);
            return described;
        } catch (Exception cause) {
            byId.remove(id);
            return null;
        }
    }

    /** True when this is one of ours, so the client knows whether to answer. */
    public boolean handles(WebResourceRequest request) {
        return request != null
                && request.getUrl() != null
                && request.getUrl().getPath() != null
                && request.getUrl().getPath().startsWith(PREFIX);
    }

    /**
     * Streams a held file back.
     *
     * The stream is handed to the WebView unread - it does the reading, at
     * whatever pace it consumes the response, which is what keeps a large video
     * from ever being in memory at once.
     */
    public WebResourceResponse serve(WebResourceRequest request) {
        String path = request.getUrl().getPath();
        String id = path.substring(PREFIX.length());
        Uri uri = byId.get(id);

        if (uri == null) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    headers(), new java.io.ByteArrayInputStream(new byte[0]));
        }

        try {
            InputStream stream = resolver.openInputStream(uri);
            if (stream == null) throw new IllegalStateException("no stream");

            String type = resolver.getType(uri);
            if (type == null) type = "application/octet-stream";

            return new WebResourceResponse(type, null, 200, "OK", headers(), stream);
        } catch (Exception cause) {
            return new WebResourceResponse("text/plain", "utf-8", 500, "Error",
                    headers(), new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    /**
     * The page is served from a real origin, and this is not part of it.
     *
     * Without an allow-origin header the fetch fails as a cross-origin request,
     * which presents as an empty share and no reason why.
     */
    private static Map<String, String> headers() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    /** Drops everything. Called once the page confirms it has the files. */
    public void clear() {
        byId.clear();
    }

    public static JSONArray arrayOf(java.util.List<JSONObject> items) {
        JSONArray array = new JSONArray();
        for (JSONObject item : items) array.put(item);
        return array;
    }
}
