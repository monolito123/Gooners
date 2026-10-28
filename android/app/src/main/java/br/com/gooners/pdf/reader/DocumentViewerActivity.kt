package br.com.gooners.pdf.reader

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.print.PrintManager
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.DocumentConverter
import br.com.gooners.pdf.convert.HtmlDoc
import br.com.gooners.pdf.create.EditorActivity
import br.com.gooners.pdf.tools.ToolActivity
import br.com.gooners.pdf.tools.ToolId
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Prefs
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.File

/** Leitor de Word, Excel, PowerPoint, OpenDocument, EPUB, FB2, RTF, Markdown, HTML, CSV, SVG e formatos 97-2003. */
class DocumentViewerActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var toolbar: MaterialToolbar
    private lateinit var progress: LinearProgressIndicator
    private lateinit var epubBar: View
    private lateinit var chapterLabel: TextView
    private lateinit var findBar: View
    private lateinit var findInput: EditText
    private var doc: HtmlDoc? = null
    private var file: File? = null
    private lateinit var kind: DocKind
    private var name = ""
    private var key = ""
    private var chapter = 0
    private val saver = SaveHelper(this)
    private var night = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_document)
        val uri = intent.data ?: run { finish(); return }
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, uri)
        kind = runCatching { DocKind.valueOf(intent.getStringExtra(Router.EXTRA_KIND) ?: "") }.getOrDefault(DocKind.fromName(name))
        key = FileUtil.keyFor(uri)
        night = Prefs.readingTheme == 1
        toolbar = findViewById(R.id.toolbar)
        toolbar.title = name
        toolbar.subtitle = kind.label
        toolbar.setNavigationOnClickListener { finish() }
        toolbar.inflateMenu(R.menu.document_viewer)
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }
        progress = findViewById(R.id.progress)
        epubBar = findViewById(R.id.epubBar)
        chapterLabel = findViewById(R.id.chapterLabel)
        findBar = findViewById(R.id.findBar)
        findInput = findViewById(R.id.findInput)
        web = findViewById(R.id.web)
        web.settings.apply {
            javaScriptEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            builtInZoomControls = true
            displayZoomControls = false
            loadWithOverviewMode = kind == DocKind.HTML
            useWideViewPort = kind == DocKind.HTML
            textZoom = Prefs.textSize
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        web.setBackgroundColor(if (night) 0xFF111214.toInt() else 0xFFFFFFFF.toInt())
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url.toString()
                val d = doc ?: return null
                if (!url.startsWith(DocumentConverter.BASE)) {
                    // documentos convertidos ficam offline; páginas HTML do usuário podem carregar imagens da web
                    return if (d.raw) null else WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
                }
                var bytes = d.resource(url) ?: return WebResourceResponse("text/plain", "utf-8", 404, "Not found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                val path = url.substringBefore('#').substringBefore('?')
                val mime = FileUtil.mimeOf(path).let { if (path.endsWith(".xhtml") || path.endsWith(".html") || path.endsWith(".htm")) "text/html" else it }
                if (mime == "text/html" && d.epub != null) bytes = injectStyle(String(bytes, Charsets.UTF_8)).toByteArray()
                return WebResourceResponse(mime, "utf-8", ByteArrayInputStream(bytes))
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith(DocumentConverter.BASE)) {
                    // links internos de EPUB: acompanha o capítulo atual
                    doc?.epub?.let { b ->
                        val path = android.net.Uri.decode(url.removePrefix(DocumentConverter.BASE).substringBefore('#'))
                        val idx = b.chapters.indexOf(path)
                        if (idx >= 0 && idx != chapter) { chapter = idx; updateChapterLabel() }
                    }
                    return false
                }
                if (url.startsWith("#")) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }
        }
        findViewById<MaterialButton>(R.id.prevChapter).setOnClickListener { openChapter(chapter - 1) }
        findViewById<MaterialButton>(R.id.nextChapter).setOnClickListener { openChapter(chapter + 1) }
        chapterLabel.setOnClickListener { showToc() }
        findInput.setOnEditorActionListener { _, _, _ -> web.findAllAsync(findInput.text.toString()); true }
        findViewById<View>(R.id.findNext).setOnClickListener { web.findNext(true) }
        findViewById<View>(R.id.findPrev).setOnClickListener { web.findNext(false) }
        findViewById<View>(R.id.findClose).setOnClickListener { web.clearMatches(); findBar.visibility = View.GONE }
        web.setFindListener { active, count, _ -> if (count == 0 && findInput.text.isNotEmpty()) findViewById<TextView>(R.id.findCount).text = "0" else findViewById<TextView>(R.id.findCount).text = if (count > 0) "${active + 1}/$count" else "" }
        load(uri)
    }

    private fun injectStyle(html: String): String {
        val style = "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>" + DocumentConverter.css(night) + "</style>"
        val i = html.indexOf("</head>", ignoreCase = true)
        return if (i >= 0) html.substring(0, i) + style + html.substring(i) else style + html
    }

    private fun load(uri: android.net.Uri) {
        progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val f = withContext(Dispatchers.IO) { FileUtil.copyToCache(this@DocumentViewerActivity, uri, "work", name) }
                file = f
                val d = withContext(Dispatchers.IO) { DocumentConverter.load(this@DocumentViewerActivity, f, kind, name) }
                doc = d
                if (d.epub != null) {
                    toolbar.title = d.title
                    epubBar.visibility = View.VISIBLE
                    openChapter(Prefs.lastPage("ch_$key").coerceIn(0, (d.epub.chapters.size - 1).coerceAtLeast(0)))
                } else if (d.raw) {
                    web.loadDataWithBaseURL(DocumentConverter.BASE, d.body, "text/html", "utf-8", null)
                } else {
                    web.loadDataWithBaseURL(DocumentConverter.BASE, DocumentConverter.wrap(d.body, d.title, night), "text/html", "utf-8", null)
                }
            } catch (e: Throwable) {
                Dialogs.message(this@DocumentViewerActivity, "Não foi possível abrir", (e.message ?: e.toString()) +
                    "\n\nVocê pode tentar abrir com outro aplicativo pelo menu.")
            } finally {
                progress.visibility = View.GONE
            }
        }
    }

    private fun openChapter(i: Int) {
        val b = doc?.epub ?: return
        if (i !in b.chapters.indices) return
        chapter = i
        web.loadUrl(DocumentConverter.BASE + b.chapters[i])
        updateChapterLabel()
        Prefs.setLastPage("ch_$key", i)
    }

    private fun updateChapterLabel() {
        val b = doc?.epub ?: return
        val t = b.toc.lastOrNull { it.chapter <= chapter }?.title ?: "Capítulo ${chapter + 1}"
        chapterLabel.text = "${chapter + 1}/${b.chapters.size} · $t"
    }

    private fun showToc() {
        val b = doc?.epub ?: run { toast("Sem sumário"); return }
        Dialogs.choose(this, "Sumário", b.toc.map { "  ".repeat(it.level) + it.title }) { openChapter(b.toc[it].chapter) }
    }

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_find -> { findBar.visibility = View.VISIBLE; findInput.requestFocus() }
            R.id.m_toc -> showToc()
            R.id.m_text_size -> {
                val sizes = listOf(70, 85, 100, 115, 130, 150, 175, 200)
                Dialogs.single(this, "Tamanho do texto", sizes.map { "$it%" }, sizes.indexOf(web.settings.textZoom).coerceAtLeast(2)) {
                    web.settings.textZoom = sizes[it]; Prefs.textSize = sizes[it]
                }
            }
            R.id.m_night -> {
                night = !night
                Prefs.readingTheme = if (night) 1 else 0
                web.setBackgroundColor(if (night) 0xFF111214.toInt() else 0xFFFFFFFF.toInt())
                val d = doc ?: return
                if (d.epub != null) openChapter(chapter)
                else if (!d.raw) web.loadDataWithBaseURL(DocumentConverter.BASE, DocumentConverter.wrap(d.body, d.title, night), "text/html", "utf-8", null)
            }
            R.id.m_to_pdf -> file?.let { ToolActivity.start(this, ToolId.DOC_TO_PDF, it, name, null) }
            R.id.m_print -> {
                val pm = getSystemService(PRINT_SERVICE) as PrintManager
                pm.print(FileUtil.baseName(name), web.createPrintDocumentAdapter(FileUtil.baseName(name)), null)
            }
            R.id.m_edit -> file?.let { f ->
                lifecycleScope.launch {
                    val html = withContext(Dispatchers.IO) {
                        val d = doc ?: return@withContext null
                        if (d.epub != null) d.epub.combinedHtml("") else d.body
                    } ?: return@launch
                    startActivity(Intent(this@DocumentViewerActivity, EditorActivity::class.java)
                        .putExtra(EditorActivity.EXTRA_HTML, if (html.length > 400_000) html.take(400_000) else html)
                        .putExtra(EditorActivity.EXTRA_TITLE, FileUtil.baseName(name)))
                }
            }
            R.id.m_share -> file?.let { FileUtil.share(this, listOf(it)) }
            R.id.m_saveas -> file?.let { saver.saveAs(it, name) }
            R.id.m_other -> intent.data?.let { FileUtil.openWithOtherApp(this, it, FileUtil.mimeOf(name)) }
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        super.onDestroy()
        web.destroy()
        doc?.close()
    }
}
