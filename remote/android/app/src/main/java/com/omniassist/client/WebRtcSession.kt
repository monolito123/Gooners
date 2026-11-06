package com.omniassist.client

import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject
import org.webrtc.*

/**
 * One WebRTC peer session on the device side.
 *
 * The device is the SENDER of video (its screen, captured via MediaProjection)
 * and the ANSWERER in negotiation: the browser controller creates the offer, we
 * answer. A `control` data channel arrives from the controller.
 *
 * Capture is driven by [ScreenCapturerAndroid], which requires the
 * MediaProjection permission result the user already granted via the system
 * dialog. No capture object is created until SessionService has confirmed the
 * consent + notification + banner invariants.
 *
 * Adaptive bitrate: we start conservative and let WebRTC's own congestion
 * control (plus the degradation preference) trade resolution for frame rate as
 * the network changes, targeting low latency.
 */
class WebRtcSession(
    private val context: Context,
    private val sessionId: String,
    private val mediaProjectionPermissionData: Intent,
    private val onLocalSignal: (JSONObject) -> Unit,
    private val onControlEvent: (JSONObject) -> Unit,
    private val onClosed: (String) -> Unit,
) {
    private val eglBase: EglBase = EglBase.create()
    private lateinit var factory: PeerConnectionFactory
    private var pc: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var videoSource: VideoSource? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var controlChannel: DataChannel? = null

    fun start(iceServers: List<PeerConnection.IceServer>) {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions(),
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(
                DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true),
            )
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            // Prefer the relay only when necessary; let ICE find the best path.
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        }

        pc = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                onLocalSignal(
                    JSONObject().put("kind", "candidate").put(
                        "candidate",
                        JSONObject()
                            .put("candidate", c.sdp)
                            .put("sdpMid", c.sdpMid)
                            .put("sdpMLineIndex", c.sdpMLineIndex),
                    ),
                )
            }

            override fun onDataChannel(dc: DataChannel) {
                // The controller's control channel.
                controlChannel = dc
                dc.registerObserver(object : DataChannel.Observer {
                    override fun onBufferedAmountChange(p: Long) {}
                    override fun onStateChange() {}
                    override fun onMessage(buffer: DataChannel.Buffer) {
                        val bytes = ByteArray(buffer.data.remaining())
                        buffer.data.get(bytes)
                        runCatching { onControlEvent(JSONObject(String(bytes, Charsets.UTF_8))) }
                    }
                })
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                if (newState == PeerConnection.PeerConnectionState.FAILED ||
                    newState == PeerConnection.PeerConnectionState.CLOSED
                ) onClosed(newState.name)
            }

            override fun onSignalingChange(p: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(p: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(p: Boolean) {}
            override fun onIceGatheringChange(p: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(p: Array<out IceCandidate>) {}
            override fun onAddStream(p: MediaStream) {}
            override fun onRemoveStream(p: MediaStream) {}
            override fun onRenegotiationNeeded() {}
            override fun onTrack(p: RtpTransceiver) {}
        }) ?: run { onClosed("pc_null"); return }

        addScreenTrack()
    }

    private fun addScreenTrack() {
        capturer = ScreenCapturerAndroid(
            mediaProjectionPermissionData,
            object : android.media.projection.MediaProjection.Callback() {
                override fun onStop() { onClosed("projection_stopped") }
            },
        )
        surfaceHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
        val source = factory.createVideoSource(/* isScreencast = */ true)
        videoSource = source
        capturer!!.initialize(surfaceHelper, context, source.capturerObserver)

        val metrics = context.resources.displayMetrics
        // Start at a modest size; the encoder/BWE scale from here.
        val startW = minOf(metrics.widthPixels, 1280)
        val startH = (startW.toFloat() * metrics.heightPixels / metrics.widthPixels).toInt()
        capturer!!.startCapture(startW, startH, 30)

        val track = factory.createVideoTrack("screen", source)
        val sender = pc!!.addTrack(track, listOf("omniassist-stream"))

        // Favor frame rate over resolution for responsive control; cap bitrate so
        // the Always Free relay and typical broadband stay comfortable.
        sender.parameters = sender.parameters.apply {
            degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
            encodings.firstOrNull()?.let {
                it.maxBitrateBps = 2_500_000
                it.maxFramerate = 30
            }
        }
    }

    /** Handle an SDP offer or ICE candidate relayed from the controller. */
    fun onRemoteSignal(data: JSONObject) {
        when (data.optString("kind")) {
            "offer" -> {
                val sdp = SessionDescription(SessionDescription.Type.OFFER, data.getJSONObject("sdp").getString("sdp"))
                pc?.setRemoteDescription(SdpObserverAdapter(), sdp)
                pc?.createAnswer(object : SdpObserverAdapter() {
                    override fun onCreateSuccess(desc: SessionDescription) {
                        pc?.setLocalDescription(SdpObserverAdapter(), desc)
                        onLocalSignal(
                            JSONObject().put("kind", "answer")
                                .put("sdp", JSONObject().put("type", "answer").put("sdp", desc.description)),
                        )
                    }
                }, MediaConstraints())
            }
            "candidate" -> {
                val c = data.getJSONObject("candidate")
                pc?.addIceCandidate(
                    IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), c.getString("candidate")),
                )
            }
        }
    }

    /** Send a control-channel message back to the controller (e.g. clipboard). */
    fun sendControl(obj: JSONObject) {
        val dc = controlChannel ?: return
        val bytes = obj.toString().toByteArray(Charsets.UTF_8)
        dc.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(bytes), false))
    }

    fun stop() {
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        runCatching { surfaceHelper?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { controlChannel?.dispose() }
        runCatching { pc?.close() }
        runCatching { pc?.dispose() }
        runCatching { factory.dispose() }
        runCatching { eglBase.release() }
        Log.i(TAG, "session $sessionId torn down")
    }

    private open class SdpObserverAdapter : SdpObserver {
        override fun onCreateSuccess(p: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(p: String?) {}
        override fun onSetFailure(p: String?) {}
    }

    companion object { private const val TAG = "OmniAssist/RTC" }
}
