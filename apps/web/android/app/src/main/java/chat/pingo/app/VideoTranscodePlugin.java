package chat.pingo.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.otaliastudios.transcoder.Transcoder;
import com.otaliastudios.transcoder.TranscoderListener;
import com.otaliastudios.transcoder.strategy.DefaultVideoStrategy;

import java.io.File;

/**
 * Video, shrunk to 480p before it leaves the phone.
 *
 * <h2>Why this is native and the photo path is not</h2>
 *
 * A canvas can draw an image and re-encode it, which is all a photo needs. It
 * cannot touch a video: there is no frame decoder, no encoder and no muxer in
 * the DOM. The web answers are WebCodecs plus a muxing library - faster than
 * real time, and a dependency and a pile of container code - or a canvas plus
 * MediaRecorder, which re-encodes in real time and so takes a minute to send a
 * minute of video. Android has hardware codecs sitting right there.
 *
 * <h2>Why the picker is on this side too</h2>
 *
 * The obvious shape is "let the page pick the file, hand us the bytes". That
 * shape moves an untranscoded video across the JavaScript bridge, base64
 * encoded, and a 200 MB clip becomes 270 MB of string in the WebView's heap on
 * a phone that has no such thing to spare.
 *
 * So the original never reaches JavaScript. This opens the picker, reads the
 * content URI natively, transcodes it, and hands back the *output* path - a few
 * megabytes, which the page fetches over Capacitor's local file server. The
 * expensive bytes stay on one side of the bridge.
 *
 * <h2>Why a library rather than MediaCodec</h2>
 *
 * The honest version of this by hand is an extractor, a decoder onto a surface,
 * an encoder, a muxer, audio passthrough, rotation metadata and a
 * timestamp-drift fix for the codecs that lie about presentation times - several
 * hundred lines of the kind of code that works on the phone it was written on.
 * That is a solved problem and this is not the place to solve it again.
 */
@CapacitorPlugin(name = "VideoTranscode")
public class VideoTranscodePlugin extends Plugin {

    /**
     * The shorter edge, which is what 480p means whichever way the phone is held.
     *
     * `atMost` scales down and never up, so a clip already below this is copied
     * rather than re-encoded - and re-encoding something small would cost time
     * to make it worse.
     */
    private static final int SHORT_EDGE = 480;

    /**
     * Converts a video the page has already picked, found by name and size.
     *
     * This is the path that runs in practice. The page's own file input is what
     * opens the chooser, so nobody chooses twice and the picker stays the one
     * people know - and the original still never crosses the bridge, because
     * only its name and size do. See PickedFiles for how the URI is kept.
     */
    @PluginMethod
    public void transcodePicked(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("No file named.");
            return;
        }
        long size = call.getLong("size", -1L);

        Uri input = PickedFiles.find(name, size);
        if (input == null) {
            /*
             * Reported rather than thrown. A file the chooser never announced -
             * a paste, a share into the app, a provider that answers no
             * metadata query - is a normal thing to happen, and the page's
             * answer is simply to send what it already has.
             */
            JSObject missing = new JSObject();
            missing.put("cancelled", true);
            missing.put("reason", "not-found");
            call.resolve(missing);
            return;
        }

        transcodeUri(call, input);
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK
            || result.getData() == null
            || result.getData().getData() == null) {
            // Backing out of a picker is not an error. The page checks the flag
            // rather than catching a rejection for the most ordinary outcome.
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        transcodeUri(call, result.getData().getData());
    }

    private void transcodeUri(PluginCall call, Uri input) {
        final File output;
        try {
            File dir = new File(getContext().getCacheDir(), "outgoing-video");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Could not create a place to write the video.");
                return;
            }
            output = new File(dir, "send-" + System.currentTimeMillis() + ".mp4");
        } catch (Exception e) {
            call.reject("Could not create a place to write the video.", e);
            return;
        }

        try {
            Transcoder.into(output.getAbsolutePath())
                .addDataSource(getContext(), input)
                .setVideoTrackStrategy(DefaultVideoStrategy.atMost(SHORT_EDGE).build())
                .setListener(new TranscoderListener() {
                    @Override
                    public void onTranscodeProgress(double progress) {
                        JSObject event = new JSObject();
                        event.put("progress", progress);
                        notifyListeners("progress", event);
                    }

                    @Override
                    public void onTranscodeCompleted(int successCode) {
                        JSObject done = new JSObject();
                        done.put("cancelled", false);
                        done.put("path", output.getAbsolutePath());
                        done.put("size", output.length());
                        call.resolve(done);
                    }

                    @Override
                    public void onTranscodeCanceled() {
                        JSObject cancelled = new JSObject();
                        cancelled.put("cancelled", true);
                        call.resolve(cancelled);
                    }

                    @Override
                    public void onTranscodeFailed(Throwable cause) {
                        /*
                         * Rejected rather than falling back to the original.
                         *
                         * The page decides what to do with a failure, and it has
                         * the context this does not: whether the user is on a
                         * metered connection, whether the file was small anyway.
                         * Silently sending the untranscoded original from here
                         * would be the one outcome nobody asked for and nobody
                         * would be told about.
                         */
                        output.delete();
                        // Capacitor's reject takes an Exception; the library
                        // reports a Throwable. Wrapped rather than dropped, so
                        // the real cause still reaches the native log.
                        call.reject(
                            "Could not convert that video.",
                            cause instanceof Exception ? (Exception) cause : new Exception(cause)
                        );
                    }
                })
                .transcode();
        } catch (Exception e) {
            output.delete();
            call.reject("Could not convert that video.", e);
        }
    }
}
