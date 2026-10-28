package br.com.gooners.pdf.ui

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator

fun Context.dp(v: Float): Int = (v * resources.displayMetrics.density + 0.5f).toInt()
fun Context.dp(v: Int): Int = dp(v.toFloat())

object Dialogs {

    val palette = intArrayOf(
        0xFF000000.toInt(), 0xFF374151.toInt(), 0xFFFFFFFF.toInt(), 0xFFDC2626.toInt(), 0xFFEA580C.toInt(), 0xFFF59E0B.toInt(),
        0xFFFDE047.toInt(), 0xFF16A34A.toInt(), 0xFF84CC16.toInt(), 0xFF0EA5E9.toInt(), 0xFF2563EB.toInt(), 0xFF4F46E5.toInt(),
        0xFF9333EA.toInt(), 0xFFDB2777.toInt(), 0xFF92400E.toInt(), 0xFF0F766E.toInt()
    )

    fun field(ctx: Context, hint: String, initial: String = "", type: Int = InputType.TYPE_CLASS_TEXT): EditText =
        EditText(ctx).apply {
            this.hint = hint
            setText(initial)
            inputType = type
            setSelection(text.length)
        }

    fun wrap(ctx: Context, vararg views: View): View {
        val ll = LinearLayout(ctx)
        ll.orientation = LinearLayout.VERTICAL
        val p = ctx.dp(20)
        ll.setPadding(p, ctx.dp(8), p, 0)
        views.forEach { ll.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
        return ll
    }

    fun input(ctx: Context, title: String, hint: String = "", initial: String = "", type: Int = InputType.TYPE_CLASS_TEXT,
              ok: String = "OK", onOk: (String) -> Unit) {
        val et = field(ctx, hint, initial, type)
        MaterialAlertDialogBuilder(ctx)
            .setTitle(title)
            .setView(wrap(ctx, et))
            .setPositiveButton(ok) { _, _ -> onOk(et.text.toString()) }
            .setNegativeButton("Cancelar", null)
            .show()
        et.requestFocus()
    }

    fun password(ctx: Context, title: String, message: String? = null, onCancel: (() -> Unit)? = null, onOk: (String) -> Unit) {
        val et = field(ctx, "Senha", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        MaterialAlertDialogBuilder(ctx)
            .setTitle(title)
            .apply { if (message != null) setMessage(message) }
            .setView(wrap(ctx, et))
            .setCancelable(false)
            .setPositiveButton("Abrir") { _, _ -> onOk(et.text.toString()) }
            .setNegativeButton("Cancelar") { _, _ -> onCancel?.invoke() }
            .show()
    }

    fun confirm(ctx: Context, title: String, message: String, yes: String = "OK", onYes: () -> Unit) {
        MaterialAlertDialogBuilder(ctx).setTitle(title).setMessage(message)
            .setPositiveButton(yes) { _, _ -> onYes() }
            .setNegativeButton("Cancelar", null).show()
    }

    fun message(ctx: Context, title: String, message: CharSequence) {
        MaterialAlertDialogBuilder(ctx).setTitle(title).setMessage(message).setPositiveButton("OK", null).show()
    }

    fun choose(ctx: Context, title: String, items: List<String>, onPick: (Int) -> Unit) {
        MaterialAlertDialogBuilder(ctx).setTitle(title)
            .setItems(items.toTypedArray()) { _, i -> onPick(i) }
            .setNegativeButton("Cancelar", null).show()
    }

    fun single(ctx: Context, title: String, items: List<String>, selected: Int, onPick: (Int) -> Unit) {
        MaterialAlertDialogBuilder(ctx).setTitle(title)
            .setSingleChoiceItems(items.toTypedArray(), selected) { d, i -> onPick(i); d.dismiss() }
            .setNegativeButton("Cancelar", null).show()
    }

    fun color(ctx: Context, current: Int, onPick: (Int) -> Unit) {
        val grid = GridLayout(ctx).apply { columnCount = 4; setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), 0) }
        lateinit var dlg: AlertDialog
        for (c in palette) {
            val v = View(ctx)
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(c)
                setStroke(ctx.dp(if (c == current) 4 else 1), if (c == current) 0xFF4F46E5.toInt() else Color.GRAY)
            }
            v.background = bg
            val lp = GridLayout.LayoutParams().apply { width = ctx.dp(48); height = ctx.dp(48); setMargins(ctx.dp(8), ctx.dp(8), ctx.dp(8), ctx.dp(8)) }
            v.setOnClickListener { onPick(c); dlg.dismiss() }
            grid.addView(v, lp)
        }
        val frame = FrameLayout(ctx).apply { addView(grid, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_HORIZONTAL)) }
        dlg = MaterialAlertDialogBuilder(ctx).setTitle("Cor").setView(frame).setNegativeButton("Cancelar", null).show()
    }

    class Progress(val dialog: AlertDialog, private val bar: LinearProgressIndicator, private val label: TextView) {
        fun update(text: String, fraction: Float? = null) {
            label.text = text
            if (fraction == null) bar.isIndeterminate = true else {
                if (bar.isIndeterminate) { bar.visibility = View.INVISIBLE; bar.isIndeterminate = false; bar.visibility = View.VISIBLE }
                bar.setProgressCompat((fraction * 100).toInt().coerceIn(0, 100), true)
            }
        }
        fun dismiss() = try { dialog.dismiss() } catch (_: Exception) {}
    }

    fun progress(ctx: Context, text: String): Progress {
        val label = TextView(ctx).apply { this.text = text; setPadding(0, 0, 0, ctx.dp(12)) }
        val bar = LinearProgressIndicator(ctx).apply { isIndeterminate = true }
        val d = MaterialAlertDialogBuilder(ctx).setView(wrap(ctx, label, bar)).setCancelable(false).show()
        return Progress(d, bar, label)
    }
}
