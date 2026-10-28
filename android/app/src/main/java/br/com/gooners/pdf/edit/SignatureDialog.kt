package br.com.gooners.pdf.edit

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.ui.dp
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import java.io.File

/** Área para desenhar a assinatura com o dedo ou caneta. */
class SignaturePad(context: Context) : View(context) {
    private val paths = ArrayList<Path>()
    private var current: Path? = null
    private val bounds = RectF()
    var color = Color.parseColor("#1E3A8A")
        set(v) { field = v; paint.color = v; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = context.resources.displayMetrics.density * 3f
        strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; color = this@SignaturePad.color
    }
    private val guide = Paint().apply { color = 0x33888888; strokeWidth = 2f }
    private var lx = 0f
    private var ly = 0f

    val isEmpty get() = paths.isEmpty()

    fun clear() { paths.clear(); current = null; invalidate() }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        parent?.requestDisallowInterceptTouchEvent(true)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { current = Path().apply { moveTo(e.x, e.y) }; paths += current!!; lx = e.x; ly = e.y }
            MotionEvent.ACTION_MOVE -> current?.let { p ->
                for (h in 0 until e.historySize) {
                    val x = e.getHistoricalX(h); val y = e.getHistoricalY(h)
                    p.quadTo(lx, ly, (x + lx) / 2, (y + ly) / 2); lx = x; ly = y
                }
                p.quadTo(lx, ly, (e.x + lx) / 2, (e.y + ly) / 2); lx = e.x; ly = e.y
            }
            MotionEvent.ACTION_UP -> { current?.lineTo(e.x, e.y); current = null }
        }
        invalidate()
        return true
    }

    override fun onDraw(c: Canvas) {
        c.drawLine(width * 0.08f, height * 0.75f, width * 0.92f, height * 0.75f, guide)
        paths.forEach { c.drawPath(it, paint) }
    }

    /** Exporta só a área desenhada, com fundo transparente. */
    fun export(): Bitmap? {
        if (paths.isEmpty()) return null
        val all = RectF()
        paths.forEachIndexed { i, p -> p.computeBounds(bounds, true); if (i == 0) all.set(bounds) else all.union(bounds) }
        val pad = paint.strokeWidth * 2
        all.inset(-pad, -pad)
        val w = all.width().toInt().coerceAtLeast(4); val h = all.height().toInt().coerceAtLeast(4)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.translate(-all.left, -all.top)
        paths.forEach { c.drawPath(it, paint) }
        return bmp
    }
}

object SignatureDialog {
    fun dir(ctx: Context) = File(ctx.filesDir, "signatures").apply { mkdirs() }

    fun saved(ctx: Context): List<File> = dir(ctx).listFiles()?.filter { it.extension == "png" }?.sortedByDescending { it.lastModified() } ?: emptyList()

    /** Mostra as assinaturas salvas e permite criar uma nova. */
    fun show(ctx: Context, onPicked: (Bitmap) -> Unit) {
        val files = saved(ctx)
        if (files.isEmpty()) { draw(ctx, onPicked); return }
        val list = RecyclerView(ctx)
        list.layoutManager = LinearLayoutManager(ctx)
        lateinit var dlg: androidx.appcompat.app.AlertDialog
        list.adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            override fun getItemCount() = files.size
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
                val iv = ImageView(ctx).apply {
                    layoutParams = RecyclerView.LayoutParams(-1, ctx.dp(90))
                    setPadding(ctx.dp(16), ctx.dp(8), ctx.dp(16), ctx.dp(8))
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    setBackgroundColor(0x10808080)
                }
                return object : RecyclerView.ViewHolder(iv) {}
            }
            override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
                val f = files[pos]
                val iv = h.itemView as ImageView
                iv.setImageBitmap(BitmapFactory.decodeFile(f.path))
                iv.setOnClickListener { BitmapFactory.decodeFile(f.path)?.let(onPicked); dlg.dismiss() }
                iv.setOnLongClickListener {
                    MaterialAlertDialogBuilder(ctx).setMessage("Excluir esta assinatura salva?")
                        .setPositiveButton("Excluir") { _, _ -> f.delete(); dlg.dismiss() }
                        .setNegativeButton("Cancelar", null).show(); true
                }
            }
        }
        dlg = MaterialAlertDialogBuilder(ctx).setTitle("Escolha a assinatura")
            .setView(list)
            .setPositiveButton("Nova assinatura") { _, _ -> draw(ctx, onPicked) }
            .setNegativeButton("Cancelar", null).show()
    }

    fun draw(ctx: Context, onPicked: (Bitmap) -> Unit) {
        val pad = SignaturePad(ctx)
        val box = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(ctx.dp(12), ctx.dp(8), ctx.dp(12), 0) }
        pad.setBackgroundColor(Color.WHITE)
        box.addView(pad, LinearLayout.LayoutParams(-1, ctx.dp(220)))
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        val colors = listOf("Preto" to Color.BLACK, "Azul" to Color.parseColor("#1E3A8A"), "Vermelho" to Color.parseColor("#B91C1C"))
        colors.forEach { (n, c) ->
            row.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = n; setTextColor(c); setOnClickListener { pad.color = c }
            }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = ctx.dp(4) })
        }
        row.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
            text = "Limpar"; setOnClickListener { pad.clear() }
        })
        box.addView(row)
        MaterialAlertDialogBuilder(ctx).setTitle("Desenhe sua assinatura")
            .setView(box)
            .setPositiveButton("Usar e salvar") { _, _ ->
                val bmp = pad.export() ?: return@setPositiveButton
                try {
                    File(dir(ctx), "sig_${System.currentTimeMillis()}.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
                } catch (_: Exception) {}
                onPicked(bmp)
            }
            .setNegativeButton("Cancelar", null).show()
    }
}
