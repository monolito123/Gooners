package com.omniassist.client

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The always-visible session banner. Drawn as a system overlay so it stays on
 * top of every app for the whole session: the device owner can never lose sight
 * of the fact that the screen is being viewed/controlled, and can end it with
 * one tap.
 *
 * If the overlay permission is missing or the banner cannot be attached, the
 * caller (SessionService) treats that as a hard failure and refuses to capture.
 */
class OverlayController(private val context: Context) {

    private var root: View? = null
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    fun canDraw(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

    /** @return true if the banner is now showing. */
    fun show(onEnd: () -> Unit): Boolean {
        if (!canDraw() || root != null) return root != null

        val bar = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#D32F2F"))
            gravity = Gravity.CENTER_VERTICAL
            setPadding(32, 18, 32, 18)
        }
        val label = TextView(context).apply {
            text = "⚠️ Remote Assistance Active — your screen is being viewed/controlled"
            setTextColor(Color.WHITE)
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val end = Button(context).apply {
            text = "End"
            setOnClickListener { onEnd() }
        }
        bar.addView(label)
        bar.addView(end)

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            // Not focusable (so it doesn't steal input) but still visible & tappable.
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP }

        return try {
            wm.addView(bar, lp)
            root = bar
            true
        } catch (e: Exception) {
            false
        }
    }

    fun hide() {
        root?.let { runCatching { wm.removeView(it) } }
        root = null
    }
}
