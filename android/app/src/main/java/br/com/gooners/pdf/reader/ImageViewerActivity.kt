package br.com.gooners.pdf.reader

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.PagerSnapHelper
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.archive.ArchiveEntry
import br.com.gooners.pdf.archive.ArchiveReader
import br.com.gooners.pdf.archive.Archives
import br.com.gooners.pdf.image.ImageDecoders
import br.com.gooners.pdf.image.ImageEditorActivity
import br.com.gooners.pdf.ocr.OcrHelper
import br.com.gooners.pdf.tools.PdfTools
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.util.BitmapUtil
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Prefs
import com.google.android.material.appbar.MaterialToolbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.max

/**
 * Visualizador de imagens: JPG, PNG, WebP, GIF animado, HEIC/AVIF, BMP, TIFF multipágina, PSD, TGA,
 * Netpbm, RAW de câmeras, EPS; e quadrinhos CBZ/CBR/CB7/CBT.
 */
class ImageViewerActivity : AppCompatActivity() {
    private sealed class Page {
        class FromUri(val uri: Uri) : Page()
        class FromFile(val file: File, val fmt: ImageDecoders.Fmt, val index: Int) : Page()
        class FromArchive(val entry: ArchiveEntry) : Page()
    }

    private lateinit var toolbar: MaterialToolbar
    private lateinit var pager: RecyclerView
    private val lm by lazy { LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false) }
    private var pages: List<Page> = emptyList()
    private var archive: ArchiveReader? = null
    private var name = ""
    private var key = ""
    private var current = 0
    private val saver = SaveHelper(this)
    private val maxDim by lazy { (max(resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels) * 1.6f).toInt().coerceIn(1024, 4096) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_image)
        val uri = intent.data ?: run { finish(); return }
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, uri)
        key = FileUtil.keyFor(uri)
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
                    if (pages.size > 1) Prefs.setLastPage("img_$key", current)
                }
            }
        })
        lifecycleScope.launch {
            try {
                pages = withContext(Dispatchers.IO) { buildPages(uri, kind) }
                pager.adapter?.notifyDataSetChanged()
                if (pages.size > 1) {
                    current = Prefs.lastPage("img_$key").coerceIn(0, pages.size - 1)
                    lm.scrollToPosition(current)
                }
                updateTitle()
                if (pages.isEmpty()) Dialogs.message(this@ImageViewerActivity, "Sem imagens", "Nenhuma imagem foi encontrada neste arquivo.")
            } catch (e: Throwable) {
                Dialogs.message(this@ImageViewerActivity, "Não foi possível abrir", e.message ?: e.toString())
            }
        }
    }

    private fun buildPages(uri: Uri, kind: DocKind): List<Page> {
        if (kind == DocKind.CBZ || kind == DocKind.ZIP || kind == DocKind.ARCHIVE) {
            val f = FileUtil.copyToCache(this, uri, "work", name)
            val a = Archives.open(f, name)
            archive = a
            return a.entries.filter { DocKind.fromName(it.name) == DocKind.IMAGE }.sortedWith { x, y -> natural(x.path, y.path) }.map { Page.FromArchive(it) }
        }
        val head = FileUtil.open(this, uri).use { s -> ByteArray(64).also { s.read(it) } }
        val fmt = ImageDecoders.detect(head, name)
        if (fmt == ImageDecoders.Fmt.PLATFORM) return listOf(Page.FromUri(uri))
        val f = FileUtil.copyToCache(this, uri, "work", name)
        val n = ImageDecoders.pageCount(f, fmt)
        return (0 until n.coerceAtLeast(1)).map { Page.FromFile(f, fmt, it) }
    }

    private fun natural(a: String, b: String): Int {
        val ra = Regex("\\d+|\\D+").findAll(a.lowercase()).map { it.value }.toList()
        val rb = Regex("\\d+|\\D+").findAll(b.lowercase()).map { it.value }.toList()
        for (i in 0 until minOf(ra.size, rb.size)) {
            val x = ra[i]; val y = rb[i]
            val c = if (x[0].isDigit() && y[0].isDigit()) (x.toBigIntegerOrNull() ?: 0.toBigInteger()).compareTo(y.toBigIntegerOrNull() ?: 0.toBigInteger()) else x.compareTo(y)
            if (c != 0) return c
        }
        return ra.size - rb.size
    }

    private fun updateTitle() {
        if (pages.size > 1) toolbar.subtitle = "${current + 1} / ${pages.size}"
    }

    private fun decode(page: Page): Drawable? = when (page) {
        is Page.FromUri -> {
            var d: Drawable? = null
            if (Build.VERSION.SDK_INT >= 28) {
                try {
                    d = ImageDecoder.decodeDrawable(ImageDecoder.createSource(contentResolver, page.uri)) { dec, info, _ ->
                        val m = max(info.size.width, info.size.height)
                        if (m > maxDim) { val f = maxDim.toFloat() / m; dec.setTargetSize((info.size.width * f).toInt(), (info.size.height * f).toInt()) }
                    }
                    if (d is AnimatedImageDrawable) d.start()
                } catch (_: Exception) {}
            }
            d ?: BitmapUtil.decode(this, page.uri, maxDim)?.let { BitmapDrawable(resources, it) }
        }
        is Page.FromFile -> ImageDecoders.decode(page.file, page.fmt, page.index, maxDim)?.let { BitmapDrawable(resources, it) }
        is Page.FromArchive -> archive?.bytes(page.entry)?.let { bytes ->
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            val bmp = if (o.outWidth > 0) BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = ImageDecoders.sample(o.outWidth, o.outHeight, maxDim) })
            else {
                // formato que o Android não decodifica (TIFF, TGA…) dentro do arquivo
                val tmp = File(FileUtil.dir(this, "tmp"), page.entry.name).also { it.writeBytes(bytes) }
                val fmt = ImageDecoders.detect(bytes.copyOf(64), page.entry.name)
                runCatching { ImageDecoders.decode(tmp, fmt, 0, maxDim) }.getOrNull()
            }
            bmp?.let { BitmapDrawable(resources, it) }
        }
    }

    /** Imagem atual como arquivo comum (JPG/PNG/WebP), convertendo formatos exóticos. */
    private suspend fun currentFile(forceStandard: Boolean = false): File? = withContext(Dispatchers.IO) {
        val p = pages.getOrNull(current) ?: return@withContext null
        when (p) {
            is Page.FromUri -> FileUtil.copyToCache(this@ImageViewerActivity, p.uri, "work", name)
            is Page.FromArchive -> archive?.let { a -> a.extract(p.entry, FileUtil.dir(this@ImageViewerActivity, "tmp/img")) }
            is Page.FromFile -> if (!forceStandard && pages.size == 1) p.file else {
                val bmp = ImageDecoders.decode(p.file, p.fmt, p.index, 4096) ?: return@withContext null
                File(FileUtil.dir(this@ImageViewerActivity, "tmp"), FileUtil.baseName(name) + (if (pages.size > 1) "_p${p.index + 1}" else "") + ".png")
                    .also { f -> f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } }
            }
        }
    }

    private suspend fun allFiles(): List<File> = withContext(Dispatchers.IO) {
        pages.mapIndexedNotNull { i, p ->
            when (p) {
                is Page.FromUri -> FileUtil.copyToCache(this@ImageViewerActivity, p.uri, "work", name)
                is Page.FromArchive -> archive?.extract(p.entry, FileUtil.dir(this@ImageViewerActivity, "tmp/img"))
                is Page.FromFile -> ImageDecoders.decode(p.file, p.fmt, p.index, 3000)?.let { bmp ->
                    File(FileUtil.dir(this@ImageViewerActivity, "tmp"), "pagina_${i + 1}.jpg").also { f -> f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it) } }
                }
            }
        }
    }

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_rotate -> (lm.findViewByPosition(current) as? FrameLayout)?.getChildAt(0)?.let { (it as ZoomImageView).rotateBy(90f) }
            R.id.m_share -> lifecycleScope.launch { currentFile()?.let { FileUtil.share(this@ImageViewerActivity, listOf(it)) } }
            R.id.m_edit -> lifecycleScope.launch {
                val f = currentFile(forceStandard = true) ?: return@launch
                startActivity(Intent(this@ImageViewerActivity, ImageEditorActivity::class.java).setData(Uri.fromFile(f))
                    .putExtra(Router.EXTRA_NAME, FileUtil.baseName(name) + "." + (f.extension.ifEmpty { "jpg" }))
                    .putExtra(ImageEditorActivity.EXTRA_ORIGINAL, if (pages.size == 1 && pages[0] is Page.FromUri) intent.data?.toString() else null))
            }
            R.id.m_convert -> {
                val formats = listOf("JPG", "PNG", "WebP")
                Dialogs.choose(this, "Converter imagem para", formats) { i ->
                    lifecycleScope.launch {
                        val src = currentFile(forceStandard = true) ?: return@launch
                        val out = withContext(Dispatchers.IO) {
                            val bmp = BitmapUtil.decode(this@ImageViewerActivity, Uri.fromFile(src), 8192) ?: return@withContext null
                            @Suppress("DEPRECATION")
                            val cf = when (i) { 0 -> Bitmap.CompressFormat.JPEG; 1 -> Bitmap.CompressFormat.PNG; else -> Bitmap.CompressFormat.WEBP }
                            val flat = if (i == 0 && bmp.hasAlpha()) Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888).also { b ->
                                android.graphics.Canvas(b).apply { drawColor(android.graphics.Color.WHITE); drawBitmap(bmp, 0f, 0f, null) }
                            } else bmp
                            FileUtil.newOutFile(this@ImageViewerActivity, FileUtil.baseName(name) + "." + formats[i].lowercase())
                                .also { f -> f.outputStream().use { flat.compress(cf, 92, it) } }
                        }
                        if (out == null) toast("Não foi possível converter") else saver.showResult(listOf(out), "Imagem convertida para ${formats[i]}.")
                    }
                }
            }
            R.id.m_to_pdf -> lifecycleScope.launch {
                val pd = Dialogs.progress(this@ImageViewerActivity, "Criando PDF…")
                try {
                    val files = allFiles()
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
                    val f = currentFile(forceStandard = true) ?: return@launch
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
                            toast("Copiado")
                        }
                        .setNeutralButton("Salvar .txt") { _, _ -> saver.saveAs(out) }
                        .setNegativeButton("Fechar", null).show()
                } catch (e: Exception) {
                    pd.dismiss(); Dialogs.message(this@ImageViewerActivity, "OCR indisponível", e.message ?: e.toString())
                }
            }
            R.id.m_goto -> if (pages.size > 1) Dialogs.input(this, "Ir para a página", "1 – ${pages.size}", type = android.text.InputType.TYPE_CLASS_NUMBER) { s ->
                s.toIntOrNull()?.let { current = (it - 1).coerceIn(0, pages.size - 1); lm.scrollToPosition(current); updateTitle() }
            }
            R.id.m_info -> lifecycleScope.launch {
                val f = currentFile() ?: return@launch
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(f.path, o)
                val d = (lm.findViewByPosition(current) as? FrameLayout)?.getChildAt(0)?.let { (it as ZoomImageView).drawable }
                val w = if (o.outWidth > 0) o.outWidth else d?.intrinsicWidth ?: 0
                val h = if (o.outHeight > 0) o.outHeight else d?.intrinsicHeight ?: 0
                Dialogs.message(this@ImageViewerActivity, "Informações", "Arquivo: ${if (pages.size > 1) name else f.name}\nDimensões: $w × $h px\n" +
                    "Tamanho: ${FileUtil.human(f.length())}\nTipo: ${o.outMimeType ?: FileUtil.extension(f.name).uppercase()}" + if (pages.size > 1) "\nPáginas: ${pages.size}" else "")
            }
            R.id.m_other -> intent.data?.let { FileUtil.openWithOtherApp(this, it, if (archive == null) "image/*" else "application/zip") }
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

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
                val d = withContext(Dispatchers.IO) { try { decode(pages[pos]) } catch (e: Throwable) { null } }
                if (iv.tag == pos) {
                    if (d == null) toast("Não foi possível exibir esta imagem")
                    iv.setImageDrawable(d)
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { archive?.close() }
    }
}
