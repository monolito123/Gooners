package com.omniassist.client

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The device's home screen. It brings the device "online" (so it shows a session
 * ID and a rotating PIN), handles incoming consent requests, and starts the
 * foreground SessionService once the user accepts and screen capture is granted.
 *
 * Capture NEVER begins from here directly — this activity only collects the
 * user's explicit Accept and the system screen-capture grant, then hands off to
 * SessionService, which enforces the notification + banner invariants.
 */
class MainActivity : ComponentActivity(), SignalingHub.UiListener {

    private lateinit var prefs: Prefs
    private var pinState by mutableStateOf<SignalingHub.PinState?>(null)
    private var status by mutableStateOf("Starting…")
    private var unattendedEnabled by mutableStateOf(false)

    // The consent request we are currently processing (sessionId + controller).
    private var pending: SignalingHub.ConsentRequest? = null

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val req = pending
        if (req == null) return@registerForActivityResult
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            // User granted screen capture AND had already accepted in ConsentActivity.
            SignalingHub.reportConsent(req.sessionId, true)
            SessionService.startSession(this, req.sessionId, result.resultCode, result.data!!)
            status = "Session ${req.sessionId} active"
        } else {
            SignalingHub.reportConsent(req.sessionId, false)
            status = "Screen capture was not granted — session declined"
        }
        pending = null
    }

    private val consentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val req = pending ?: return@registerForActivityResult
        if (result.resultCode == Activity.RESULT_OK) {
            // Accepted. Now request the system screen-capture grant.
            val mgr = getSystemService(MediaProjectionManager::class.java)
            projectionLauncher.launch(mgr.createScreenCaptureIntent())
        } else {
            SignalingHub.reportConsent(req.sessionId, false)
            status = "You declined the session"
            pending = null
        }
    }

    private val notifLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* banner is the primary indicator; notification is best-effort prompt */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        unattendedEnabled = prefs.unattendedEnabled

        // Ask for notification permission up front (Android 13+); the foreground
        // notification is mandatory for a session.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent { MaterialTheme { HomeScreen() } }
    }

    override fun onStart() {
        super.onStart()
        SignalingHub.addUiListener(this)
        SignalingHub.start(applicationContext, prefs.unattendedEnabled)
        pinState = SignalingHub.pinState
        status = if (pinState == null) "Connecting…" else "Available for assistance"
    }

    override fun onStop() {
        super.onStop()
        SignalingHub.removeUiListener(this)
    }

    /* ---- SignalingHub.UiListener ---- */

    override fun onPinState(state: SignalingHub.PinState) {
        pinState = state
        status = "Available for assistance"
    }

    override fun onConsentRequest(req: SignalingHub.ConsentRequest) {
        pending = req
        if (!ensureOverlayPermission()) {
            SignalingHub.reportConsent(req.sessionId, false)
            status = "Grant the on-screen banner permission, then try again"
            pending = null
            return
        }
        // Attended: show the mandatory consent modal. Unattended connect handshake
        // is the next increment, so for now an unattended request ALSO requires
        // an on-device Accept (the safe default) via the same modal.
        val i = Intent(this, ConsentActivity::class.java)
            .putExtra(ConsentActivity.EXTRA_SESSION_ID, req.sessionId)
            .putExtra(ConsentActivity.EXTRA_CONTROLLER_ID, req.controllerId)
        consentLauncher.launch(i)
    }

    override fun onSessionEnded(reason: String) { status = "Session ended: $reason" }
    override fun onError(error: String) { status = "Error: $error" }

    private fun ensureOverlayPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) return true
        startActivity(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")),
        )
        return false
    }

    @Composable
    private fun HomeScreen() {
        Surface(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(24.dp))
                Text("OmniAssist", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text("Let trusted IT support help you", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(32.dp))

                ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Your session ID", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            pinState?.deviceId?.removePrefix("dev_") ?: "—",
                            fontSize = 22.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.height(16.dp))
                        Text("Current PIN (rotates)", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            pinState?.pin ?: "— — — — — —",
                            fontSize = 40.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "Read these to your technician. They cannot connect until you tap Accept.",
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Spacer(Modifier.height(20.dp))
                AssistChipRow(status)

                Spacer(Modifier.height(24.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = unattendedEnabled,
                        onCheckedChange = { enabled ->
                            if (enabled) {
                                // In a full build, prompt for a password here and store it.
                                // Placeholder keeps the opt-in explicit and local-only.
                                prefs.setUnattendedPassword("change-me".toCharArray())
                            } else {
                                prefs.setUnattendedPassword(null)
                            }
                            unattendedEnabled = prefs.unattendedEnabled
                        },
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Unattended access", fontWeight = FontWeight.SemiBold)
                        Text(
                            "Lets you be connected without tapping Accept each time. The banner " +
                                "and notification still always show. (Connect handshake: next build.)",
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Spacer(Modifier.weight(1f))
                Text(
                    "Only accept connections from people you trust. You can end any session " +
                        "instantly from the red banner or the notification.",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    @Composable
    private fun AssistChipRow(text: String) {
        AssistChip(onClick = {}, label = { Text(text) })
    }
}
