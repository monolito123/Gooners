package com.omniassist.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.webrtc.PeerConnection

/**
 * Foreground service that owns an active assistance session.
 *
 * It exists to make the session impossible to hide. On start it, in order:
 *   1. posts a persistent foreground notification (required by the OS for
 *      mediaProjection capture), and
 *   2. draws the on-screen overlay banner.
 * If EITHER fails, it stops immediately and nothing is captured. Only then does
 * it create the WebRTC session and begin sending the screen.
 *
 * The user can end the session from the notification action or the banner's
 * End button; both route to ACTION_STOP.
 */
class SessionService : Service(), SignalingHub.SessionListener {

    override lateinit var sessionId: String
        private set

    private var rtc: WebRtcSession? = null
    private var overlay: OverlayController? = null
    private val http = OkHttpClient()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { endAndStop("device_ended"); return START_NOT_STICKY }
            else -> start(intent)
        }
        return START_NOT_STICKY
    }

    private fun start(intent: Intent?) {
        sessionId = intent?.getStringExtra(EXTRA_SESSION_ID) ?: run { stopSelf(); return }
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val projectionData: Intent? = intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
        if (resultCode == 0 || projectionData == null) { stopSelf(); return }

        // (1) Foreground notification — mandatory, non-dismissible while active.
        try {
            startForegroundNotification()
        } catch (e: Exception) {
            Log.e(TAG, "foreground failed; refusing to capture", e)
            SignalingHub.reportConsent(sessionId, false)
            stopSelf(); return
        }

        // (2) Visible overlay banner — mandatory.
        overlay = OverlayController(this)
        val shown = overlay!!.show(onEnd = { endAndStop("device_ended") })
        if (!shown) {
            Log.e(TAG, "overlay banner could not be shown; refusing to capture")
            SignalingHub.reportConsent(sessionId, false)
            stopSelf(); return
        }

        // Invariants satisfied — now (and only now) begin the media session.
        SignalingHub.attachSession(this)
        fetchIceThenStart(projectionData)
    }

    private fun fetchIceThenStart(projectionData: Intent) {
        val httpBase = BuildConfig.SIGNALING_URL.replaceFirst("ws", "http")
        http.newCall(Request.Builder().url("$httpBase/ice").build())
            .enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) =
                    endAndStop("ice_failed")

                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    response.use {
                        val servers = parseIce(JSONObject(it.body!!.string()))
                        startRtc(projectionData, servers)
                    }
                }
            })
    }

    private fun startRtc(projectionData: Intent, iceServers: List<PeerConnection.IceServer>) {
        rtc = WebRtcSession(
            context = this,
            sessionId = sessionId,
            mediaProjectionPermissionData = projectionData,
            onLocalSignal = { SignalingHub.sendSignal(sessionId, it) },
            onControlEvent = { handleControlEvent(it) },
            onClosed = { reason -> endAndStop(reason) },
        ).also { it.start(iceServers) }
    }

    /**
     * Control events from the controller (pointer / keyboard / clipboard).
     *
     * NEXT INCREMENT: execute pointer/keyboard events via an AccessibilityService
     * that runs ONLY while this service is active and the banner is showing. It is
     * intentionally not wired up yet; today these are logged so the two sides can
     * be verified end-to-end without the device acting on input.
     */
    private fun handleControlEvent(ev: JSONObject) {
        when (ev.optString("k")) {
            "clipboard" -> { /* text-only clipboard sync, opt-in; next increment */ }
            else -> Log.d(TAG, "control event (not yet executed): $ev")
        }
    }

    override fun onSignal(data: JSONObject) { rtc?.onRemoteSignal(data) }

    override fun onEnded(reason: String) { endAndStop(reason) }

    private fun endAndStop(reason: String) {
        runCatching { SignalingHub.endSession(sessionId) }
        SignalingHub.detachSession(this)
        rtc?.stop(); rtc = null
        overlay?.hide(); overlay = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        Log.i(TAG, "session ended: $reason")
    }

    private fun startForegroundNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Active remote session", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Shown whenever your screen is being viewed or controlled."
                },
            )
        }
        val stopIntent = PendingIntent.getService(
            this, 1,
            Intent(this, SessionService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("⚠️ Remote Assistance Active")
            .setContentText("Your screen is being viewed/controlled. Tap End to stop.")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End", stopIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(this, NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            ServiceCompat.startForeground(this, NOTIF_ID, n, 0)
        }
    }

    private fun parseIce(obj: JSONObject): List<PeerConnection.IceServer> {
        val out = ArrayList<PeerConnection.IceServer>()
        val arr = obj.optJSONArray("iceServers") ?: return out
        for (i in 0 until arr.length()) {
            val s = arr.getJSONObject(i)
            val urls = when (val u = s.get("urls")) {
                is String -> listOf(u)
                else -> (0 until (s.getJSONArray("urls").length())).map { s.getJSONArray("urls").getString(it) }
            }
            val b = PeerConnection.IceServer.builder(urls)
            if (s.has("username")) b.setUsername(s.getString("username"))
            if (s.has("credential")) b.setPassword(s.getString("credential"))
            out.add(b.createIceServer())
        }
        return out
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        SignalingHub.detachSession(this)
        rtc?.stop()
        overlay?.hide()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "OmniAssist/Service"
        private const val CHANNEL = "omniassist_session"
        private const val NOTIF_ID = 42
        const val ACTION_STOP = "com.omniassist.client.STOP"
        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_PROJECTION_DATA = "projection_data"

        fun startSession(ctx: Context, sessionId: String, resultCode: Int, data: Intent) {
            val i = Intent(ctx, SessionService::class.java)
                .putExtra(EXTRA_SESSION_ID, sessionId)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_PROJECTION_DATA, data)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }
}
