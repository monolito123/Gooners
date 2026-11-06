package com.omniassist.client

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The mandatory consent modal. There is no code path that starts a session
 * without this returning RESULT_OK. It is launched for every attended session.
 *
 * Input: EXTRA_SESSION_ID, EXTRA_CONTROLLER_ID.
 * Output: RESULT_OK only if the user taps Accept; RESULT_CANCELED otherwise
 *         (including back-press / timeout), which the caller reports as a
 *         rejection to the server.
 */
class ConsentActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Back press counts as rejection.
        setResult(Activity.RESULT_CANCELED)

        val controller = intent.getStringExtra(EXTRA_CONTROLLER_ID) ?: "unknown"

        setContent {
            MaterialTheme {
                ConsentScreen(
                    controller = controller,
                    onAccept = { setResult(Activity.RESULT_OK); finish() },
                    onReject = { setResult(Activity.RESULT_CANCELED); finish() },
                )
            }
        }
    }

    // Prevent dismissing by tapping outside / recents; must be an explicit choice.
    override fun onUserLeaveHint() {
        setResult(Activity.RESULT_CANCELED)
        super.onUserLeaveHint()
    }

    companion object {
        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_CONTROLLER_ID = "controller_id"
    }
}

@Composable
private fun ConsentScreen(controller: String, onAccept: () -> Unit, onReject: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("⚠️", fontSize = 48.sp)
            Spacer(Modifier.height(16.dp))
            Text(
                "Allow remote assistance?",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                "Warning: Remote assistance allows a technician to view and control " +
                    "your device. Only accept connections from trusted individuals or " +
                    "IT support.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "Requesting controller: $controller",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "While connected, your device will keep showing a notification and an " +
                    "on-screen banner. You can end the session at any time.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(28.dp))
            Button(onClick = onAccept, modifier = Modifier.fillMaxWidth()) {
                Text("Accept — start the session")
            }
            Spacer(Modifier.height(10.dp))
            OutlinedButton(onClick = onReject, modifier = Modifier.fillMaxWidth()) {
                Text("Reject")
            }
        }
    }
}
