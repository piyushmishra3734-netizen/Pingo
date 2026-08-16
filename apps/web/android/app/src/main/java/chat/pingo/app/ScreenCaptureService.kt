package chat.pingo.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Owns the screen capture, and the LiveKit connection that carries it.
 *
 * ## Kotlin, and not by preference
 *
 * The rest of this app is Java. LiveKit's Android SDK is Kotlin with suspending
 * functions, and calling those from Java means hand-rolling continuations - the
 * kind of code that compiles if you are lucky and is unreadable either way. One
 * file in the other language is the smaller price.
 *
 * ## Why a service at all
 *
 * Android will not let an app hold a `MediaProjection` without a foreground
 * service of type `mediaProjection`, and from Android 14 the service has to be
 * running *before* the projection is used. A notification the user cannot
 * dismiss is the price of capturing their screen, and it is a fair one: it is
 * the only thing on the device that says this is happening.
 *
 * ## Why the connection lives here rather than in the plugin
 *
 * The share has to survive the app going to the background, which is the whole
 * point - people share a screen in order to go and look at something else. A
 * connection owned by the activity would be torn down at exactly the moment it
 * became useful.
 *
 * ## A second participant, not a second call
 *
 * The token is minted for `<user>#screen` and may publish a screen and nothing
 * else. It does not subscribe: this connection has nothing to display and no
 * speaker to play through, and subscribing would have the phone pull every
 * other person's video down a second time over mobile data.
 */
class ScreenCaptureService : Service() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var room: Room? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEverything()
            return START_NOT_STICKY
        }
        if (intent == null) return START_NOT_STICKY

        /*
         * The notification first, and before anything else touches the
         * projection. `startForeground` has to happen within seconds of the
         * service starting or Android kills it, and on 14+ the projection
         * cannot be used until it has.
         */
        startForeground()

        val resultData: Intent? = intent.getParcelableExtra(EXTRA_RESULT_DATA)
        val url = intent.getStringExtra(EXTRA_URL)
        val token = intent.getStringExtra(EXTRA_TOKEN)

        if (resultData == null || url == null || token == null) {
            stopEverything()
            return START_NOT_STICKY
        }

        connectAndPublish(url, token, resultData)
        return START_NOT_STICKY
    }

    private fun startForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                NotificationChannel(
                    CHANNEL_ID,
                    "Screen sharing",
                    // Low: a status, not an interruption. It must be visible and
                    // it must not make a sound.
                    NotificationManager.IMPORTANCE_LOW,
                )
            channel.setShowBadge(false)
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }

        val notification: Notification =
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Sharing your screen")
                .setContentText("PINGO is sharing your screen in a call.")
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun connectAndPublish(url: String, token: String, resultData: Intent) {
        val created = LiveKit.create(applicationContext)
        room = created

        scope.launch {
            try {
                created.connect(url, token)
                val track =
                    created.localParticipant.createScreencastTrack(
                        mediaProjectionPermissionResultData = resultData,
                    )
                created.localParticipant.publishVideoTrack(track)
                /*
                 * The SDK wants to own a foreground notification of its own.
                 * Passing nulls tells it this service already has one - two
                 * notifications for one screen share is the app apologising
                 * twice for the same thing.
                 */
                track.startForegroundService(null, null)
            } catch (failure: Throwable) {
                Log.e(TAG, "could not publish the screen", failure)
                stopEverything()
            }
        }
    }

    private fun stopEverything() {
        room?.disconnect()
        room?.release()
        room = null
        scope.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopEverything()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_URL = "url"
        const val EXTRA_TOKEN = "token"
        const val ACTION_STOP = "chat.pingo.app.STOP_SCREEN_CAPTURE"

        private const val TAG = "PingoScreenCapture"
        private const val CHANNEL_ID = "screen_share"
        private const val NOTIFICATION_ID = 4711
    }
}
