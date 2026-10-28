package br.com.gooners.pdf.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.BuildConfig
import br.com.gooners.pdf.R
import br.com.gooners.pdf.tools.ToolActivity
import br.com.gooners.pdf.tools.ToolId
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Prefs
import br.com.gooners.pdf.util.RecentFile
import br.com.gooners.pdf.util.Recents
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup

class MainActivity : AppCompatActivity() {
    private lateinit var homeList: RecyclerView
    private lateinit var toolsList: RecyclerView
    private var recents: List<RecentFile> = emptyList()
    private var filter = 0
    private val filters = listOf("Todos", "Favoritos", "PDF", "Office", "eBooks", "Imagens", "Texto")
    private val homeAdapter = HomeAdapter()

    private val openDoc = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            Router.persist(this, uri)
            try { Router.open(this, uri) } catch (e: Exception) { Toast.makeText(this, "Não foi possível abrir: ${e.message}", Toast.LENGTH_LONG).show() }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.inflateMenu(R.menu.main)
        toolbar.menu.findItem(R.id.m_screen).isChecked = Prefs.keepScreenOn
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }

        homeList = findViewById(R.id.homeList)
        homeList.layoutManager = LinearLayoutManager(this)
        homeList.adapter = homeAdapter

        toolsList = findViewById(R.id.toolsList)
        val span = (resources.displayMetrics.widthPixels / dp(170)).coerceIn(2, 6)
        val toolsAdapter = ToolsAdapter()
        toolsList.layoutManager = GridLayoutManager(this, span).apply {
            spanSizeLookup = object : GridLayoutManager.SpanSizeLookup() {
                override fun getSpanSize(position: Int) = if (toolsAdapter.isHeader(position)) span else 1
            }
        }
        toolsList.adapter = toolsAdapter

        findViewById<BottomNavigationView>(R.id.nav).setOnItemSelectedListener {
            homeList.visibility = if (it.itemId == R.id.nav_home) View.VISIBLE else View.GONE
            toolsList.visibility = if (it.itemId == R.id.nav_tools) View.VISIBLE else View.GONE
            true
        }
    }

    override fun onResume() {
        super.onResume()
        recents = Recents.list(this)
        homeAdapter.notifyDataSetChanged()
    }

    private fun filtered(): List<RecentFile> = recents.filter {
        when (filter) {
            1 -> it.favorite
            2 -> it.kind == DocKind.PDF
            3 -> it.kind.isOffice || it.kind == DocKind.CSV
            4 -> it.kind == DocKind.EPUB || it.kind == DocKind.FB2 || it.kind == DocKind.CBZ
            5 -> it.kind == DocKind.IMAGE || it.kind == DocKind.SVG
            6 -> it.kind in setOf(DocKind.TEXT, DocKind.CODE, DocKind.MARKDOWN, DocKind.HTML)
            else -> true
        }
    }

    private fun openRecent(r: RecentFile) {
        val uri = Uri.parse(r.uri)
        try {
            contentResolver.openInputStream(uri)?.close()
            Router.open(this, uri, r.name)
        } catch (e: Exception) {
            Dialogs.confirm(this, "Arquivo indisponível", "\"${r.name}\" foi movido, apagado ou o acesso expirou. Remover da lista?", "Remover") {
                Recents.remove(this, r.uri); onResume()
            }
        }
    }

    private fun recentMenu(r: RecentFile) {
        val items = listOf(if (r.favorite) "Remover dos favoritos" else "Adicionar aos favoritos", "Compartilhar", "Abrir com outro app", "Remover da lista")
        Dialogs.choose(this, r.name, items) { i ->
            when (i) {
                0 -> Recents.toggleFavorite(this, r.uri)
                1 -> startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(FileUtil.mimeOf(r.name))
                    .putExtra(Intent.EXTRA_STREAM, Uri.parse(r.uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Compartilhar"))
                2 -> FileUtil.openWithOtherApp(this, Uri.parse(r.uri), FileUtil.mimeOf(r.name))
                3 -> Recents.remove(this, r.uri)
            }
            onResume()
        }
    }

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_open -> openDoc.launch(arrayOf("*/*"))
            R.id.m_theme -> {
                val modes = listOf(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM, AppCompatDelegate.MODE_NIGHT_NO, AppCompatDelegate.MODE_NIGHT_YES)
                Dialogs.single(this, "Tema do app", listOf("Seguir o sistema", "Claro", "Escuro"), modes.indexOf(Prefs.themeMode).coerceAtLeast(0)) {
                    Prefs.themeMode = modes[it]; AppCompatDelegate.setDefaultNightMode(modes[it])
                }
            }
            R.id.m_screen -> {
                Prefs.keepScreenOn = !Prefs.keepScreenOn
                findViewById<MaterialToolbar>(R.id.toolbar).menu.findItem(R.id.m_screen).isChecked = Prefs.keepScreenOn
            }
            R.id.m_clear -> Dialogs.confirm(this, "Limpar recentes", "Os favoritos são mantidos.", "Limpar") { Recents.clear(this); onResume() }
            R.id.m_formats -> Dialogs.message(this, "Formatos suportados", """
                Leitura e edição completa
                • PDF (inclusive protegido por senha e com formulários)

                Leitura
                • Word: DOCX, DOC (texto) · OpenDocument: ODT, ODS, ODP
                • Excel: XLSX, XLS (texto), CSV, TSV · PowerPoint: PPTX, PPT (texto)
                • eBooks: EPUB, FB2 · Quadrinhos: CBZ
                • RTF, Markdown, HTML, SVG, TXT, LOG, JSON, XML e código-fonte
                • Imagens: JPG, PNG, WebP, GIF (animado), BMP, HEIC/AVIF*
                • ZIP (abre os arquivos de dentro)

                Criação e conversão
                • Novo documento → PDF, DOCX, HTML, Markdown, TXT
                • Qualquer formato acima → PDF · PDF → Word, imagens, texto e HTML
                • Imagens e digitalização → PDF · OCR

                * conforme o suporte da versão do Android
            """.trimIndent())
            R.id.m_about -> Dialogs.message(this, "Gooners PDF ${BuildConfig.VERSION_NAME}",
                "Leitor, editor e conversor de documentos leve, sem anúncios e que funciona offline.\n\n" +
                    "Os arquivos são processados no próprio aparelho. O OCR e o digitalizador usam o Google Play Services quando disponível.\n\n" +
                    "Componentes de código aberto: PdfBox-Android (Apache 2.0), AndroidX e Material Components (Apache 2.0).")
        }
    }

    private fun launchTool(t: ToolId) = ToolActivity.start(this, t)

    // ------------------------------------------------------------------ início
    private inner class HomeAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = 1 + maxOf(1, filtered().size)
        override fun getItemViewType(position: Int) = when {
            position == 0 -> 0
            filtered().isEmpty() -> 2
            else -> 1
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder = when (viewType) {
            0 -> object : RecyclerView.ViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_home_header, parent, false)) {}.also { setupHeader(it.itemView) }
            1 -> FileRow(parent)
            else -> object : RecyclerView.ViewHolder(TextView(parent.context).apply {
                layoutParams = RecyclerView.LayoutParams(-1, -2)
                setPadding(dp(32), dp(40), dp(32), dp(40))
                textAlignment = View.TEXT_ALIGNMENT_CENTER
                setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
            }) {}
        }

        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            when (h) {
                is FileRow -> {
                    val r = filtered()[pos - 1]
                    val sub = listOf(r.kind.label, FileUtil.human(r.size), DateUtils.getRelativeTimeSpanString(r.time).toString()).filter { it.isNotEmpty() }.joinToString(" · ")
                    h.bind(r.name, sub, r.kind, r.favorite)
                    h.itemView.setOnClickListener { openRecent(r) }
                    h.itemView.setOnLongClickListener { recentMenu(r); true }
                }
                else -> if (pos > 0) (h.itemView as TextView).text = if (filter == 1) "Nenhum favorito ainda.\nToque e segure um arquivo para favoritar." else
                    "Nenhum arquivo recente.\nToque em \"Abrir\" para ler PDF, Word, Excel, PowerPoint, eBooks, imagens e muito mais."
            }
        }

        private fun setupHeader(v: View) {
            v.findViewById<View>(R.id.qOpen).setOnClickListener { openDoc.launch(arrayOf("*/*")) }
            v.findViewById<View>(R.id.qScan).setOnClickListener { launchTool(ToolId.SCAN) }
            v.findViewById<View>(R.id.qCreate).setOnClickListener {
                Dialogs.choose(this@MainActivity, "Criar", listOf("Novo documento de texto", "PDF em branco (para escrever e desenhar)", "PDF a partir de imagens", "Digitalizar documento")) {
                    launchTool(listOf(ToolId.NEW_DOC, ToolId.BLANK_PDF, ToolId.IMAGES_TO_PDF, ToolId.SCAN)[it])
                }
            }
            v.findViewById<View>(R.id.qImages).setOnClickListener { launchTool(ToolId.IMAGES_TO_PDF) }
            v.findViewById<View>(R.id.deviceCard).setOnClickListener { startActivity(Intent(this@MainActivity, DeviceFilesActivity::class.java)) }
            val group = v.findViewById<ChipGroup>(R.id.filters)
            filters.forEachIndexed { i, f ->
                group.addView(Chip(this@MainActivity).apply {
                    text = f; isCheckable = true; isChecked = i == filter; id = View.generateViewId()
                    setOnClickListener { filter = i; notifyDataSetChanged() }
                })
            }
        }
    }

    // ------------------------------------------------------------------ ferramentas
    private inner class ToolsAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        private val rows: List<Any> = ToolId.values().groupBy { it.group }.flatMap { (g, list) -> listOf<Any>(g) + list }
        fun isHeader(p: Int) = rows[p] is String
        override fun getItemCount() = rows.size
        override fun getItemViewType(position: Int) = if (isHeader(position)) 0 else 1
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
            if (viewType == 0) object : RecyclerView.ViewHolder(TextView(parent.context).apply {
                layoutParams = RecyclerView.LayoutParams(-1, -2)
                setPadding(dp(8), dp(16), dp(8), dp(4))
                setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleMedium)
            }) {}
            else object : RecyclerView.ViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_tool, parent, false)) {}

        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            val r = rows[pos]
            if (r is String) { (h.itemView as TextView).text = r; return }
            val t = r as ToolId
            h.itemView.findViewById<ImageView>(R.id.icon).setImageResource(t.icon)
            h.itemView.findViewById<TextView>(R.id.title).text = t.title
            h.itemView.findViewById<TextView>(R.id.desc).text = t.desc
            h.itemView.setOnClickListener { launchTool(t) }
        }
    }
}
