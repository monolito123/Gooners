package br.com.gooners.pdf.reader

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.archive.ArchiveEntry
import br.com.gooners.pdf.archive.ArchiveReader
import br.com.gooners.pdf.archive.Archives
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.FileRow
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Navega por ZIP, 7z, RAR, TAR(.gz/.bz2/.xz), GZ, BZ2, XZ, DEB/AR, CPIO e ARJ; abre qualquer item no app. */
class ArchiveActivity : AppCompatActivity() {
    private var reader: ArchiveReader? = null
    private var entries: List<ArchiveEntry> = emptyList()
    private var folder = ""
    private var name = ""
    private lateinit var toolbar: MaterialToolbar
    private lateinit var list: RecyclerView

    /** Itens da pasta atual: subpastas primeiro, depois arquivos. */
    private var rows: List<Pair<String, ArchiveEntry?>> = emptyList()

    private val pickFolder = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> uri?.let { extractAllTo(it) } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val uri = intent.data ?: run { finish(); return }
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, uri)
        toolbar = findViewById(R.id.toolbar)
        toolbar.title = name
        toolbar.setNavigationOnClickListener { onBackPressedDispatcher.onBackPressed() }
        toolbar.menu.add("Extrair tudo").setOnMenuItemClickListener { pickFolder.launch(null); true }
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (folder.isNotEmpty()) { folder = folder.trimEnd('/').substringBeforeLast('/', "").let { if (it.isEmpty()) "" else "$it/" }; refresh() } else finish()
            }
        })
        list = findViewById(R.id.list)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = object : RecyclerView.Adapter<FileRow>() {
            override fun getItemCount() = rows.size
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = FileRow(parent)
            override fun onBindViewHolder(h: FileRow, pos: Int) {
                val (label, e) = rows[pos]
                if (e == null) {
                    h.bind("$label/", "Pasta", DocKind.ZIP)
                    h.icon.setImageResource(R.drawable.ic_folder)
                    h.itemView.setOnClickListener { folder = "$folder$label/"; refresh() }
                } else {
                    h.bind(label, if (e.size >= 0) FileUtil.human(e.size) else "", DocKind.fromName(label))
                    h.itemView.setOnClickListener { openEntry(e) }
                }
            }
        }
        val progress = findViewById<View>(R.id.progress)
        progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val r = withContext(Dispatchers.IO) {
                    val f = FileUtil.copyToCache(this@ArchiveActivity, uri, "work", name)
                    Archives.open(f, name)
                }
                reader = r
                entries = r.entries
                toolbar.subtitle = "${r.format} · ${entries.size} arquivos"
                // arquivo com um único item (ex.: relatorio.pdf.gz): abre direto
                if (entries.size == 1 && (r.format in setOf("GZIP", "BZIP2", "XZ", "Z", "LZMA"))) { openEntry(entries[0]); finish(); return@launch }
                refresh()
                if (entries.isEmpty()) findViewById<TextView>(R.id.empty).apply { visibility = View.VISIBLE; text = "Arquivo vazio" }
            } catch (e: Throwable) {
                Dialogs.message(this@ArchiveActivity, "Não foi possível abrir", e.message ?: e.toString())
            } finally {
                progress.visibility = View.GONE
            }
        }
    }

    private fun refresh() {
        val dirs = sortedSetOf<String>()
        val files = ArrayList<Pair<String, ArchiveEntry?>>()
        for (e in entries) {
            val p = e.path.replace('\\', '/').trimStart('/')
            if (!p.startsWith(folder)) continue
            val rest = p.removePrefix(folder)
            if (rest.contains('/')) dirs += rest.substringBefore('/') else if (rest.isNotEmpty()) files += rest to e
        }
        rows = dirs.map { it to null } + files.sortedBy { it.first.lowercase() }
        toolbar.title = if (folder.isEmpty()) name else folder.trimEnd('/').substringAfterLast('/')
        list.adapter?.notifyDataSetChanged()
    }

    private fun openEntry(e: ArchiveEntry) {
        val r = reader ?: return
        lifecycleScope.launch {
            try {
                val f = withContext(Dispatchers.IO) { r.extract(e, FileUtil.dir(this@ArchiveActivity, "zip/${name.hashCode()}")) }
                Router.openFile(this@ArchiveActivity, f)
            } catch (ex: Throwable) {
                Dialogs.message(this@ArchiveActivity, "Erro ao extrair", ex.message ?: ex.toString())
            }
        }
    }

    private fun extractAllTo(tree: android.net.Uri) {
        val r = reader ?: return
        val pd = Dialogs.progress(this, "Extraindo…")
        lifecycleScope.launch {
            try {
                val n = withContext(Dispatchers.IO) {
                    val root = DocumentFile.fromTreeUri(this@ArchiveActivity, tree) ?: return@withContext 0
                    var count = 0
                    val dirs = HashMap<String, DocumentFile>()
                    fun dirFor(path: String): DocumentFile {
                        if (path.isEmpty()) return root
                        dirs[path]?.let { return it }
                        val parent = dirFor(path.substringBeforeLast('/', ""))
                        val leaf = path.substringAfterLast('/')
                        val d = parent.findFile(leaf)?.takeIf { it.isDirectory } ?: parent.createDirectory(leaf) ?: parent
                        dirs[path] = d
                        return d
                    }
                    entries.forEachIndexed { i, e ->
                        runOnUiThread { pd.update("Extraindo ${i + 1} de ${entries.size}…", i / entries.size.toFloat()) }
                        val clean = e.path.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." && it != ".." }
                        if (clean.isEmpty()) return@forEachIndexed
                        val dir = dirFor(clean.dropLast(1).joinToString("/"))
                        val doc = dir.createFile(FileUtil.mimeOf(clean.last()), clean.last()) ?: return@forEachIndexed
                        contentResolver.openOutputStream(doc.uri)?.use { out -> r.open(e).use { it.copyTo(out, 64 * 1024) } }
                        count++
                    }
                    count
                }
                pd.dismiss()
                Dialogs.message(this@ArchiveActivity, "Pronto", "$n de ${entries.size} arquivos extraídos.")
            } catch (ex: Throwable) {
                pd.dismiss()
                Dialogs.message(this@ArchiveActivity, "Erro ao extrair", ex.message ?: ex.toString())
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { reader?.close() }
    }
}
