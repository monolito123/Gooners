package br.com.gooners.pay

import android.os.Build
import android.os.Bundle
import android.view.MotionEvent
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import br.com.gooners.pay.security.ScreenWatch
import br.com.gooners.pay.security.UnlockReason
import br.com.gooners.pay.ui.AppRoot
import br.com.gooners.pay.ui.GoonersPayTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {
    private val vm: MainViewModel by viewModels()
    private var prompting: CompletableDeferred<Boolean>? = null
    private var stopRecordingWatch: () -> Unit = {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Amounts, QR codes and the root key backup stay out of screenshots and the recents view.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        // Other apps' overlays are not drawn over the checkout (overlay malware, docs/07 §3.3).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setHideOverlayWindows(true)
        enableEdgeToEdge()
        setContent { GoonersPayTheme { AppRoot(vm) } }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) {
                vm.unlocker.request.collect { r -> if (r != null && r.second !== prompting) prompt(r.first, r.second) }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        stopRecordingWatch = ScreenWatch.watchRecording(this)
    }

    override fun onStop() {
        stopRecordingWatch()
        super.onStop()
    }

    /** A touch that went through another app's window is a posture signal (docs/07 §3.3). */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.flags and (MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0) ScreenWatch.obscured()
        return super.dispatchTouchEvent(ev)
    }

    private fun prompt(reason: UnlockReason, answer: CompletableDeferred<Boolean>) {
        val allowed = BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
            // No screen lock: keys are not bound to the user (debug builds only; release refuses to pair).
            vm.unlocker.answer(BuildConfig.DEBUG)
            return
        }
        prompting = answer
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(if (reason == UnlockReason.PAYOUT) "Confirmar saque" else "Desbloquear goonersPAY")
            .setSubtitle(if (reason == UnlockReason.PAYOUT) "Confirme que é você para enviar o dinheiro" else "Confirme que é você para continuar vendendo")
            .setAllowedAuthenticators(allowed)
            .build()
        BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = done(true)
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = done(false)
        }).authenticate(info)
    }

    private fun done(ok: Boolean) {
        prompting = null
        vm.unlocker.answer(ok)
    }
}
