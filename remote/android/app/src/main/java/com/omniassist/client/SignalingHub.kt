package com.omniassist.client

import android.content.Context
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide holder for the single signaling connection.
 *
 * The socket stays open while the app is "available for assistance" so the
 * device can show its rotating PIN and receive consent requests. Both the idle
 * UI (MainActivity) and the active session (SessionService) attach to it, so the
 * offer/candidate messages that arrive on this one socket reach whichever
 * component is driving WebRTC.
 */
object SignalingHub : SignalingClient.Listener {

    data class PinState(val deviceId: String, val pin: String, val pinExpiresAt: Long)
    data class ConsentRequest(val sessionId: String, val controllerId: String, val mode: String)

    interface UiListener {
        fun onPinState(state: PinState)
        fun onConsentRequest(req: ConsentRequest)
        fun onSessionEnded(reason: String)
        fun onError(error: String)
    }

    /** A component that is driving one active session's signaling. */
    interface SessionListener {
        val sessionId: String
        fun onSignal(data: JSONObject)
        fun onEnded(reason: String)
    }

    private var client: SignalingClient? = null
    private val uiListeners = CopyOnWriteArrayList<UiListener>()
    @Volatile private var sessionListener: SessionListener? = null

    @Volatile var pinState: PinState? = null
        private set

    fun start(context: Context, unattendedEnabled: Boolean) {
        if (client != null) return
        val prefs = Prefs(context.applicationContext)
        val deviceId = prefs.deviceId ?: ("dev_" + java.util.UUID.randomUUID().toString().take(10))
            .also { prefs.deviceId = it }
        client = SignalingClient(BuildConfig.SIGNALING_URL, this).also {
            it.connect(deviceId, unattendedEnabled)
        }
    }

    fun stop() {
        client?.close()
        client = null
        pinState = null
    }

    fun addUiListener(l: UiListener) { uiListeners.add(l); pinState?.let(l::onPinState) }
    fun removeUiListener(l: UiListener) { uiListeners.remove(l) }

    fun attachSession(l: SessionListener) { sessionListener = l }
    fun detachSession(l: SessionListener) { if (sessionListener === l) sessionListener = null }

    fun reportConsent(sessionId: String, accepted: Boolean) = client?.reportConsent(sessionId, accepted)
    fun sendSignal(sessionId: String, data: JSONObject) = client?.sendSignal(sessionId, data)
    fun endSession(sessionId: String) = client?.endSession(sessionId)

    /* ---- SignalingClient.Listener ---- */

    override fun onRegistered(deviceId: String, pin: String, pinExpiresAt: Long) {
        pinState = PinState(deviceId, pin, pinExpiresAt)
        uiListeners.forEach { it.onPinState(pinState!!) }
    }

    override fun onPin(pin: String, pinExpiresAt: Long) {
        val d = pinState?.deviceId ?: return
        pinState = PinState(d, pin, pinExpiresAt)
        uiListeners.forEach { it.onPinState(pinState!!) }
    }

    override fun onConsentRequest(sessionId: String, controllerId: String, mode: String) {
        uiListeners.forEach { it.onConsentRequest(ConsentRequest(sessionId, controllerId, mode)) }
    }

    override fun onSignal(sessionId: String, data: JSONObject) {
        sessionListener?.takeIf { it.sessionId == sessionId }?.onSignal(data)
    }

    override fun onSessionEnded(reason: String) {
        sessionListener?.onEnded(reason)
        uiListeners.forEach { it.onSessionEnded(reason) }
    }

    override fun onError(error: String) {
        uiListeners.forEach { it.onError(error) }
    }
}
