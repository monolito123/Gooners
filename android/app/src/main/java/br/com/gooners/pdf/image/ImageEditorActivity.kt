package br.com.gooners.pdf.image

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import br.com.gooners.pdf.R
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.BitmapUtil
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.slider.Slider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Mostra a imagem ajustada à tela e, no modo de recorte, um retângulo com alças. */
@SuppressLint("ViewConstructor")
class CropView(context: Context) : View(context) {
    var bitmap: Bitmap? = null
        set(v) { field = v; crop = null; requestLayout(); invalidate() }
    var cropping = false
        set(v) { field = v; if (v) resetCrop() else crop = null; invalidate() }
    /** retângulo de recorte em pixels da imagem */
    var crop: RectF? = null
        private set
    private val dst = RectF()
    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val shade = Paint().apply { color = 0x99000000.toInt() }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = context.resources.displayMetrics.density * 2 }
    private val handle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF6366F1.toInt() }
    private var drag = -1
    private var lx = 0f
    private var ly = 0f

    private fun scale(): Float { val b = bitmap ?: return 1f; return min(width / b.width.toFloat(), height / b.height.toFloat()) }

    private fun layoutDst() {
        val b = bitmap ?: return
        val s = scale()
        val w = b.width * s; val h = b.height * s
        dst.set((width - w) / 2, (height - h) / 2, (width + w) / 2, (height + h) / 2)
    }

    fun resetCrop() { val b = bitmap ?: return; crop = RectF(b.width * 0.08f, b.height * 0.08f, b.width * 0.92f, b.height * 0.92f) }

    override fun onDraw(c: Canvas) {
        val b = bitmap ?: return
        layoutDst()
        c.drawBitmap(b, null, dst, bmpPaint)
        val r = crop ?: return
        val s = scale()
        val v = RectF(dst.left + r.left * s, dst.top + r.top * s, dst.left + r.right * s, dst.top + r.bottom * s)
        c.drawRect(dst.left, dst.top, dst.right, v.top, shade)
        c.drawRect(dst.left, v.bottom, dst.right, dst.bottom, shade)
        c.drawRect(dst.left, v.top, v.left, v.bottom, shade)
        c.drawRect(v.right, v.top, dst.right, v.bottom, shade)
        c.drawRect(v, line)
        // terços para enquadramento
        line.alpha = 90
        for (k in 1..2) {
            c.drawLine(v.left + v.width() * k / 3, v.top, v.left + v.width() * k / 3, v.bottom, line)
            c.drawLine(v.left, v.top + v.height() * k / 3, v.right, v.top + v.height() * k / 3, line)
        }
        line.alpha = 255
        val rad = resources.displayMetrics.density * 9
        for ((x, y) in corners(v)) c.drawCircle(x, y, rad, handle)
    }

    private fun corners(v: RectF) = listOf(v.left to v.top, v.right to v.top, v.left to v.bottom, v.right to v.bottom)

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val r = crop ?: return false
        val b = bitmap ?: return false
        val s = scale()
        val v = RectF(dst.left + r.left * s, dst.top + r.top * s, dst.left + r.right * s, dst.top + r.bottom * s)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val tol = resources.displayMetrics.density * 32
                drag = corners(v).indexOfFirst { (x, y) -> abs(x - e.x) < tol && abs(y - e.y) < tol }
                if (drag < 0 && v.contains(e.x, e.y)) drag = 4
                lx = e.x; ly = e.y
                return drag >= 0
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = (e.x - lx) / s; val dy = (e.y - ly) / s
                lx = e.x; ly = e.y
                val minSize = 24f
                when (drag) {
                    0 -> { r.left = (r.left + dx).coerceIn(0f, r.right - minSize); r.top = (r.top + dy).coerceIn(0f, r.bottom - minSize) }
                    1 -> { r.right = (r.right + dx).coerceIn(r.left + minSize, b.width.toFloat()); r.top = (r.top + dy).coerceIn(0f, r.bottom - minSize) }
                    2 -> { r.left = (r.left + dx).coerceIn(0f, r.right - minSize); r.bottom = (r.bottom + dy).coerceIn(r.top + minSize, b.height.toFloat()) }
                    3 -> { r.right = (r.right + dx).coerceIn(r.left + minSize, b.width.toFloat()); r.bottom = (r.bottom + dy).coerceIn(r.top + minSize, b.height.toFloat()) }
                    4 -> {
                        val mx = dx.coerceIn(-r.left, b.width - r.right); val my = dy.coerceIn(-r.top, b.height - r.bottom)
                        r.offset(mx, my)
                    }
                }
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> drag = -1
        }
        return true
    }
}

/** Editor de imagens: girar, espelhar, recortar, redimensionar, filtros (inclusive para documentos) e brilho/contraste. */
class ImageEditorActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_ORIGINAL = "original"
    }

    private lateinit var view: CropView
    private lateinit var cropBar: View
    private var bmp: Bitmap? = null
    private val undo = ArrayDeque<Bitmap>()
    private var name = "imagem.jpg"
    private var dirty = false
    private val saver = SaveHelper(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = intent.data ?: run { finish(); return }
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, uri)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        val toolbar = MaterialToolbar(this).apply {
            title = "Editar imagem"; subtitle = name
            setTitleTextColor(Color.WHITE); setSubtitleTextColor(0xCCFFFFFF.toInt())
            setNavigationIcon(R.drawable.ic_prev); navigationIcon?.setTint(Color.WHITE)
            setNavigationOnClickListener { onBackPressedDispatcher.onBackPressed() }
            menu.add("Salvar").setIcon(R.drawable.ic_save).setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS)
            menu.getItem(0).icon?.setTint(Color.WHITE)
            menu.add("Compartilhar")
            if (intent.getStringExtra(EXTRA_ORIGINAL) != null) menu.add("Substituir o original")
            overflowIcon?.setTint(Color.WHITE)
            setOnMenuItemClickListener { onMenu(it.title.toString()); true }
        }
        root.addView(toolbar, LinearLayout.LayoutParams(-1, dp(56)))
        view = CropView(this)
        root.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
        cropBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; visibility = View.GONE
            setBackgroundColor(0xFF111111.toInt())
            addView(textButton("Cancelar") { view.cropping = false; visibility = View.GONE })
            addView(textButton("Proporção") { aspectDialog() })
            addView(textButton("Recortar ✓") { applyCrop() })
        }
        root.addView(cropBar, LinearLayout.LayoutParams(-1, dp(52)))
        val scroll = HorizontalScrollView(this).apply { setBackgroundColor(0xFF111111.toInt()); isHorizontalScrollBarEnabled = false }
        val tools = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(4), dp(4), dp(4), dp(4)) }
        fun tool(icon: Int, label: String, fn: () -> Unit) {
            tools.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(10), dp(6), dp(10), dp(6)); minimumWidth = dp(68)
                isClickable = true; setOnClickListener { fn() }
                addView(ImageView(context).apply { setImageResource(icon); setColorFilter(Color.WHITE) }, LinearLayout.LayoutParams(dp(24), dp(24)))
                addView(TextView(context).apply { text = label; setTextColor(Color.WHITE); textSize = 11f; maxLines = 1 })
            })
        }
        tool(R.drawable.ic_rotate, "Girar ↻") { transform { b -> BitmapUtil.rotate(b, 90f) } }
        tool(R.drawable.ic_undo, "Girar ↺") { transform { b -> BitmapUtil.rotate(b, -90f) } }
        tool(R.drawable.ic_flip, "Espelhar") { transform { b -> flip(b, true) } }
        tool(R.drawable.ic_flip, "Inverter ↕") { transform { b -> flip(b, false) } }
        tool(R.drawable.ic_crop, "Recortar") { view.cropping = true; cropBar.visibility = View.VISIBLE }
        tool(R.drawable.ic_aspect, "Tamanho") { resizeDialog() }
        tool(R.drawable.ic_filter, "Filtros") { filterDialog() }
        tool(R.drawable.ic_brightness, "Ajustes") { adjustDialog() }
        tool(R.drawable.ic_undo, "Desfazer") { undoLast() }
        scroll.addView(tools)
        root.addView(scroll, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (view.cropping) { view.cropping = false; cropBar.visibility = View.GONE; return }
                if (!dirty) { finish(); return }
                MaterialAlertDialogBuilder(this@ImageEditorActivity).setTitle("Descartar alterações?")
                    .setPositiveButton("Salvar") { _, _ -> onMenu("Salvar") }
                    .setNegativeButton("Descartar") { _, _ -> finish() }
                    .setNeutralButton("Cancelar", null).show()
            }
        })
        lifecycleScope.launch {
            val b = withContext(Dispatchers.IO) { BitmapUtil.decode(this@ImageEditorActivity, uri, 4096) }
            if (b == null) { Dialogs.message(this@ImageEditorActivity, "Erro", "Não foi possível abrir a imagem."); return@launch }
            bmp = if (b.isMutable) b else b.copy(Bitmap.Config.ARGB_8888, true)
            view.bitmap = bmp
        }
    }

    private fun textButton(t: String, fn: () -> Unit) = TextView(this).apply {
        text = t; setTextColor(Color.WHITE); textSize = 15f; setPadding(dp(18), dp(12), dp(18), dp(12)); isClickable = true; setOnClickListener { fn() }
    }

    private fun push(b: Bitmap) {
        bmp?.let { undo.addLast(it); if (undo.size > 8) undo.removeFirst() }
        bmp = b
        view.bitmap = b
        dirty = true
    }

    private fun undoLast() {
        val prev = undo.removeLastOrNull() ?: run { toast("Nada para desfazer"); return }
        bmp = prev
        view.bitmap = prev
    }

    private fun transform(fn: (Bitmap) -> Bitmap) {
        val b = bmp ?: return
        lifecycleScope.launch {
            val r = withContext(Dispatchers.Default) { try { fn(b) } catch (e: OutOfMemoryError) { null } }
            if (r == null) toast("Memória insuficiente") else push(r)
        }
    }

    private fun flip(b: Bitmap, horizontal: Boolean): Bitmap {
        val m = Matrix().apply { if (horizontal) postScale(-1f, 1f) else postScale(1f, -1f) }
        return Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
    }

    private var aspect = 0f
    private fun aspectDialog() {
        val opts = listOf("Livre" to 0f, "Quadrado 1:1" to 1f, "4:3" to 4f / 3, "3:4" to 3f / 4, "16:9" to 16f / 9, "9:16" to 9f / 16, "A4 retrato" to 210f / 297)
        Dialogs.choose(this, "Proporção do recorte", opts.map { it.first }) { i ->
            aspect = opts[i].second
            val b = bmp ?: return@choose
            val r = view.crop ?: return@choose
            if (aspect > 0) {
                val cx = r.centerX(); val cy = r.centerY()
                var w = r.width(); var h = w / aspect
                if (h > b.height) { h = b.height.toFloat(); w = h * aspect }
                if (w > b.width) { w = b.width.toFloat(); h = w / aspect }
                r.set((cx - w / 2).coerceIn(0f, b.width - w), (cy - h / 2).coerceIn(0f, b.height - h), 0f, 0f)
                r.right = r.left + w; r.bottom = r.top + h
                view.invalidate()
            }
        }
    }

    private fun applyCrop() {
        val r = view.crop ?: return
        val b = bmp ?: return
        val x = r.left.roundToInt().coerceIn(0, b.width - 1); val y = r.top.roundToInt().coerceIn(0, b.height - 1)
        val w = r.width().roundToInt().coerceIn(1, b.width - x); val h = r.height().roundToInt().coerceIn(1, b.height - y)
        view.cropping = false
        cropBar.visibility = View.GONE
        transform { Bitmap.createBitmap(it, x, y, w, h) }
    }

    private fun resizeDialog() {
        val b = bmp ?: return
        val pct = listOf(25, 50, 75, 150, 200)
        val labels = pct.map { "$it% (${b.width * it / 100} × ${b.height * it / 100})" } + listOf("Largura 1080 px", "Largura 1920 px", "Largura 3840 px")
        Dialogs.choose(this, "Redimensionar (${b.width} × ${b.height})", labels) { i ->
            val f = if (i < pct.size) pct[i] / 100f else listOf(1080f, 1920f, 3840f)[i - pct.size] / b.width
            transform { Bitmap.createScaledBitmap(it, max(1, (it.width * f).roundToInt()), max(1, (it.height * f).roundToInt()), true) }
        }
    }

    private fun matrixApply(b: Bitmap, cm: ColorMatrix): Bitmap {
        val out = Bitmap.createBitmap(b.width, b.height, Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(b, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(cm) })
        return out
    }

    /** Preto e branco "de scanner": limiar adaptativo por blocos, bom para fotos de documentos. */
    private fun documentBw(b: Bitmap): Bitmap {
        val w = b.width; val h = b.height
        val px = IntArray(w * h); b.getPixels(px, 0, w, 0, 0, w, h)
        val gray = IntArray(w * h) { val c = px[it]; ((c shr 16 and 0xFF) * 299 + (c shr 8 and 0xFF) * 587 + (c and 0xFF) * 114) / 1000 }
        // imagem integral para a média local
        val integral = LongArray((w + 1) * (h + 1))
        for (y in 1..h) { var row = 0L; for (x in 1..w) { row += gray[(y - 1) * w + x - 1]; integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row } }
        val r = max(8, min(w, h) / 24)
        for (y in 0 until h) for (x in 0 until w) {
            val x0 = max(0, x - r); val y0 = max(0, y - r); val x1 = min(w, x + r + 1); val y1 = min(h, y + r + 1)
            val sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]
            val mean = sum / ((x1 - x0) * (y1 - y0))
            px[y * w + x] = if (gray[y * w + x] < mean * 0.88) 0xFF000000.toInt() else -1
        }
        return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    }

    private fun filterDialog() {
        val items = listOf("Documento (preto e branco)", "Realçar documento", "Tons de cinza", "Sépia", "Negativo", "Cores vivas")
        Dialogs.choose(this, "Filtros", items) { i ->
            transform { b ->
                when (i) {
                    0 -> documentBw(b)
                    1 -> matrixApply(b, ColorMatrix().apply {
                        setSaturation(0.2f)
                        postConcat(ColorMatrix(floatArrayOf(1.5f, 0f, 0f, 0f, -40f, 0f, 1.5f, 0f, 0f, -40f, 0f, 0f, 1.5f, 0f, -40f, 0f, 0f, 0f, 1f, 0f)))
                    })
                    2 -> matrixApply(b, ColorMatrix().apply { setSaturation(0f) })
                    3 -> matrixApply(b, ColorMatrix(floatArrayOf(0.393f, 0.769f, 0.189f, 0f, 0f, 0.349f, 0.686f, 0.168f, 0f, 0f, 0.272f, 0.534f, 0.131f, 0f, 0f, 0f, 0f, 0f, 1f, 0f)))
                    4 -> matrixApply(b, ColorMatrix(floatArrayOf(-1f, 0f, 0f, 0f, 255f, 0f, -1f, 0f, 0f, 255f, 0f, 0f, -1f, 0f, 255f, 0f, 0f, 0f, 1f, 0f)))
                    else -> matrixApply(b, ColorMatrix().apply { setSaturation(1.6f) })
                }
            }
        }
    }

    private fun adjustDialog() {
        val bright = Slider(this).apply { valueFrom = -100f; valueTo = 100f; value = 0f; stepSize = 1f }
        val contrast = Slider(this).apply { valueFrom = -50f; valueTo = 100f; value = 0f; stepSize = 1f }
        val sat = Slider(this).apply { valueFrom = 0f; valueTo = 200f; value = 100f; stepSize = 1f }
        fun label(t: String) = TextView(this).apply { text = t; setPadding(0, dp(8), 0, 0) }
        MaterialAlertDialogBuilder(this).setTitle("Ajustes")
            .setView(Dialogs.wrap(this, label("Brilho"), bright, label("Contraste"), contrast, label("Saturação"), sat))
            .setPositiveButton("Aplicar") { _, _ ->
                val c = 1f + contrast.value / 100f
                val t = bright.value + 128f * (1 - c)
                val cm = ColorMatrix().apply { setSaturation(sat.value / 100f) }
                cm.postConcat(ColorMatrix(floatArrayOf(c, 0f, 0f, 0f, t, 0f, c, 0f, 0f, t, 0f, 0f, c, 0f, t, 0f, 0f, 0f, 1f, 0f)))
                transform { matrixApply(it, cm) }
            }
            .setNegativeButton("Cancelar", null).show()
    }

    private fun encode(b: Bitmap, ext: String): java.io.File {
        val e = ext.lowercase().let { if (it in setOf("png", "webp", "jpg", "jpeg")) it else "jpg" }
        val out = FileUtil.newOutFile(this, FileUtil.baseName(name) + "_editada." + e)
        @Suppress("DEPRECATION")
        val fmt = when (e) { "png" -> Bitmap.CompressFormat.PNG; "webp" -> Bitmap.CompressFormat.WEBP; else -> Bitmap.CompressFormat.JPEG }
        val src = if (fmt == Bitmap.CompressFormat.JPEG && b.hasAlpha()) Bitmap.createBitmap(b.width, b.height, Bitmap.Config.ARGB_8888).also {
            Canvas(it).apply { drawColor(Color.WHITE); drawBitmap(b, 0f, 0f, null) }
        } else b
        out.outputStream().use { src.compress(fmt, 92, it) }
        return out
    }

    private fun onMenu(title: String) {
        val b = bmp ?: return
        when (title) {
            "Salvar" -> Dialogs.choose(this, "Salvar como", listOf("JPG (menor)", "PNG (sem perdas)", "WebP")) { i ->
                lifecycleScope.launch {
                    val f = withContext(Dispatchers.IO) { encode(b, listOf("jpg", "png", "webp")[i]) }
                    dirty = false
                    saver.showResult(listOf(f), "Imagem editada (${b.width} × ${b.height}).")
                }
            }
            "Compartilhar" -> lifecycleScope.launch { FileUtil.share(this@ImageEditorActivity, listOf(withContext(Dispatchers.IO) { encode(b, FileUtil.extension(name)) })) }
            "Substituir o original" -> {
                val orig = intent.getStringExtra(EXTRA_ORIGINAL)?.let { Uri.parse(it) } ?: return
                Dialogs.confirm(this, "Substituir o original", "A imagem original será sobrescrita pela versão editada.", "Substituir") {
                    lifecycleScope.launch {
                        val ok = withContext(Dispatchers.IO) { runCatching { FileUtil.writeTo(this@ImageEditorActivity, encode(b, FileUtil.extension(name)), orig) }.isSuccess }
                        if (ok) { dirty = false; toast("Imagem substituída") } else toast("Sem permissão para alterar o original — use Salvar")
                    }
                }
            }
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
