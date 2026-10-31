package br.com.gooners.pay.ui

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.provider.Settings.Global
import android.view.HapticFeedbackConstants
import android.view.View
import br.com.gooners.pay.data.Settings

/**
 * Sound and touch for the moments of a sale (docs/06 §7). Sounds follow the ring mode,
 * except the approval tone, which the merchant can force on for a busy counter.
 */
class Feedback(private val context: Context, private val settings: Settings) {
    private val tones by lazy { runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80) }.getOrNull() }

    private fun ringing() = context.getSystemService(AudioManager::class.java)?.ringerMode == AudioManager.RINGER_MODE_NORMAL

    /** "Remove animations" in the system settings: motion becomes cross-fades. */
    fun reduceMotion(): Boolean = Global.getFloat(context.contentResolver, Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

    fun cardDetected(view: View) {
        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        if (ringing()) tones?.startTone(ToneGenerator.TONE_PROP_BEEP, 60)
    }

    fun approved(view: View) {
        view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        if (ringing() || settings.approvalTone) tones?.startTone(ToneGenerator.TONE_PROP_ACK, 300) // two notes
    }

    fun declined(view: View) {
        view.performHapticFeedback(HapticFeedbackConstants.REJECT) // a double pulse
        if (ringing()) tones?.startTone(ToneGenerator.TONE_PROP_NACK, 300) // one low note
    }
}
