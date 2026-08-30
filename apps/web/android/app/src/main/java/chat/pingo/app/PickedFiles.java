package chat.pingo.app;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * What the file chooser just handed the page, remembered on this side.
 *
 * <h2>The problem this solves</h2>
 *
 * A video has to be transcoded natively - there is no encoder in the DOM - and
 * the native side needs the content URI to do it. The page only ever sees a
 * {@code File}: a name, a size and a handle it can read bytes from. It cannot
 * pass the URI back because it never had one.
 *
 * The obvious answers are both bad. Sending the bytes across the bridge means
 * base64-ing a 200 MB clip into the WebView's heap to hand it to code running
 * in the same process. Opening a second, native picker means asking somebody to
 * choose the same video twice.
 *
 * So the URI is kept where it already exists. {@code onShowFileChooser} sees
 * every choice on its way to the page; this records the video ones, and the
 * plugin looks up the file the page is asking about by name and size - the two
 * things a {@code File} does carry.
 *
 * <h2>Why it forgets</h2>
 *
 * A URI from the chooser is only readable while the grant lasts, and holding
 * every file somebody has ever picked would be a list that only grows. Ten is
 * more than any one send needs and small enough to be uninteresting.
 */
final class PickedFiles {

    private static final int REMEMBERED = 10;

    private static final Deque<Entry> recent = new ArrayDeque<>();

    private static final class Entry {
        final String name;
        final long size;
        final Uri uri;

        Entry(String name, long size, Uri uri) {
            this.name = name;
            this.size = size;
            this.uri = uri;
        }
    }

    private PickedFiles() {}

    /** Records the choices a file chooser is about to hand the page. */
    static synchronized void remember(Context context, Uri[] uris) {
        if (uris == null) return;
        for (Uri uri : uris) {
            if (uri == null) continue;
            String name = null;
            long size = -1;
            try (Cursor cursor = context.getContentResolver()
                .query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (nameAt >= 0) name = cursor.getString(nameAt);
                    if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt);
                }
            } catch (Exception ignored) {
                /*
                 * A provider that will not answer a metadata query is not a
                 * reason to fail the pick - the page still gets its file and
                 * still sends it. It only means this one cannot be transcoded,
                 * which the plugin reports as "not found" and the page handles.
                 */
            }
            if (name == null) continue;

            recent.addFirst(new Entry(name, size, uri));
            while (recent.size() > REMEMBERED) recent.removeLast();
        }
    }

    /**
     * The URI for a file the page is describing, or null.
     *
     * Matched on name and size together. A name alone collides - every phone
     * has several {@code VID_20260830.mp4} - and the size is what the page has
     * anyway, so asking for both costs nothing and removes the ambiguity.
     */
    static synchronized Uri find(String name, long size) {
        for (Entry entry : recent) {
            if (entry.name.equals(name) && (size < 0 || entry.size < 0 || entry.size == size)) {
                return entry.uri;
            }
        }
        return null;
    }
}
