package com.omniassist.client

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * WebSocket client to the OmniAssist signaling server.
 *
 * It fetches a device token over HTTPS, opens the socket, registers the device,
 * and surfaces server messages through [Listener]. It carries only signaling —
 * never media. The server is told about consent decisions here; it cannot infer
 * or fake them.
 */
class SignalingClient(
    private val baseWsUrl: String, // e.g. wss://assist.example.com
    private val listener: Listener,
) {
    interface Listener {
        fun onRegistered(deviceId: String, pin: String, pinExpiresAt: Long)
        fun onPin(pin: String, pinExpiresAt: Long)
        fun onConsentRequest(sessionId: String, controllerId: String, mode: String)
        fun onSignal(sessionId: String, data: JSONObject)
        fun onSessionEnded(reason: String)
        fun onError(error: String)
    }

    private val http = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private var ws: WebSocket? = null

    fun connect(deviceId: String, unattendedEnabled: Boolean) {
        val httpBase = baseWsUrl.replaceFirst("ws", "http")
        // Obtain a device token.
        val tokenReq = Request.Builder()
            .url("$httpBase/token?role=device&id=$deviceId")
            .post(okhttp3.internal.EMPTY_REQUEST)
            .build()
        http.newCall(tokenReq).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) =
                listener.onError("token: ${e.message}")

            override fun onResponse(call: okhttp3.Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) return listener.onError("token ${it.code}")
                    val token = JSONObject(it.body!!.string()).getString("token")
                    openSocket(token, unattendedEnabled)
                }
            }
        })
    }

    private fun openSocket(token: String, unattendedEnabled: Boolean) {
        val req = Request.Builder().url("$baseWsUrl/?token=$token").build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                send(JSONObject().put("type", "device:online").put("unattendedEnabled", unattendedEnabled))
            }

            override fun onMessage(webSocket: WebSocket, text: String) = route(JSONObject(text))

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                listener.onError("socket: ${t.message}")
            }
        })
    }

    private fun route(m: JSONObject) {
        when (m.optString("type")) {
            "device:registered" -> listener.onRegistered(
                m.getString("deviceId"), m.getString("pin"), m.optLong("pinExpiresAt"),
            )
            "device:pin" -> listener.onPin(m.getString("pin"), m.optLong("pinExpiresAt"))
            "consent:request" -> listener.onConsentRequest(
                m.getString("sessionId"), m.optString("controllerId"), m.optString("mode", "attended"),
            )
            "signal" -> listener.onSignal(m.getString("sessionId"), m.getJSONObject("data"))
            "session:active" -> { /* capture starts after device reports consent */ }
            "session:ended" -> listener.onSessionEnded(m.optString("reason", "ended"))
            "error" -> listener.onError(m.optString("error"))
        }
    }

    fun reportConsent(sessionId: String, accepted: Boolean) {
        send(JSONObject().put("type", "device:consent").put("sessionId", sessionId).put("accepted", accepted))
    }

    fun sendSignal(sessionId: String, data: JSONObject) {
        send(JSONObject().put("type", "signal").put("sessionId", sessionId).put("data", data))
    }

    fun endSession(sessionId: String) {
        send(JSONObject().put("type", "end").put("sessionId", sessionId))
    }

    private fun send(o: JSONObject) { ws?.send(o.toString()) }

    fun close() {
        ws?.close(1000, "bye")
        ws = null
    }
}
