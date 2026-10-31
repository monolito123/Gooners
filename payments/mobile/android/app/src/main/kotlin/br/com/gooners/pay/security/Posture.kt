package br.com.gooners.pay.security

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
import android.view.accessibility.AccessibilityManager
import br.com.gooners.pay.core.risk.PostureSource
import java.io.File
import java.util.function.Consumer

/**
 * The device posture signals of docs/07 §3.3 that Android shows an app. Each is a hint, not
 * proof: a determined attacker hides them, which is why the platform never trusts the phone's
 * score alone and attestation binds the app (§3.8). What cannot change while the app runs is
 * read once.
 */
class AndroidPosture(private val context: Context) : PostureSource {
    private val rooted by lazy { ROOT_PATHS.any { File(it).exists() } || Build.TAGS?.contains("test-keys") == true }
    private val emulator by lazy {
        Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") || Build.HARDWARE in setOf("goldfish", "ranchu") ||
            Build.PRODUCT.contains("sdk") || Build.MODEL.contains("Emulator")
    }
    private val hooked by lazy {
        runCatching { Class.forName("de.robv.android.xposed.XposedBridge"); true }.getOrDefault(false) ||
            runCatching { File("/proc/self/maps").useLines { lines -> lines.any { l -> HOOKS.any { l.contains(it, ignoreCase = true) } } } }.getOrDefault(false)
    }

    override fun signals(): Set<String> = buildSet {
        val r = context.contentResolver
        if (Settings.Global.getInt(r, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1) add("developer_options")
        if (Settings.Global.getInt(r, Settings.Global.ADB_ENABLED, 0) == 1) add("adb_enabled")
        val a11y = context.getSystemService(AccessibilityManager::class.java)
        if (a11y?.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)?.isNotEmpty() == true) add("accessibility_service")
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) add("debugger")
        if (emulator) add("emulator")
        if (rooted) add("root_indicators")
        if (hooked) add("hooking")
        if (ScreenWatch.obscuredRecently()) add("overlay_active")
        if (ScreenWatch.recording) add("screen_captured")
    }

    private companion object {
        val ROOT_PATHS = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/data/local/bin/su", "/data/local/xbin/su",
            "/system/app/Superuser.apk", "/data/adb/magisk")
        val HOOKS = listOf("frida", "xposed", "lsposed", "substrate")
    }
}

/** What the activity sees of its own window: touches through an overlay, screen recording. */
object ScreenWatch {
    private const val OVERLAY_WINDOW_MILLIS = 10 * 60_000L

    @Volatile private var obscuredAt = 0L

    @Volatile var recording = false

    /** A touch reached the app through another app's window. */
    fun obscured() {
        obscuredAt = SystemClock.elapsedRealtime()
    }

    fun obscuredRecently(): Boolean = obscuredAt != 0L && SystemClock.elapsedRealtime() - obscuredAt < OVERLAY_WINDOW_MILLIS

    /** Follows whether the screen is being recorded or shared (Android 15+); returns the stop. */
    fun watchRecording(activity: Activity): () -> Unit {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return {}
        val wm = activity.windowManager
        val callback = Consumer<Int> { recording = it == WindowManager.SCREEN_RECORDING_STATE_VISIBLE }
        callback.accept(wm.addScreenRecordingCallback(activity.mainExecutor, callback))
        return {
            wm.removeScreenRecordingCallback(callback)
            recording = false
        }
    }
}
