package br.com.gooners.pdf.ui

import android.Manifest
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.text.format.DateUtils
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SearchView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Lista todos os documentos do aparelho (opcional: pede permissão de acesso aos arquivos). */
class DeviceFilesActivity : AppCompatActivity() {
    private class Doc(val uri: Uri, val name: String, val size: Long, val modified: Long, val kind: DocKind)

    private var all: List<Doc> = emptyList()
    private var shown: List<Doc> = emptyList()
    private var filter = 0
    private var query = ""

    private val filters = listOf("Todos", "PDF", "Word", "Excel", "PowerPoint", "eBooks", "Texto")
    private lateinit var list: RecyclerView
    private lateinit var empty: TextView
    private lateinit var action: MaterialButton

    private val askRead = registerForActivityResult(ActivityResultContracts.RequestPermission()) { load() }
    private val manageAll = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { load() }

    private val exts = listOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv", "epub", "fb2", "md", "cbz", "html", "htm")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = "Documentos do aparelho"
        toolbar.setNavigationOnClickListener { finish() }
        val search = SearchView(this).apply {
            queryHint = "Buscar pelo nome"
            setOnQueryTextListener(object : SearchView.OnQueryTextListener {
                override fun onQueryTextSubmit(q: String?) = true
                override fun onQueryTextChange(q: String?): Boolean { this@DeviceFilesActivity.query = q.orEmpty(); this@DeviceFilesActivity.apply(); return true }
            })
        }
        toolbar.menu.add("Buscar").setIcon(R.drawable.ic_search).setActionView(search)
            .setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS or android.view.MenuItem.SHOW_AS_ACTION_COLLAPSE_ACTION_VIEW)
        list = findViewById(R.id.list)
        empty = findViewById(R.id.empty)
        action = findViewById(R.id.action)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = object : RecyclerView.Adapter<FileRow>() {
            override fun getItemCount() = shown.size
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = FileRow(parent)
            override fun onBindViewHolder(h: FileRow, pos: Int) {
                val d = shown[pos]
                h.bind(d.name, "${d.kind.label} · ${FileUtil.human(d.size)} · ${DateUtils.getRelativeTimeSpanString(d.modified)}", d.kind)
                h.itemView.setOnClickListener { Router.open(this@DeviceFilesActivity, d.uri, d.name) }
            }
        }
        findViewById<View>(R.id.chipsScroll).visibility = View.VISIBLE
        val chips = findViewById<ChipGroup>(R.id.chips)
        filters.forEachIndexed { i, f ->
            chips.addView(Chip(this).apply { text = f; isCheckable = true; isChecked = i == 0; id = View.generateViewId(); setOnClickListener { filter = i; apply() } })
        }
        load()
    }

    private fun hasAccess(): Boolean = try {
        if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
    } catch (e: Exception) {
        false
    }

    private fun load() {
        if (!hasAccess()) {
            empty.visibility = View.VISIBLE
            empty.text = "Para listar todos os seus documentos, o app precisa de acesso aos arquivos do aparelho.\n\n" +
                "Você também pode usar \"Abrir\" na tela inicial, que não precisa de permissão."
            action.visibility = View.VISIBLE
            action.text = "Permitir acesso"
            action.setOnClickListener {
                if (Build.VERSION.SDK_INT >= 30) {
                    try {
                        manageAll.launch(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
                    } catch (e: Exception) {
                        manageAll.launch(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                    }
                } else askRead.launch(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
            return
        }
        action.visibility = View.GONE
        empty.visibility = View.GONE
        val progress = findViewById<View>(R.id.progress)
        progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            all = withContext(Dispatchers.IO) { runCatching { queryDocs() }.getOrDefault(emptyList()) }
            progress.visibility = View.GONE
            apply()
        }
    }

    private fun queryDocs(): List<Doc> {
        val base = MediaStore.Files.getContentUri("external")
        val proj = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.SIZE, MediaStore.Files.FileColumns.DATE_MODIFIED)
        val sel = exts.joinToString(" OR ") { "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?" }
        val args = exts.map { "%.$it" }.toTypedArray()
        val out = ArrayList<Doc>()
        contentResolver.query(base, proj, sel, args, "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC")?.use { c ->
            while (c.moveToNext() && out.size < 5000) {
                val name = c.getString(1) ?: continue
                val size = c.getLong(2)
                if (size <= 0) continue
                out += Doc(ContentUris.withAppendedId(base, c.getLong(0)), name, size, c.getLong(3) * 1000, DocKind.fromName(name))
            }
        }
        return out
    }

    private fun apply() {
        val q = query.lowercase()
        shown = all.filter { d ->
            (q.isEmpty() || d.name.lowercase().contains(q)) && when (filter) {
                1 -> d.kind == DocKind.PDF
                2 -> d.kind in setOf(DocKind.DOCX, DocKind.DOC, DocKind.ODT, DocKind.RTF)
                3 -> d.kind in setOf(DocKind.XLSX, DocKind.XLS, DocKind.ODS, DocKind.CSV)
                4 -> d.kind in setOf(DocKind.PPTX, DocKind.PPT, DocKind.ODP)
                5 -> d.kind in setOf(DocKind.EPUB, DocKind.FB2, DocKind.CBZ)
                6 -> d.kind in setOf(DocKind.TEXT, DocKind.MARKDOWN, DocKind.HTML)
                else -> true
            }
        }
        findViewById<MaterialToolbar>(R.id.toolbar).subtitle = "${shown.size} documentos"
        empty.visibility = if (shown.isEmpty() && hasAccess()) View.VISIBLE else empty.visibility
        if (shown.isEmpty() && hasAccess()) empty.text = "Nenhum documento encontrado."
        list.adapter?.notifyDataSetChanged()
    }
}
