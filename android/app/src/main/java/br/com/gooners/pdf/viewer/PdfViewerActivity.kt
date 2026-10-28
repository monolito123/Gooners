package br.com.gooners.pdf.viewer

import android.app.ActivityManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.ColorFilter
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Rect
import android.graphics.RectF
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.print.PrintManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.InputType
import android.util.LruCache
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.doOnNextLayout
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.edit.Annot
import br.com.gooners.pdf.edit.AnnotHistory
import br.com.gooners.pdf.edit.AnnotPainter
import br.com.gooners.pdf.edit.FormFiller
import br.com.gooners.pdf.edit.ImageAnnot
import br.com.gooners.pdf.edit.PdfBoxUtil
import br.com.gooners.pdf.edit.PdfSaver
import br.com.gooners.pdf.edit.ShapeAnnot
import br.com.gooners.pdf.edit.ShapeType
import br.com.gooners.pdf.edit.SignatureDialog
import br.com.gooners.pdf.edit.TextAnnot
import br.com.gooners.pdf.ocr.OcrHelper
import br.com.gooners.pdf.organize.OrganizeActivity
import br.com.gooners.pdf.tools.PdfPrintAdapter
import br.com.gooners.pdf.tools.PdfTools
import br.com.gooners.pdf.tools.ToolId as PdfToolId
import br.com.gooners.pdf.tools.ToolActivity
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.BitmapUtil
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Prefs
import br.com.gooners.pdf.util.Recents
import br.com.gooners.pdf.util.DocKind
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.progressindicator.CircularProgressIndicator
import com.google.android.material.slider.Slider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class PdfViewerActivity : AppCompatActivity(), PageHost {

    // ---------- views
    private lateinit var zoomLayout: ZoomLayout
    private lateinit var hscroll: HorizontalScrollView
    private lateinit var rv: RecyclerView
    private lateinit var toolbar: MaterialToolbar
    private lateinit var topBars: View
    private lateinit var bottomBars: View
    private lateinit var searchBar: View
    private lateinit var searchInput: EditText
    private lateinit var searchCount: TextView
    private lateinit var editBar: View
    private lateinit var readBar: View
    private lateinit var toolRow: LinearLayout
    private lateinit var colorSwatch: View
    private lateinit var widthSlider: Slider
    private lateinit var btnUndo: ImageButton
    private lateinit var btnRedo: ImageButton
    private lateinit var selectionBar: View
    private lateinit var fab: FloatingActionButton
    private lateinit var pageLabel: TextView
    private lateinit var pageSeek: SeekBar
    private lateinit var progress: CircularProgressIndicator
    private lateinit var hintView: TextView
    private val lm by lazy { LinearLayoutManager(this) }
    private val adapter = PageAdapter()

    // ---------- documento
    private lateinit var srcUri: Uri
    private var docName = "documento.pdf"
    private var docKey = ""
    private var workFile: File? = null
    private var password: String? = null
    private var core: PdfCore? = null
    private var pdfText: PdfText? = null
    private var modified = false
    private var editMode = false
    private val history = AnnotHistory()
    private val images = HashMap<String, Bitmap>()
    private var pendingImageKey: String? = null

    // ---------- renderização
    private val renderDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val textDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val pending = HashSet<Int>()
    private lateinit var baseCache: LruCache<Int, Bitmap>
    @Volatile private var visFirst = 0
    @Volatile private var visLast = 6
    private var viewportW = 0
    private var zoom = 1f
    private var detailJob: Job? = null
    private val handler = Handler(Looper.getMainLooper())
    private val detailRunnable = Runnable { renderDetails() }
    private var barsVisible = true
    private var currentPage = 0

    // ---------- busca
    private var searchJob: Job? = null
    private val searchResults = HashMap<Int, List<RectF>>()
    private val matches = ArrayList<Pair<Int, RectF>>()
    private var matchIdx = -1

    // ---------- leitura em voz alta
    private var tts: TextToSpeech? = null
    private var ttsPage = -1

    // ---------- PageHost
    override var tool = Tool.HAND
        private set
    override var penColor = Prefs.penColor
        private set
    override var penWidth = Prefs.penWidth
        private set
    override var highlightColor = 0xFFFDE047.toInt()
        private set
    override var colorFilter: ColorFilter? = null
        private set
    override var selected: Annot? = null
        private set

    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) { setTool(Tool.HAND); return@registerForActivityResult }
        lifecycleScope.launch {
            val bmp = withContext(Dispatchers.IO) { BitmapUtil.decode(this@PdfViewerActivity, uri, 1600) }
            if (bmp == null) toast("Não foi possível ler a imagem") else {
                pendingImageKey = putImage(bmp); hint("Toque na página onde quer colocar a imagem")
            }
        }
    }

    private val saveAsLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val f = pendingSaveFile ?: return@registerForActivityResult
        if (uri != null) lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) { runCatching { FileUtil.writeTo(this@PdfViewerActivity, f, uri) }.isSuccess }
            if (ok) {
                Router.persist(this@PdfViewerActivity, uri)
                srcUri = uri
                docName = FileUtil.displayName(this@PdfViewerActivity, uri)
                toolbar.title = docName
                Recents.add(this@PdfViewerActivity, uri.toString(), docName, DocKind.PDF, f.length())
                modified = false
                toast("Salvo em $docName")
                afterSave?.invoke()
            } else toast("Não foi possível salvar nesse local")
            afterSave = null
        }
    }
    private var pendingSaveFile: File? = null
    private var afterSave: (() -> Unit)? = null

    private val organizeLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val path = r.data?.getStringExtra(OrganizeActivity.EXTRA_RESULT) ?: return@registerForActivityResult
        modified = true
        lifecycleScope.launch { reopen(File(path)) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pdf_viewer)
        srcUri = intent.data ?: run { finish(); return }
        docName = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, srcUri)
        docKey = FileUtil.keyFor(srcUri)
        val mem = (getSystemService(ACTIVITY_SERVICE) as ActivityManager)
        val cacheBytes = (Runtime.getRuntime().maxMemory() / if (mem.isLowRamDevice) 8 else 5).toInt()
        baseCache = object : LruCache<Int, Bitmap>(cacheBytes) {
            override fun sizeOf(key: Int, value: Bitmap) = value.byteCount
        }
        bindViews()
        applyReadingTheme(Prefs.readingTheme)
        if (Prefs.keepScreenOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
        zoomLayout.post {
            viewportW = zoomLayout.width
            load()
        }
    }

    // =====================================================================
    // Layout e navegação
    // =====================================================================

    private fun bindViews() {
        zoomLayout = findViewById(R.id.zoom)
        hscroll = findViewById(R.id.hscroll)
        rv = findViewById(R.id.pages)
        toolbar = findViewById(R.id.toolbar)
        topBars = findViewById(R.id.topBars)
        bottomBars = findViewById(R.id.bottomBars)
        searchBar = findViewById(R.id.searchBar)
        searchInput = findViewById(R.id.searchInput)
        searchCount = findViewById(R.id.searchCount)
        editBar = findViewById(R.id.editBar)
        readBar = findViewById(R.id.readBar)
        toolRow = findViewById(R.id.toolRow)
        colorSwatch = findViewById(R.id.colorSwatch)
        widthSlider = findViewById(R.id.widthSlider)
        btnUndo = findViewById(R.id.btnUndo)
        btnRedo = findViewById(R.id.btnRedo)
        selectionBar = findViewById(R.id.selectionBar)
        fab = findViewById(R.id.fabEdit)
        pageLabel = findViewById(R.id.pageLabel)
        pageSeek = findViewById(R.id.pageSeek)
        progress = findViewById(R.id.progress)
        hintView = findViewById(R.id.hint)

        toolbar.title = docName
        toolbar.setNavigationOnClickListener { onBack() }
        toolbar.inflateMenu(R.menu.pdf_viewer)
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }

        rv.layoutManager = lm
        rv.adapter = adapter
        rv.setItemViewCacheSize(2)
        rv.itemAnimator = null
        rv.addItemDecoration(object : RecyclerView.ItemDecoration() {
            override fun getItemOffsets(out: Rect, v: View, parent: RecyclerView, state: RecyclerView.State) {
                out.bottom = dp(8)
            }
        })
        rv.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(r: RecyclerView, dx: Int, dy: Int) = onPagesScrolled()
            override fun onScrollStateChanged(r: RecyclerView, state: Int) {
                if (state == RecyclerView.SCROLL_STATE_IDLE) scheduleDetail()
            }
        })
        hscroll.viewTreeObserver.addOnScrollChangedListener { scheduleDetail() }
        val padListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updatePadding() }
        topBars.addOnLayoutChangeListener(padListener)
        bottomBars.addOnLayoutChangeListener(padListener)

        zoomLayout.onZoomCommit = { f, fx, fy -> setZoom(zoom * f, fx, fy) }

        pageSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar, p: Int, fromUser: Boolean) {
                if (fromUser) pageLabel.text = "${p + 1} / ${core?.pageCount ?: 0}"
            }
            override fun onStartTrackingTouch(s: SeekBar) {}
            override fun onStopTrackingTouch(s: SeekBar) = goToPage(s.progress)
        })
        pageLabel.setOnClickListener { askGoTo() }

        fab.setOnClickListener { enterEdit() }
        setupEditBar()
        setupSearch()
    }

    private fun updatePadding() {
        val top = if (barsVisible) topBars.height else 0
        val bottom = if (barsVisible) bottomBars.height else 0
        if (rv.paddingTop != top || rv.paddingBottom != bottom) rv.setPadding(0, top, 0, bottom)
    }

    private fun onPagesScrolled() {
        val first = lm.findFirstVisibleItemPosition()
        val last = lm.findLastVisibleItemPosition()
        if (first < 0) return
        visFirst = first; visLast = last
        val center = rv.findChildViewUnder(hscroll.scrollX + zoomLayout.width / 2f, zoomLayout.height / 2f)
        val p = center?.let { rv.getChildAdapterPosition(it) }?.takeIf { it >= 0 } ?: first
        if (p != currentPage) {
            currentPage = p
            updatePageLabel()
        }
        for (i in max(0, first - 1)..min((core?.pageCount ?: 1) - 1, last + 2)) ensureBase(i)
    }

    private fun updatePageLabel() {
        val n = core?.pageCount ?: 0
        pageLabel.text = "${currentPage + 1} / $n"
        pageSeek.progress = currentPage
        toolbar.subtitle = "Página ${currentPage + 1} de $n"
    }

    private fun goToPage(p: Int, offsetPt: Float = 0f) {
        val n = core?.pageCount ?: return
        val page = p.coerceIn(0, n - 1)
        lm.scrollToPositionWithOffset(page, -(offsetPt * pageScale(page)).toInt())
        currentPage = page
        updatePageLabel()
        rv.post { onPagesScrolled(); scheduleDetail() }
    }

    private fun pageScale(page: Int): Float = rv.width / (core?.widths?.getOrNull(page) ?: 1f)

    private fun askGoTo() {
        val n = core?.pageCount ?: return
        Dialogs.input(this, "Ir para a página", "1 – $n", type = InputType.TYPE_CLASS_NUMBER) { s ->
            s.toIntOrNull()?.let { goToPage(it - 1) }
        }
    }

    private fun toggleBars(show: Boolean = !barsVisible) {
        if (editMode && !show) return
        barsVisible = show
        topBars.animate().translationY(if (show) 0f else -topBars.height.toFloat()).setDuration(180).start()
        bottomBars.animate().translationY(if (show) 0f else bottomBars.height.toFloat()).setDuration(180).start()
    }

    // =====================================================================
    // Carregamento
    // =====================================================================

    private fun load() {
        progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            val original = try {
                withContext(Dispatchers.IO) { FileUtil.copyToCache(this@PdfViewerActivity, srcUri, "work", docName) }
            } catch (e: Exception) {
                fail("Não foi possível ler o arquivo: ${e.message}"); return@launch
            }
            openFile(original)
        }
    }

    private suspend fun openFile(f: File) {
        val result: Pair<PdfCore, File>? = withContext(Dispatchers.IO) {
            try {
                PdfCore.open(f) to f
            } catch (e: SecurityException) {
                null
            } catch (e: Exception) {
                // PDF danificado: tenta reparar com o PdfBox
                try {
                    if (PdfBoxUtil.needsPassword(f)) null else {
                        val rep = File(f.parentFile, "reparado_" + f.name)
                        PdfBoxUtil.repair(f, rep)
                        PdfCore.open(rep) to rep
                    }
                } catch (e2: Exception) {
                    throw IllegalStateException("PDF danificado ou inválido", e2)
                }
            }
        }
        if (result == null) askPassword(f, null) else show(result.first, result.second, Prefs.lastPage(docKey))
    }

    private fun askPassword(f: File, msg: String?) {
        progress.visibility = View.GONE
        Dialogs.password(this, "PDF protegido", msg ?: "Digite a senha para abrir \"$docName\".", onCancel = { finish() }) { pw ->
            progress.visibility = View.VISIBLE
            lifecycleScope.launch {
                val dec = withContext(Dispatchers.IO) {
                    try {
                        val out = File(f.parentFile, "aberto_" + f.name)
                        PdfBoxUtil.decrypt(f, pw, out); out
                    } catch (e: Exception) { null }
                }
                if (dec == null) askPassword(f, "Senha incorreta. Tente novamente.") else {
                    password = pw
                    show(withContext(Dispatchers.IO) { PdfCore.open(dec) }, dec, Prefs.lastPage(docKey))
                }
            }
        }
    }

    private fun show(c: PdfCore, file: File, page: Int) {
        core?.close()
        pdfText?.close()
        core = c
        workFile = file
        pdfText = PdfText(file, null)
        baseCache.evictAll()
        pending.clear()
        progress.visibility = View.GONE
        pageSeek.max = max(0, c.pageCount - 1)
        visFirst = max(0, page - 2); visLast = page + 4
        adapter.notifyDataSetChanged()
        applyZoomWidth()
        goToPage(page)
        if (intent.getBooleanExtra(Router.EXTRA_EDIT, false)) {
            intent.removeExtra(Router.EXTRA_EDIT)
            enterEdit()
            intent.getStringExtra(Router.EXTRA_TOOL)?.let { t ->
                intent.removeExtra(Router.EXTRA_TOOL)
                when (t) {
                    "FORM" -> fillForm()
                    else -> runCatching { Tool.valueOf(t) }.getOrNull()?.let { onToolClicked(it) }
                }
            }
        }
    }

    private suspend fun reopen(file: File) {
        val keep = currentPage
        try {
            val c = withContext(Dispatchers.IO) { PdfCore.open(file) }
            show(c, file, keep)
        } catch (e: Exception) {
            toast("Erro ao reabrir: ${e.message}")
        }
    }

    private fun fail(msg: String) {
        progress.visibility = View.GONE
        MaterialAlertDialogBuilder(this).setTitle("Não foi possível abrir").setMessage(msg)
            .setPositiveButton("Fechar") { _, _ -> finish() }
            .setNeutralButton("Abrir com outro app") { _, _ -> FileUtil.openWithOtherApp(this, srcUri, "application/pdf"); finish() }
            .setCancelable(false).show()
    }

    // =====================================================================
    // Renderização: página base (largura da tela) + detalhe nítido da região visível no zoom
    // =====================================================================

    private fun baseWidth(): Int {
        val lowRam = (getSystemService(ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice
        val w = min(viewportW, 2048)
        return (if (lowRam) w * 0.75f else w.toFloat()).toInt().coerceAtLeast(200)
    }

    private fun ensureBase(p: Int) {
        val c = core ?: return
        if (p < 0 || p >= c.pageCount || baseCache.get(p) != null || !pending.add(p)) return
        val w = baseWidth()
        lifecycleScope.launch {
            val bmp = withContext(renderDispatcher) {
                if (p < visFirst - 4 || p > visLast + 4 || c !== core) null
                else try { c.render(p, w) } catch (e: Exception) { null }
            }
            pending.remove(p)
            if (bmp != null && c === core) {
                baseCache.put(p, bmp)
                pageView(p)?.invalidate()
            }
        }
    }

    private fun pageView(p: Int): PageView? = (rv.findViewHolderForAdapterPosition(p)?.itemView as? PageView)

    private fun visiblePageViews(): List<PageView> {
        val out = ArrayList<PageView>()
        for (i in 0 until rv.childCount) (rv.getChildAt(i) as? PageView)?.let { out += it }
        return out
    }

    private fun scheduleDetail() {
        handler.removeCallbacks(detailRunnable)
        handler.postDelayed(detailRunnable, 140)
    }

    private fun renderDetails() {
        detailJob?.cancel()
        val views = visiblePageViews()
        if (zoom <= 1.05f) { views.forEach { it.detail = null }; return }
        val c = core ?: return
        detailJob = lifecycleScope.launch {
            for (v in views) {
                val r = Rect()
                if (!v.visibleRegion(r)) continue
                val p = v.page
                val pw = v.width
                val existing = v.detail
                if (existing != null && existing.pageWidth == pw && existing.rect.contains(r)) continue
                val margin = dp(48)
                r.set(max(0, r.left - margin), max(0, r.top - margin), min(v.width, r.right + margin), min(v.height, r.bottom + margin))
                val bmp = withContext(renderDispatcher) {
                    try { c.renderRegion(p, pw.toFloat(), r) } catch (e: Exception) { null }
                } ?: continue
                if (isActive && v.page == p && v.width == pw && c === core) v.detail = Detail(bmp, Rect(r), pw) else bmp.recycle()
            }
        }
    }

    private fun applyZoomWidth() {
        val lp = rv.layoutParams
        lp.width = (viewportW * zoom).toInt()
        rv.layoutParams = lp
        zoomLayout.currentZoom = zoom
    }

    private fun setZoom(z: Float, fx: Float, fy: Float) {
        val nz = z.coerceIn(1f, 6f)
        if (abs(nz - zoom) < 0.01f) return
        val ratio = nz / zoom
        val contentX = hscroll.scrollX + fx
        val child = rv.findChildViewUnder(contentX, fy)
        val pos = child?.let { rv.getChildAdapterPosition(it) }?.takeIf { it >= 0 } ?: currentPage
        val offset = child?.let { fy - it.top } ?: 0f
        zoom = nz
        visiblePageViews().forEach { it.detail = null }
        applyZoomWidth()
        rv.doOnNextLayout {
            lm.scrollToPositionWithOffset(pos, (fy - offset * ratio).toInt() - rv.paddingTop)
            hscroll.post {
                hscroll.scrollTo((contentX * ratio - fx).toInt().coerceAtLeast(0), 0)
                scheduleDetail()
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        zoomLayout.post {
            if (zoomLayout.width != viewportW) {
                val keep = currentPage
                viewportW = zoomLayout.width
                baseCache.evictAll()
                applyZoomWidth()
                rv.doOnNextLayout { goToPage(keep) }
            }
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW) baseCache.trimToSize(baseCache.size() / 2)
    }

    // =====================================================================
    // PageHost
    // =====================================================================

    override fun pageWidthPt(page: Int) = core?.widths?.getOrNull(page) ?: 612f
    override fun aspect(page: Int) = core?.aspect(page) ?: 1.414f
    override fun base(page: Int): Bitmap? = baseCache.get(page).also { if (it == null) ensureBase(page) }
    override fun annotations(page: Int) = history.forPage(page)
    override fun image(key: String) = images[key]
    override fun searchRects(page: Int) = searchResults[page] ?: emptyList()
    override fun currentMatch(page: Int) = matches.getOrNull(matchIdx)?.takeIf { it.first == page }?.second

    override fun onAdd(a: Annot) { history.add(a); changed(a.page) }
    override fun onChange(old: Annot, new: Annot) { history.replace(old, new); selected = new; changed(new.page) }
    override fun onErase(a: Annot) { history.remove(a); if (selected === a) selected = null; changed(a.page) }
    override fun onSelect(a: Annot?) {
        selected = a
        selectionBar.visibility = if (a != null) View.VISIBLE else View.GONE
        findViewById<View>(R.id.selEdit).visibility = if (a is TextAnnot) View.VISIBLE else View.GONE
        visiblePageViews().forEach { it.invalidate() }
    }

    override fun onSingleTap() = toggleBars()

    override fun onDoubleTap(view: PageView, x: Float, y: Float) {
        val loc = IntArray(2); val root = IntArray(2)
        view.getLocationInWindow(loc); zoomLayout.getLocationInWindow(root)
        val fx = loc[0] - root[0] + x; val fy = loc[1] - root[1] + y
        if (zoom > 1.2f) setZoom(1f, fx, fy) else setZoom(2.5f, fx, fy)
    }

    override fun onTapForText(page: Int, x: Float, y: Float) = textDialog(null, "") { text, size ->
        val a = TextAnnot(page, text, x, y - size * 0.6f, size, penColor, AnnotPainter.measureText(text, size))
        onAdd(a); setTool(Tool.SELECT); onSelect(a)
    }

    override fun onTapForImage(page: Int, x: Float, y: Float) {
        val key = pendingImageKey
        val bmp = key?.let { images[it] }
        if (key == null || bmp == null) { setTool(tool); return }
        val pageW = pageWidthPt(page)
        val w = min(pageW * 0.8f, when (tool) { Tool.SIGN -> 150f; Tool.STAMP -> 170f; else -> 220f })
        val h = w * bmp.height / bmp.width
        val a = ImageAnnot(page, key, x - w / 2, y - h / 2, x + w / 2, y + h / 2)
        onAdd(a)
        setTool(Tool.SELECT); onSelect(a)
        hint("Arraste para mover; puxe o ponto azul para redimensionar")
    }

    override fun onTapEditText(page: Int, x: Float, y: Float) {
        val t = pdfText ?: return
        lifecycleScope.launch {
            val line = withContext(textDispatcher) { t.page(page).lineAt(x, y) }
            if (line == null) {
                toast("Nenhum texto aqui. Se o PDF for digitalizado, use o OCR ou a ferramenta Texto.")
                return@launch
            }
            textDialog(null, line.text, line.fontSize) { text, size ->
                val r = RectF(line.rect).apply { inset(-1f, -1f) }
                val white = ShapeAnnot(page, ShapeType.WHITEOUT, r.left, r.top, r.right, r.bottom, 0, 0f)
                val txt = TextAnnot(page, text, line.rect.left, line.rect.top - size * 0.05f, size, 0xFF000000.toInt(), AnnotPainter.measureText(text, size))
                history.set(history.items + white + txt)
                changed(page)
            }
        }
    }

    private fun changed(page: Int) {
        pageView(page)?.invalidate()
        btnUndo.isEnabled = history.canUndo(); btnRedo.isEnabled = history.canRedo()
        btnUndo.alpha = if (btnUndo.isEnabled) 1f else 0.35f
        btnRedo.alpha = if (btnRedo.isEnabled) 1f else 0.35f
    }

    private fun putImage(bmp: Bitmap): String {
        val key = "img_${images.size}_${System.currentTimeMillis()}"
        images[key] = bmp
        return key
    }

    // =====================================================================
    // Edição
    // =====================================================================

    private data class ToolDef(val tool: Tool, val icon: Int, val label: String)

    private val toolDefs = listOf(
        ToolDef(Tool.HAND, R.drawable.ic_hand, "Mover"),
        ToolDef(Tool.SELECT, R.drawable.ic_select, "Selecionar"),
        ToolDef(Tool.EDIT_TEXT, R.drawable.ic_edit, "Editar texto"),
        ToolDef(Tool.TEXT, R.drawable.ic_text, "Texto"),
        ToolDef(Tool.PEN, R.drawable.ic_sign, "Caneta"),
        ToolDef(Tool.MARKER, R.drawable.ic_highlight, "Marca-texto"),
        ToolDef(Tool.HIGHLIGHT, R.drawable.ic_whiteout, "Destacar"),
        ToolDef(Tool.UNDERLINE, R.drawable.ic_underline, "Sublinhar"),
        ToolDef(Tool.STRIKE, R.drawable.ic_line, "Riscar"),
        ToolDef(Tool.SIGN, R.drawable.ic_sign, "Assinar"),
        ToolDef(Tool.IMAGE, R.drawable.ic_image, "Imagem"),
        ToolDef(Tool.STAMP, R.drawable.ic_stamp, "Carimbo"),
        ToolDef(Tool.RECT, R.drawable.ic_rect, "Retângulo"),
        ToolDef(Tool.OVAL, R.drawable.ic_circle, "Elipse"),
        ToolDef(Tool.LINE, R.drawable.ic_line, "Linha"),
        ToolDef(Tool.ARROW, R.drawable.ic_arrow, "Seta"),
        ToolDef(Tool.WHITEOUT, R.drawable.ic_whiteout, "Corretivo"),
        ToolDef(Tool.REDACT, R.drawable.ic_redact, "Tarjar"),
        ToolDef(Tool.ERASER, R.drawable.ic_eraser, "Borracha"),
    )
    private val toolViews = HashMap<Tool, View>()

    private fun setupEditBar() {
        for (d in toolDefs) {
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(8), dp(6), dp(8), dp(4))
                minimumWidth = dp(64)
                isClickable = true
                isFocusable = true
                contentDescription = d.label
            }
            item.addView(ImageView(this).apply { setImageResource(d.icon) }, LinearLayout.LayoutParams(dp(24), dp(24)))
            item.addView(TextView(this).apply {
                text = d.label; textSize = 11f; maxLines = 1
            })
            item.setOnClickListener { onToolClicked(d.tool) }
            toolRow.addView(item)
            toolViews[d.tool] = item
        }
        colorSwatch.background.setTint(penColor)
        colorSwatch.setOnClickListener {
            val marker = tool == Tool.MARKER || tool == Tool.HIGHLIGHT
            Dialogs.color(this, if (marker) highlightColor else penColor) { c ->
                if (marker) highlightColor = c else { penColor = c; Prefs.penColor = c }
                colorSwatch.background.setTint(c)
                (selected as? TextAnnot)?.let { onChange(it, it.copy(color = c)) }
            }
        }
        widthSlider.value = penWidth.coerceIn(0.5f, 12f)
        widthSlider.addOnChangeListener { _, v, _ -> penWidth = v; Prefs.penWidth = v }
        btnUndo.setOnClickListener { if (history.undo()) { selected = null; onSelect(null); refreshAll() } }
        btnRedo.setOnClickListener { if (history.redo()) refreshAll() }
        findViewById<MaterialButton>(R.id.btnSave).setOnClickListener { save(false) }
        findViewById<View>(R.id.selDelete).setOnClickListener { selected?.let { onErase(it); onSelect(null) } }
        findViewById<View>(R.id.selCopy).setOnClickListener {
            selected?.let { val c = it.moved(12f, 12f); onAdd(c); onSelect(c) }
        }
        findViewById<View>(R.id.selEdit).setOnClickListener {
            val t = selected as? TextAnnot ?: return@setOnClickListener
            textDialog(t, t.text, t.size) { text, size -> onChange(t, t.copy(text = text, size = size, measuredWidth = AnnotPainter.measureText(text, size))) }
        }
        changed(0)
    }

    private fun refreshAll() {
        visiblePageViews().forEach { it.invalidate() }
        changed(-1)
    }

    private fun onToolClicked(t: Tool) {
        when (t) {
            Tool.SIGN -> SignatureDialog.show(this) { bmp ->
                pendingImageKey = putImage(bmp); setTool(Tool.SIGN); hint("Toque na página onde deseja assinar")
            }
            Tool.IMAGE -> { setTool(Tool.IMAGE); pickImage.launch("image/*") }
            Tool.STAMP -> chooseStamp()
            else -> setTool(t)
        }
    }

    private fun chooseStamp() {
        val today = DateFormat.getDateInstance(DateFormat.SHORT, Locale("pt", "BR")).format(Date())
        val labels = listOf("APROVADO", "REPROVADO", "CONFIDENCIAL", "RASCUNHO", "PAGO", "RECEBIDO", "URGENTE", "CÓPIA", "REVISADO", today)
        val colors = listOf(0xFF15803D, 0xFFB91C1C, 0xFFB91C1C, 0xFF475569, 0xFF15803D, 0xFF1D4ED8, 0xFFB91C1C, 0xFF475569, 0xFF1D4ED8, 0xFF1D4ED8)
        Dialogs.choose(this, "Carimbo", labels) { i ->
            pendingImageKey = putImage(PdfSaver.stampBitmap(labels[i], colors[i].toInt()))
            setTool(Tool.STAMP); hint("Toque na página para carimbar")
        }
    }

    private fun setTool(t: Tool) {
        tool = t
        for ((k, v) in toolViews) v.setBackgroundResource(if (k == t) R.drawable.bg_selected_tool else 0)
        if (t != Tool.SELECT) onSelect(null)
        val marker = t == Tool.MARKER || t == Tool.HIGHLIGHT
        colorSwatch.background.setTint(if (marker) highlightColor else penColor)
        when (t) {
            Tool.EDIT_TEXT -> hint("Toque numa linha de texto do PDF para editá-la")
            Tool.TEXT -> hint("Toque onde quer escrever")
            Tool.REDACT -> hint("Arraste sobre o que deve ser ocultado. Ao salvar, a página é achatada e o conteúdo some de verdade.")
            Tool.WHITEOUT -> hint("Arraste para cobrir com branco")
            Tool.ERASER -> hint("Toque ou deslize sobre as anotações para apagar")
            Tool.HAND -> hint("Role e dê zoom com dois dedos")
            else -> {}
        }
    }

    private fun hint(s: String) {
        hintView.text = s
        hintView.visibility = View.VISIBLE
        hintView.alpha = 1f
        hintView.animate().cancel()
        hintView.animate().alpha(0f).setStartDelay(2600).setDuration(400).withEndAction { hintView.visibility = View.GONE }.start()
    }

    private fun textDialog(existing: TextAnnot?, initial: String, initialSize: Float = 14f, onOk: (String, Float) -> Unit) {
        val et = Dialogs.field(this, "Texto", initial, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
        et.minLines = 2
        val sizes = listOf(8f, 9f, 10f, 11f, 12f, 14f, 16f, 18f, 20f, 24f, 28f, 32f, 40f, 48f)
        val sp = Spinner(this)
        sp.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, sizes.map { "Tamanho ${it.toInt()}" })
        sp.setSelection(sizes.indices.minByOrNull { abs(sizes[it] - (existing?.size ?: initialSize)) } ?: 5)
        val date = MaterialButton(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
            text = "Inserir data de hoje"
            setOnClickListener { et.text.insert(et.selectionStart.coerceAtLeast(0), DateFormat.getDateInstance(DateFormat.SHORT, Locale("pt", "BR")).format(Date())) }
        }
        MaterialAlertDialogBuilder(this).setTitle(if (existing == null && initial.isEmpty()) "Adicionar texto" else "Editar texto")
            .setView(Dialogs.wrap(this, et, sp, date))
            .setPositiveButton("OK") { _, _ -> val s = et.text.toString(); if (s.isNotBlank()) onOk(s, sizes[sp.selectedItemPosition]) }
            .setNegativeButton("Cancelar", null).show()
        et.requestFocus()
    }

    private fun enterEdit() {
        editMode = true
        toggleBars(true)
        editBar.visibility = View.VISIBLE
        readBar.visibility = View.GONE
        fab.hide()
        setTool(if (tool == Tool.HAND) Tool.PEN else tool)
    }

    private fun exitEdit() {
        editMode = false
        setTool(Tool.HAND)
        editBar.visibility = View.GONE
        selectionBar.visibility = View.GONE
        readBar.visibility = View.VISIBLE
        fab.show()
    }

    private val isDirty get() = history.isDirty || modified

    private fun onBack() {
        when {
            searchBar.visibility == View.VISIBLE -> closeSearch()
            editMode && !history.isDirty -> exitEdit()
            isDirty -> MaterialAlertDialogBuilder(this).setTitle("Salvar alterações?")
                .setMessage("Você fez alterações em \"$docName\".")
                .setPositiveButton("Salvar") { _, _ -> save(false) { finish() } }
                .setNegativeButton("Descartar") { _, _ -> finish() }
                .setNeutralButton("Cancelar", null).show()
            else -> finish()
        }
    }

    // =====================================================================
    // Salvar
    // =====================================================================

    /** Grava anotações/alterações; tenta sobrescrever o original e, se não puder, pede um local novo. */
    private fun save(asNew: Boolean, then: (() -> Unit)? = null) {
        val src = workFile ?: return
        if (!isDirty && !asNew) { toast("Nenhuma alteração para salvar"); then?.invoke(); return }
        val pd = Dialogs.progress(this, "Salvando…")
        lifecycleScope.launch {
            try {
                val plain = FileUtil.newOutFile(this@PdfViewerActivity, docName)
                val forDisk = withContext(Dispatchers.IO) {
                    if (history.isDirty) PdfSaver.save(src, plain, history.items, images::get, null, false)
                    else src.copyTo(plain, true)
                    val pw = password
                    if (pw.isNullOrEmpty()) plain else File(plain.parentFile, "enc_" + plain.name).also { PdfTools.protect(plain, it, pw, pw) }
                }
                pd.dismiss()
                val written = !asNew && srcUri.scheme == "content" && withContext(Dispatchers.IO) {
                    runCatching { FileUtil.writeTo(this@PdfViewerActivity, forDisk, srcUri) }.isSuccess
                }
                history.clear()
                modified = !written
                selected = null
                selectionBar.visibility = View.GONE
                reopen(plain)
                if (written) {
                    toast("Alterações salvas")
                    then?.invoke()
                } else {
                    pendingSaveFile = forDisk
                    afterSave = then
                    if (!asNew) toast("Escolha onde salvar a cópia editada")
                    saveAsLauncher.launch(FileUtil.baseName(docName) + if (asNew) "_copia.pdf" else "_editado.pdf")
                }
                changed(-1)
            } catch (e: Exception) {
                pd.dismiss()
                Dialogs.message(this@PdfViewerActivity, "Erro ao salvar", e.message ?: e.toString())
            }
        }
    }

    // =====================================================================
    // Menu
    // =====================================================================

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_search -> openSearch()
            R.id.m_theme -> Dialogs.single(this, "Modo de leitura", listOf("Normal", "Noturno", "Sépia", "Alto contraste"), Prefs.readingTheme) {
                Prefs.readingTheme = it; applyReadingTheme(it)
            }
            R.id.m_share -> shareCurrent()
            R.id.m_toc -> showOutline()
            R.id.m_bookmarks -> showBookmarks()
            R.id.m_goto -> askGoTo()
            R.id.m_organize -> withSaved { f -> organizeLauncher.launch(Intent(this, OrganizeActivity::class.java).putExtra(OrganizeActivity.EXTRA_FILE, f.path).putExtra(OrganizeActivity.EXTRA_NAME, docName)) }
            R.id.m_form -> fillForm()
            R.id.m_tts -> toggleTts()
            R.id.m_copy -> copyPageText()
            R.id.m_ocr -> ocrPage()
            R.id.m_tools -> moreTools()
            R.id.m_saveas -> save(true)
            R.id.m_print -> workFile?.let {
                (getSystemService(PRINT_SERVICE) as PrintManager).print(docName, PdfPrintAdapter(it, docName), null)
            }
            R.id.m_fullscreen -> fullscreen()
            R.id.m_info -> showInfo()
            R.id.m_other -> FileUtil.openWithOtherApp(this, srcUri, "application/pdf")
        }
    }

    /** Ferramentas que reescrevem o arquivo inteiro exigem salvar as anotações antes. */
    private fun withSaved(block: (File) -> Unit) {
        val f = workFile ?: return
        if (!history.isDirty) { block(f); return }
        Dialogs.confirm(this, "Aplicar anotações", "As anotações serão gravadas na cópia de trabalho antes de continuar.", "Continuar") {
            val pd = Dialogs.progress(this, "Aplicando…")
            lifecycleScope.launch {
                val out = FileUtil.newOutFile(this@PdfViewerActivity, docName)
                try {
                    withContext(Dispatchers.IO) { PdfSaver.save(f, out, history.items, images::get, null, false) }
                    history.clear(); modified = true
                    reopen(out)
                    pd.dismiss()
                    block(out)
                } catch (e: Exception) {
                    pd.dismiss(); toast("Erro: ${e.message}")
                }
            }
        }
    }

    private fun applyReadingTheme(mode: Int) {
        colorFilter = when (mode) {
            1 -> ColorMatrixColorFilter(ColorMatrix(floatArrayOf(
                -0.9f, 0f, 0f, 0f, 235f,
                0f, -0.9f, 0f, 0f, 235f,
                0f, 0f, -0.9f, 0f, 235f,
                0f, 0f, 0f, 1f, 0f)))
            2 -> ColorMatrixColorFilter(ColorMatrix(floatArrayOf(
                0.393f, 0.769f, 0.189f, 0f, 0f,
                0.349f, 0.686f, 0.168f, 0f, 0f,
                0.272f, 0.534f, 0.131f, 0f, 0f,
                0f, 0f, 0f, 1f, 0f)).apply {
                // clareia o sépia para leitura confortável
                postConcat(ColorMatrix(floatArrayOf(1f, 0f, 0f, 0f, 18f, 0f, 1f, 0f, 0f, 12f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 1f, 0f)))
            })
            3 -> ColorMatrixColorFilter(ColorMatrix().apply {
                setSaturation(0f)
                postConcat(ColorMatrix(floatArrayOf(1.6f, 0f, 0f, 0f, -90f, 0f, 1.6f, 0f, 0f, -90f, 0f, 0f, 1.6f, 0f, -90f, 0f, 0f, 0f, 1f, 0f)))
            })
            else -> null
        }
        visiblePageViews().forEach { it.invalidate() }
        rv.setBackgroundColor(if (mode == 1) 0xFF111111.toInt() else 0)
    }

    private fun shareCurrent() {
        if (history.isDirty) {
            withSaved { FileUtil.share(this, listOf(copyNamed(it))) }
        } else workFile?.let { FileUtil.share(this, listOf(copyNamed(it))) }
    }

    private fun copyNamed(f: File): File {
        if (f.name == docName) return f
        val out = FileUtil.newOutFile(this, if (docName.endsWith(".pdf", true)) docName else "$docName.pdf")
        f.copyTo(out, true)
        return out
    }

    private fun fullscreen() {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        c.hide(WindowInsetsCompat.Type.systemBars())
        toggleBars(false)
        toast("Toque na página para mostrar os controles")
    }

    private fun moreTools() {
        val tools = listOf(
            PdfToolId.COMPRESS, PdfToolId.PROTECT, PdfToolId.UNLOCK, PdfToolId.WATERMARK, PdfToolId.PAGE_NUMBERS, PdfToolId.HEADER_FOOTER,
            PdfToolId.SPLIT, PdfToolId.EXTRACT_PAGES, PdfToolId.ROTATE, PdfToolId.TO_IMAGES, PdfToolId.TO_DOCX, PdfToolId.TO_TEXT,
            PdfToolId.TO_HTML, PdfToolId.EXTRACT_IMAGES, PdfToolId.OCR_PDF, PdfToolId.METADATA, PdfToolId.FLATTEN, PdfToolId.GRAYSCALE
        )
        Dialogs.choose(this, "Ferramentas", tools.map { it.title }) { i ->
            withSaved { f -> ToolActivity.start(this, tools[i], f, docName, password = null) }
        }
    }

    // ---------- formulário
    private fun fillForm() {
        val f = workFile ?: return
        lifecycleScope.launch {
            val fields = try { withContext(Dispatchers.IO) { FormFiller.read(f, null) } } catch (e: Exception) { emptyList() }
            if (fields.isEmpty()) {
                Dialogs.message(this@PdfViewerActivity, "Sem campos de formulário",
                    "Este PDF não tem campos preenchíveis. Use a ferramenta \"Texto\" para escrever em qualquer lugar da página.")
                if (!editMode) enterEdit()
                setTool(Tool.TEXT)
                return@launch
            }
            FormFiller.dialog(this@PdfViewerActivity, fields) { values, flatten ->
                val pd = Dialogs.progress(this@PdfViewerActivity, "Preenchendo…")
                lifecycleScope.launch {
                    val out = FileUtil.newOutFile(this@PdfViewerActivity, docName)
                    try {
                        withContext(Dispatchers.IO) { FormFiller.write(f, out, null, values, flatten) }
                        modified = true
                        reopen(out)
                        toast("Formulário preenchido — toque em Salvar para gravar")
                        if (!editMode) enterEdit()
                    } catch (e: Exception) {
                        toast("Erro: ${e.message}")
                    } finally { pd.dismiss() }
                }
            }
        }
    }

    // ---------- busca
    private fun setupSearch() {
        searchInput.setOnEditorActionListener { _, _, _ -> startSearch(searchInput.text.toString()); true }
        findViewById<View>(R.id.searchNext).setOnClickListener { stepMatch(1) }
        findViewById<View>(R.id.searchPrev).setOnClickListener { stepMatch(-1) }
        findViewById<View>(R.id.searchClose).setOnClickListener { closeSearch() }
    }

    private fun openSearch() {
        toggleBars(true)
        searchBar.visibility = View.VISIBLE
        searchInput.requestFocus()
        (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).showSoftInput(searchInput, 0)
    }

    private fun closeSearch() {
        searchJob?.cancel()
        searchBar.visibility = View.GONE
        searchResults.clear(); matches.clear(); matchIdx = -1
        (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(searchInput.windowToken, 0)
        visiblePageViews().forEach { it.invalidate() }
    }

    private fun startSearch(q: String) {
        val c = core ?: return
        val t = pdfText ?: return
        searchJob?.cancel()
        searchResults.clear(); matches.clear(); matchIdx = -1
        visiblePageViews().forEach { it.invalidate() }
        if (q.isBlank()) return
        (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(searchInput.windowToken, 0)
        val start = currentPage
        searchJob = lifecycleScope.launch {
            val n = c.pageCount
            for (k in 0 until n) {
                val p = (start + k) % n
                searchCount.text = "${(k * 100) / n}%"
                val rects = withContext(textDispatcher) { try { t.page(p).find(q) } catch (e: Exception) { emptyList() } }
                if (!isActive) return@launch
                if (rects.isNotEmpty()) {
                    searchResults[p] = rects
                    rects.forEach { matches += p to it }
                    if (matchIdx < 0) { matchIdx = 0; showMatch() }
                    pageView(p)?.invalidate()
                }
            }
            searchCount.text = if (matches.isEmpty()) "0" else "${matchIdx + 1}/${matches.size}"
            if (matches.isEmpty()) toast("Nenhum resultado. Em PDFs digitalizados, use a ferramenta OCR para torná-los pesquisáveis.")
        }
    }

    private fun stepMatch(d: Int) {
        if (matches.isEmpty()) { startSearch(searchInput.text.toString()); return }
        matchIdx = (matchIdx + d + matches.size) % matches.size
        showMatch()
    }

    private fun showMatch() {
        val (p, r) = matches.getOrNull(matchIdx) ?: return
        searchCount.text = "${matchIdx + 1}/${matches.size}"
        val s = pageScale(p)
        lm.scrollToPositionWithOffset(p, (-(r.top * s) + zoomLayout.height / 3f).toInt() - rv.paddingTop)
        if (zoom > 1f) hscroll.post { hscroll.smoothScrollTo((r.left * s - zoomLayout.width / 3f).toInt().coerceAtLeast(0), 0) }
        currentPage = p; updatePageLabel()
        rv.post { visiblePageViews().forEach { it.invalidate() }; onPagesScrolled(); scheduleDetail() }
    }

    // ---------- sumário e marcadores
    private fun showOutline() {
        val f = workFile ?: return
        lifecycleScope.launch {
            val items = withContext(Dispatchers.IO) { PdfTools.outline(f) }
            if (items.isEmpty()) { toast("Este PDF não tem sumário"); return@launch }
            Dialogs.choose(this@PdfViewerActivity, "Sumário", items.map { "  ".repeat(it.level) + it.title + "  ·  " + (it.page + 1) }) { i ->
                goToPage(items[i].page)
            }
        }
    }

    private fun bookmarks(): MutableList<Int> =
        Prefs.getString("bm_$docKey").split(',').mapNotNull { it.toIntOrNull() }.toMutableList()

    private fun showBookmarks() {
        val bm = bookmarks().sorted()
        val labels = listOf("➕ Marcar a página ${currentPage + 1}") + bm.map { "Página ${it + 1}" }
        Dialogs.choose(this, "Marcadores", labels) { i ->
            if (i == 0) {
                val list = bookmarks(); if (!list.contains(currentPage)) list += currentPage
                Prefs.putString("bm_$docKey", list.joinToString(",")); toast("Página marcada")
            } else goToPage(bm[i - 1])
        }
    }

    // ---------- texto, OCR e voz
    private fun textDialogShow(title: String, text: String) {
        val tv = TextView(this).apply {
            setText(text.ifBlank { "(sem texto)" }); setTextIsSelectable(true); setPadding(dp(20), dp(12), dp(20), dp(12)); textSize = 15f
        }
        MaterialAlertDialogBuilder(this).setTitle(title).setView(ScrollView(this).apply { addView(tv) })
            .setPositiveButton("Copiar tudo") { _, _ ->
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("texto", text))
                toast("Texto copiado")
            }
            .setNeutralButton("Compartilhar") { _, _ ->
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Compartilhar"))
            }
            .setNegativeButton("Fechar", null).show()
    }

    private fun copyPageText() {
        val t = pdfText ?: return
        val p = currentPage
        lifecycleScope.launch {
            val s = withContext(textDispatcher) { t.page(p).text }
            if (s.isBlank()) {
                MaterialAlertDialogBuilder(this@PdfViewerActivity).setTitle("Página sem texto")
                    .setMessage("Esta página parece ser uma imagem (digitalizada). Quer reconhecer o texto com OCR?")
                    .setPositiveButton("Usar OCR") { _, _ -> ocrPage() }
                    .setNegativeButton("Cancelar", null).show()
            } else textDialogShow("Texto da página ${p + 1}", s.trim())
        }
    }

    private fun ocrPage() {
        val c = core ?: return
        val p = currentPage
        val pd = Dialogs.progress(this, "Reconhecendo texto da página ${p + 1}…")
        lifecycleScope.launch {
            try {
                val bmp = withContext(renderDispatcher) { c.renderForPrint(p, min(2400, (c.widths[p] * 2.8f).toInt())) } ?: return@launch
                val res = withContext(Dispatchers.Default) { OcrHelper.recognize(bmp) }
                bmp.recycle()
                pd.dismiss()
                textDialogShow("Texto reconhecido (OCR)", res.text)
            } catch (e: Exception) {
                pd.dismiss()
                Dialogs.message(this@PdfViewerActivity, "OCR indisponível", e.message ?: e.toString())
            }
        }
    }

    private fun toggleTts() {
        val t = tts
        if (t != null && ttsPage >= 0) { t.stop(); ttsPage = -1; toast("Leitura em voz alta parada"); return }
        if (t == null) {
            tts = TextToSpeech(this) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    tts?.language = Locale.getDefault()
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String?) {}
                        override fun onError(id: String?) {}
                        override fun onDone(id: String?) {
                            if (id?.endsWith("_last") == true) runOnUiThread { if (ttsPage >= 0) speakPage(ttsPage + 1) }
                        }
                    })
                    runOnUiThread { speakPage(currentPage) }
                } else runOnUiThread { toast("Leitura em voz alta indisponível neste aparelho") }
            }
        } else speakPage(currentPage)
    }

    private fun speakPage(p: Int) {
        val c = core ?: return
        val t = pdfText ?: return
        if (p >= c.pageCount) { ttsPage = -1; return }
        ttsPage = p
        goToPage(p)
        toast("Lendo a página ${p + 1}… (toque em \"Ler em voz alta\" para parar)")
        lifecycleScope.launch {
            val text = withContext(textDispatcher) { t.page(p).text }.replace(Regex("\\s+"), " ").trim()
            val engine = tts ?: return@launch
            if (text.isEmpty()) { speakPage(p + 1); return@launch }
            val chunks = text.chunked(3500)
            chunks.forEachIndexed { i, s ->
                val id = "p${p}_$i" + if (i == chunks.size - 1) "_last" else ""
                engine.speak(s, if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, id)
            }
        }
    }

    private fun showInfo() {
        val f = workFile ?: return
        lifecycleScope.launch {
            val info = withContext(Dispatchers.IO) { runCatching { PdfTools.info(f) }.getOrDefault(emptyList()) }
            val sb = StringBuilder()
            sb.append("Arquivo: $docName\n")
            sb.append("Páginas: ${core?.pageCount}\n")
            sb.append("Tamanho: ${FileUtil.human(f.length())}\n")
            core?.let { sb.append("Página 1: ${(it.widths[0] / 72 * 25.4).toInt()} × ${(it.heights[0] / 72 * 25.4).toInt()} mm\n") }
            if (password != null) sb.append("Protegido por senha: sim\n")
            info.forEach { (k, v) -> sb.append("$k: $v\n") }
            Dialogs.message(this@PdfViewerActivity, "Propriedades", sb.toString())
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    override fun onPause() {
        super.onPause()
        if (core != null) Prefs.setLastPage(docKey, currentPage)
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        tts?.shutdown()
        core?.close()
        pdfText?.close()
        renderDispatcher.close()
        textDispatcher.close()
    }

    // =====================================================================

    private inner class PageAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = core?.pageCount ?: 0
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val v = PageView(parent.context, this@PdfViewerActivity)
            v.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            return object : RecyclerView.ViewHolder(v) {}
        }

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            val v = holder.itemView as PageView
            v.bind(position)
            v.requestLayout()
            ensureBase(position)
        }

        override fun onViewRecycled(holder: RecyclerView.ViewHolder) {
            (holder.itemView as PageView).detail = null
        }
    }
}
