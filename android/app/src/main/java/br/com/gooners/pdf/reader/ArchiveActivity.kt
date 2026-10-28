package br.com.gooners.pdf.reader

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.FileRow
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipFile

/** Lista o conteúdo de arquivos ZIP e abre qualquer item suportado direto no app. */
class ArchiveActivity : AppCompatActivity() {
    private class Entry(val path: String, val size: Long)

    private var zipFile: File? = null
    private var entries: List<Entry> = emptyList()
    private val saver = SaveHelper(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val uri = intent.data ?: run { finish(); return }
        val name = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, uri)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = name
        toolbar.setNavigationOnClickListener { finish() }
        toolbar.menu.add("Extrair tudo").setOnMenuItemClickListener { extractAll(); true }
        val list = findViewById<RecyclerView>(R.id.list)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = object : RecyclerView.Adapter<FileRow>() {
            override fun getItemCount() = entries.size
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = FileRow(parent)
            override fun onBindViewHolder(h: FileRow, pos: Int) {
                val e = entries[pos]
                val n = e.path.substringAfterLast('/')
                h.bind(n, (e.path.substringBeforeLast('/', "").let { if (it.isEmpty()) "" else "$it · " }) + FileUtil.human(e.size), DocKind.fromName(n))
                h.itemView.setOnClickListener { openEntry(e) }
            }
        }
        val progress = findViewById<View>(R.id.progress)
        progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val f = withContext(Dispatchers.IO) { FileUtil.copyToCache(this@ArchiveActivity, uri, "work", name) }
                zipFile = f
                entries = withContext(Dispatchers.IO) {
                    ZipFile(f).use { z -> z.entries().toList().filter { !it.isDirectory }.map { Entry(it.name, it.size) }.sortedBy { it.path.lowercase() } }
                }
                toolbar.subtitle = "${entries.size} arquivos"
                list.adapter?.notifyDataSetChanged()
                if (entries.isEmpty()) findViewById<TextView>(R.id.empty).apply { visibility = View.VISIBLE; text = "Arquivo ZIP vazio" }
            } catch (e: Exception) {
                Dialogs.message(this@ArchiveActivity, "Não foi possível abrir", e.message ?: e.toString())
            } finally {
                progress.visibility = View.GONE
            }
        }
    }

    private fun safeTarget(dir: File, path: String): File {
        val out = File(dir, path)
        // evita "zip slip" (caminhos com ../ saindo da pasta)
        if (!out.canonicalPath.startsWith(dir.canonicalPath)) throw SecurityException("Caminho inválido no ZIP")
        return out
    }

    private suspend fun extract(e: Entry): File = withContext(Dispatchers.IO) {
        val dir = FileUtil.dir(this@ArchiveActivity, "zip/${zipFile!!.name.hashCode()}")
        val out = safeTarget(dir, e.path)
        out.parentFile?.mkdirs()
        if (!out.exists() || out.length() != e.size) ZipFile(zipFile!!).use { z ->
            z.getInputStream(z.getEntry(e.path)).use { input -> out.outputStream().use { input.copyTo(it) } }
        }
        out
    }

    private fun openEntry(e: Entry) {
        lifecycleScope.launch {
            try { Router.openFile(this@ArchiveActivity, extract(e)) } catch (ex: Exception) {
                Dialogs.message(this@ArchiveActivity, "Erro", ex.message ?: ex.toString())
            }
        }
    }

    private fun extractAll() {
        val pd = Dialogs.progress(this, "Extraindo…")
        lifecycleScope.launch {
            try {
                val files = entries.map { extract(it) }
                pd.dismiss()
                saver.saveAll(files)
            } catch (ex: Exception) {
                pd.dismiss(); Dialogs.message(this@ArchiveActivity, "Erro", ex.message ?: ex.toString())
            }
        }
    }
}
