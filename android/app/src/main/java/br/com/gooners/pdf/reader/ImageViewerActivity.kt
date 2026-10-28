package br.com.gooners.pdf.reader

import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.PagerSnapHelper
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.ZipRes
import br.com.gooners.pdf.ocr.OcrHelper
import br.com.gooners.pdf.tools.PdfTools
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.util.BitmapUtil
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.max

/** Visualizador de imagens (JPG, PNG, WebP, GIF animado, HEIC/AVIF, BMP) e de quadrinhos CBZ. */
class ImageViewerActivity : AppCompatActivity() {
    private lateinit var toolbar: MaterialToolbar
    private lateinit var pager: RecyclerView
    private val lm by lazy { LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false) }
    private var pages: List<String> = emptyList() // caminhos no ZIP ou o próprio arquivo
    private var zip: ZipRes? = null
    private var single: Uri? = null
    private var name = ""
    private var current = 0
    private val saver = SaveHelper(this)
    private val maxDim by lazy { (max(resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels) * 1.6f).toInt().coerceIn(1024, 4096) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_image)
        val uri = intent.data ?: run { finish(); return }
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, uri)
        val kind = runCatching { DocKind.valueOf(intent.getStringExtra(Router.EXTRA_KIND) ?: "") }.getOrDefault(DocKind.IMAGE)
        toolbar = findViewById(R.id.toolbar)
        toolbar.title = name
        toolbar.setNavigationOnClickListener { finish() }
        toolbar.inflateMenu(R.menu.image_viewer)
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }
        pager = findViewById(R.id.pager)
        pager.layoutManager = lm
        PagerSnapHelper().attachToRecyclerView(pager)
        pager.adapter = Adapter()
        pager.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrollStateChanged(rv: RecyclerView, state: Int) {
                if (state == RecyclerView.SCROLL_STATE_IDLE) {
                    current = lm.findFirstCompletelyVisibleItemPosition().takeIf { it >= 0 } ?: current
                    updateTitle()
                }
            }
        })
        if (kind == DocKind.CBZ) {
            lifecycleScope.launch {
                try {
                    val f = withContext(Dispatchers.IO) { FileUtil.copyToCache(this@ImageViewerActivity, uri, "work", name) }
                    val z = withContext(Dispatchers.IO) { ZipRes(f) }
                    zip = z
                    pages = z.entries().filter { DocKind.fromName(it) == DocKind.IMAGE }.sortedWith(naturalOrder)
                    pager.adapter?.notifyDataSetChanged()
                    updateTitle()
                } catch (e: Exception) {
                    Dialogs.message(this@ImageViewerActivity, "Erro", e.message ?: e.toString())
                }
            }
        } else {
            single = uri
            pages = listOf(uri.toString())
        }
    }

    private val naturalOrder = Comparator<String> { a, b ->
        val ra = Regex("\\d+|\\D+").findAll(a.lowercase()).map { it.value }.toList()
        val rb = Regex("\\d+|\\D+").findAll(b.lowercase()).map { it.value }.toList()
        for (i in 0 until minOf(ra.size, rb.size)) {
            val x = ra[i]; val y = rb[i]
            val c = if (x[0].isDigit() && y[0].isDigit()) (x.toBigIntegerOrNull() ?: 0.toBigInteger()).compareTo(y.toBigIntegerOrNull() ?: 0.toBigInteger()) else x.compareTo(y)
            if (c != 0) return@Comparator c
        }
        ra.size - rb.size
    }

    private fun updateTitle() {
        if (pages.size > 1) toolbar.subtitle = "${current + 1} / ${pages.size}"
    }

    private fun decode(index: Int): Drawable? {
        val s = single
        if (s != null) {
            if (Build.VERSION.SDK_INT >= 28) {
                try {
                    val d = ImageDecoder.decodeDrawable(ImageDecoder.createSource(contentResolver, s)) { dec, info, _ ->
                        val m = max(info.size.width, info.size.height)
                        if (m > maxDim) { val f = maxDim.toFloat() / m; dec.setTargetSize((info.size.width * f).toInt(), (info.size.height * f).toInt()) }
                    }
                    if (d is AnimatedImageDrawable) d.start()
                    return d
                } catch (_: Exception) {
                }
            }
            return BitmapUtil.decode(this, s, maxDim)?.let { BitmapDrawable(resources, it) }
        }
        val bytes = zip?.bytes(pages[index]) ?: return null
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        var sample = 1
        while (max(o.outWidth, o.outHeight) / (sample * 2) >= maxDim) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.let { BitmapDrawable(resources, it) }
    }

    /** Arquivo local da imagem atual (para converter/compartilhar). */
    private suspend fun currentFile(): File? = withContext(Dispatchers.IO) {
        single?.let { return@withContext FileUtil.copyToCache(this@ImageViewerActivity, it, "work", name) }
        val path = pages.getOrNull(current) ?: return@withContext null
        val bytes = zip?.bytes(path) ?: return@withContext null
        File(FileUtil.dir(this@ImageViewerActivity, "tmp"), path.substringAfterLast('/')).also { it.writeBytes(bytes) }
    }

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_rotate -> (lm.findViewByPosition(current) as? FrameLayout)?.getChildAt(0)?.let { (it as ZoomImageView).rotateBy(90f) }
            R.id.m_share -> lifecycleScope.launch { currentFile()?.let { FileUtil.share(this@ImageViewerActivity, listOf(it)) } }
            R.id.m_to_pdf -> lifecycleScope.launch {
                val pd = Dialogs.progress(this@ImageViewerActivity, "Criando PDF…")
                try {
                    val files = withContext(Dispatchers.IO) {
                        if (single != null) listOfNotNull(currentFile()) else pages.mapNotNull { p ->
                            zip?.bytes(p)?.let { b -> File(FileUtil.dir(this@ImageViewerActivity, "tmp"), "cbz_" + p.substringAfterLast('/')).also { it.writeBytes(b) } }
                        }
                    }
                    val out = FileUtil.newOutFile(this@ImageViewerActivity, FileUtil.baseName(name) + ".pdf")
                    withContext(Dispatchers.IO) { PdfTools.imagesToPdf(this@ImageViewerActivity, files.map { Uri.fromFile(it) }, out, -1, 0f, 0.88f) { s, f -> runOnUiThread { pd.update(s, f) } } }
                    pd.dismiss()
                    saver.showResult(listOf(out), "PDF criado com ${files.size} página(s).")
                } catch (e: Exception) {
                    pd.dismiss(); Dialogs.message(this@ImageViewerActivity, "Erro", e.message ?: e.toString())
                }
            }
            R.id.m_ocr -> lifecycleScope.launch {
                val pd = Dialogs.progress(this@ImageViewerActivity, "Reconhecendo texto…")
                try {
                    val f = currentFile() ?: return@launch
                    val text = withContext(Dispatchers.Default) {
                        val bmp = BitmapUtil.decode(this@ImageViewerActivity, Uri.fromFile(f), 2600) ?: throw IllegalStateException("Imagem ilegível")
                        OcrHelper.recognize(bmp).text
                    }
                    pd.dismiss()
                    val out = FileUtil.newOutFile(this@ImageViewerActivity, FileUtil.baseName(name) + ".txt").also { it.writeText(text) }
                    androidx.appcompat.app.AlertDialog.Builder(this@ImageViewerActivity)
                        .setTitle("Texto reconhecido")
                        .setMessage(text.ifBlank { "(nenhum texto encontrado)" })
                        .setPositiveButton("Copiar") { _, _ ->
                            (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("ocr", text))
                            Toast.makeText(this@ImageViewerActivity, "Copiado", Toast.LENGTH_SHORT).show()
                        }
                        .setNeutralButton("Salvar .txt") { _, _ -> saver.saveAs(out) }
                        .setNegativeButton("Fechar", null).show()
                } catch (e: Exception) {
                    pd.dismiss(); Dialogs.message(this@ImageViewerActivity, "OCR indisponível", e.message ?: e.toString())
                }
            }
            R.id.m_info -> lifecycleScope.launch {
                val f = currentFile() ?: return@launch
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(f.path, o)
                Dialogs.message(this@ImageViewerActivity, "Informações", "Arquivo: ${f.name}\nDimensões: ${o.outWidth} × ${o.outHeight} px\nTamanho: ${FileUtil.human(f.length())}\nTipo: ${o.outMimeType ?: "?"}")
            }
            R.id.m_other -> intent.data?.let { FileUtil.openWithOtherApp(this, it, if (single != null) "image/*" else "application/zip") }
        }
    }

    private var barsVisible = true
    private fun toggleBars() {
        barsVisible = !barsVisible
        toolbar.animate().translationY(if (barsVisible) 0f else -toolbar.height.toFloat()).setDuration(180).start()
    }

    private inner class Adapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = pages.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val frame = FrameLayout(parent.context).apply { layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
            val iv = ZoomImageView(parent.context)
            iv.onTap = { toggleBars() }
            frame.addView(iv, FrameLayout.LayoutParams(-1, -1))
            return object : RecyclerView.ViewHolder(frame) {}
        }

        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            val iv = (h.itemView as FrameLayout).getChildAt(0) as ZoomImageView
            iv.setImageDrawable(null)
            iv.tag = pos
            lifecycleScope.launch {
                val d = withContext(Dispatchers.IO) { try { decode(pos) } catch (e: Throwable) { null } }
                if (iv.tag == pos) {
                    if (d == null) Toast.makeText(this@ImageViewerActivity, "Não foi possível exibir esta imagem", Toast.LENGTH_SHORT).show()
                    iv.setImageDrawable(d)
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        zip?.close()
    }
}
