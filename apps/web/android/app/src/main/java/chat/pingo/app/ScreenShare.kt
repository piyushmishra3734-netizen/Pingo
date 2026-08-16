package chat.pingo.app

import android.content.Context
import android.content.Intent
import android.util.Log
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The screen half of a call, captured natively because the browser cannot.
 *
 * ## Why any of this exists
 *
 * Chrome and Firefox on Android ship `getDisplayMedia` and reject every call to
 * it. The API is defined and not implemented, and a Chromium WebView is no
 * different - there is no web route to a phone's screen. `MediaProjection` is
 * the only one, and it is a platform API.
 *
 * ## Why it joins the call a second time
 *
 * MediaProjection produces frames in the app, and there is no supported way to
 * hand them to the WebView's own WebRTC stack. So this connects to the same
 * LiveKit room itself and publishes from there.
 *
 * LiveKit evicts the existing participant when a second joins under the same
 * identity, so the page's connection would drop the instant this one arrived.
 * The token is minted for `<user>#screen` - see the `screen` flag in the
 * `livekit-token` function - and it is deliberately the weaker pass: publish a
 * screen, nothing else, and subscribe to nobody. A phone has no reason to pull
 * every other person's video down a second time over mobile data to render it
 * nowhere.
 *
 * ## The foreground service is the SDK's
 *
 * Android will not let an app hold a projection without a foreground service of
 * type `mediaProjection`, and this file used to be one. It does not need to be:
 * `startForegroundService` on the track binds to the service the SDK already
 * ships and declares, with the right type and its own notification. Writing a
 * second one meant two notifications for one screen share and a manifest entry
 * that duplicated a dependency's.
 *
 * ## Kotlin, and not by preference
 *
 * The rest of this app is Java. The SDK's `connect` and `publishVideoTrack`
 * suspend, and calling those from Java means hand-written continuations - the
 * kind of code that is unreadable whether or not it compiles. One file in the
 * other language is the smaller price, and it exposes a plain, non-suspending
 * pair of calls so nothing else has to know.
 */
object ScreenShare {

    private const val TAG = "PingoScreenShare"

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var room: Room? = null

    /**
     * Joins the room and publishes this screen.
     *
     * Failures are logged here and go no further. Screen sharing failing must
     * never take the call with it - the call is running in the WebView on a
     * different connection entirely - so everything is swallowed rather than
     * thrown, and what the user sees is the share simply not appearing.
     */
    @JvmStatic
    fun start(
        context: Context,
        url: String,
        token: String,
        resultData: Intent,
    ) {
        stop()

        val created = LiveKit.create(context.applicationContext)
        room = created

        scope.launch {
            try {
                created.connect(url, token)

                val track =
                    created.localParticipant.createScreencastTrack(
                        mediaProjectionPermissionResultData = resultData,
                        /*
                         * Android's own "stop sharing" notification ends the
                         * projection without coming through `stop()`. People
                         * use it, so this is what keeps the room from holding
                         * a track that has already stopped.
                         */
                        onStop = { stop() },
                    )

                created.localParticipant.publishVideoTrack(track)
                // The SDK's service, with the mediaProjection type and its own
                // notification. See the note above.
                track.startForegroundService(null, null)
            } catch (failure: Throwable) {
                Log.e(TAG, "could not publish the screen", failure)
                stop()
            }
        }
    }

    /** Safe to call when nothing is sharing, and called that way on every start. */
    @JvmStatic
    fun stop() {
        val current = room ?: return
        room = null
        current.disconnect()
        current.release()
    }
}
