package br.com.gooners.pdf.reader

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.TextDecode
import br.com.gooners.pdf.create.EditorActivity
import br.com.gooners.pdf.tools.ToolActivity
import br.com.gooners.pdf.tools.ToolId
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Prefs
import com.google.android.material.appbar.MaterialToolbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Leitor de texto e código-fonte rápido mesmo com arquivos grandes (renderiza em blocos). */
class TextViewerActivity : AppCompatActivity() {
    private companion object {
        const val CHUNK = 120
        const val MAX_BYTES = 40L * 1024 * 1024
    }

    private lateinit var list: RecyclerView
    private lateinit var toolbar: MaterialToolbar
    private var lines: List<String> = emptyList()
    private var chunks = 0
    private var file: File? = null
    private var name = ""
    private var kind = DocKind.TEXT
    private var mono = false
    private var numbers = false
    private var sizeSp = 15f
    private var query = ""
    private var hits: List<Int> = emptyList() // linhas com ocorrência
    private var hitIdx = -1
    private val adapter = ChunkAdapter()
    private val lm by lazy { LinearLayoutManager(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_text)
        val uri = intent.data ?: run { finish(); return }
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: FileUtil.displayName(this, uri)
        kind = runCatching { DocKind.valueOf(intent.getStringExtra(Router.EXTRA_KIND) ?: "") }.getOrDefault(DocKind.TEXT)
        mono = kind == DocKind.CODE
        sizeSp = 15f * Prefs.textSize / 100f
        toolbar = findViewById(R.id.toolbar)
        toolbar.title = name
        toolbar.setNavigationOnClickListener { finish() }
        toolbar.inflateMenu(R.menu.text_viewer)
        toolbar.menu.findItem(R.id.m_mono).isChecked = mono
        toolbar.menu.findItem(R.id.m_json).isVisible = FileUtil.extension(name) == "json"
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }
        list = findViewById(R.id.list)
        list.layoutManager = lm
        list.adapter = adapter
        val findInput = findViewById<EditText>(R.id.findInput)
        findInput.setOnEditorActionListener { _, _, _ -> search(findInput.text.toString()); true }
        findViewById<View>(R.id.findNext).setOnClickListener { step(1) }
        findViewById<View>(R.id.findPrev).setOnClickListener { step(-1) }
        findViewById<View>(R.id.findClose).setOnClickListener {
            findViewById<View>(R.id.findBar).visibility = View.GONE; query = ""; hits = emptyList(); adapter.notifyDataSetChanged()
        }
        load(uri)
    }

    private fun load(uri: android.net.Uri) {
        val progress = findViewById<View>(R.id.progress)
        lifecycleScope.launch {
            try {
                val f = withContext(Dispatchers.IO) { FileUtil.copyToCache(this@TextViewerActivity, uri, "work", name) }
                file = f
                val result = withContext(Dispatchers.IO) {
                    val head = f.inputStream().use { s -> ByteArray(8192).let { b -> val n = s.read(b); if (n > 0) b.copyOf(n) else ByteArray(0) } }
                    val binary = head.count { it.toInt() == 0 } > head.size / 50 && !(head.size > 1 && (head[0] == 0xFF.toByte() || head[0] == 0xFE.toByte()))
                    if (binary) hexDump(f) to true
                    else {
                        val bytes = if (f.length() > MAX_BYTES) f.inputStream().use { s -> ByteArray(MAX_BYTES.toInt()).also { s.read(it) } } else f.readBytes()
                        TextDecode.decode(bytes).replace("\r\n", "\n").split('\n') to false
                    }
                }
                lines = result.first
                if (result.second) {
                    toolbar.subtitle = "Arquivo binário — exibindo bytes (hex)"
                    mono = true
                    Toast.makeText(this@TextViewerActivity, "Formato não reconhecido: mostrando o conteúdo bruto. Use \"Abrir com outro app\" se preferir.", Toast.LENGTH_LONG).show()
                } else {
                    toolbar.subtitle = "${lines.size} linhas · ${FileUtil.human(f.length())}" + if (f.length() > MAX_BYTES) " (exibindo os primeiros 40 MB)" else ""
                }
                chunks = (lines.size + CHUNK - 1) / CHUNK
                adapter.notifyDataSetChanged()
            } catch (e: Exception) {
                Dialogs.message(this@TextViewerActivity, "Não foi possível abrir", e.message ?: e.toString())
            } finally {
                progress.visibility = View.GONE
            }
        }
    }

    private fun hexDump(f: File): List<String> {
        val bytes = f.inputStream().use { s -> ByteArray(minOf(f.length(), 256 * 1024).toInt()).also { s.read(it) } }
        val out = ArrayList<String>()
        var i = 0
        while (i < bytes.size) {
            val sb = StringBuilder("%08X  ".format(i))
            val ascii = StringBuilder()
            for (j in 0 until 16) {
                if (i + j < bytes.size) {
                    val b = bytes[i + j].toInt() and 0xFF
                    sb.append("%02X ".format(b)); ascii.append(if (b in 32..126) b.toChar() else '.')
                } else sb.append("   ")
            }
            out += "$sb |$ascii|"
            i += 16
        }
        return out
    }

    private fun search(q: String) {
        query = q
        if (q.isEmpty()) return
        val ql = q.lowercase()
        lifecycleScope.launch {
            hits = withContext(Dispatchers.Default) { lines.indices.filter { lines[it].lowercase().contains(ql) } }
            hitIdx = -1
            adapter.notifyDataSetChanged()
            if (hits.isEmpty()) findViewById<TextView>(R.id.findCount).text = "0" else step(1)
        }
    }

    private fun step(d: Int) {
        if (hits.isEmpty()) return
        hitIdx = (hitIdx + d + hits.size) % hits.size
        val line = hits[hitIdx]
        findViewById<TextView>(R.id.findCount).text = "${hitIdx + 1}/${hits.size}"
        scrollToLine(line)
    }

    private fun scrollToLine(line: Int) {
        val chunk = line / CHUNK
        lm.scrollToPositionWithOffset(chunk, 0)
        list.post {
            val tv = lm.findViewByPosition(chunk) as? TextView ?: return@post
            val layout = tv.layout ?: return@post
            val text = tv.text.toString()
            var off = 0
            repeat(line - chunk * CHUNK) { off = text.indexOf('\n', off) + 1 }
            val y = layout.getLineTop(layout.getLineForOffset(off.coerceIn(0, text.length)))
            lm.scrollToPositionWithOffset(chunk, -y + dp(40))
        }
    }

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_find -> { findViewById<View>(R.id.findBar).visibility = View.VISIBLE; findViewById<View>(R.id.findInput).requestFocus() }
            R.id.m_size -> {
                val sizes = listOf(11f, 13f, 15f, 17f, 20f, 24f)
                Dialogs.single(this, "Tamanho da fonte", sizes.map { "${it.toInt()} sp" }, sizes.indexOfFirst { it >= sizeSp }.coerceAtLeast(0)) {
                    sizeSp = sizes[it]; Prefs.textSize = (sizeSp / 15f * 100).toInt(); adapter.notifyDataSetChanged()
                }
            }
            R.id.m_mono -> { mono = !mono; toolbar.menu.findItem(R.id.m_mono).isChecked = mono; adapter.notifyDataSetChanged() }
            R.id.m_numbers -> { numbers = !numbers; toolbar.menu.findItem(R.id.m_numbers).isChecked = numbers; adapter.notifyDataSetChanged() }
            R.id.m_json -> lifecycleScope.launch {
                val formatted = withContext(Dispatchers.Default) {
                    runCatching {
                        val t = lines.joinToString("\n").trim()
                        if (t.startsWith("[")) JSONArray(t).toString(2) else JSONObject(t).toString(2)
                    }.getOrNull()
                }
                if (formatted == null) Toast.makeText(this@TextViewerActivity, "JSON inválido", Toast.LENGTH_SHORT).show()
                else { lines = formatted.split('\n'); chunks = (lines.size + CHUNK - 1) / CHUNK; adapter.notifyDataSetChanged() }
            }
            R.id.m_goto -> Dialogs.input(this, "Ir para a linha", "1 – ${lines.size}", type = InputType.TYPE_CLASS_NUMBER) { s ->
                s.toIntOrNull()?.let { scrollToLine((it - 1).coerceIn(0, lines.size - 1)) }
            }
            R.id.m_edit -> {
                val text = lines.joinToString("\n")
                if (text.length > 1_000_000) Toast.makeText(this, "Arquivo grande demais para o editor", Toast.LENGTH_SHORT).show()
                else startActivity(Intent(this, EditorActivity::class.java).putExtra(EditorActivity.EXTRA_TEXT, text)
                    .putExtra(EditorActivity.EXTRA_TITLE, FileUtil.baseName(name)).putExtra(EditorActivity.EXTRA_SOURCE_NAME, name)
                    .setData(intent.data).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
            }
            R.id.m_to_pdf -> file?.let { ToolActivity.start(this, ToolId.DOC_TO_PDF, it, name, null) }
            R.id.m_share -> file?.let { FileUtil.share(this, listOf(it)) }
            R.id.m_other -> intent.data?.let { FileUtil.openWithOtherApp(this, it, FileUtil.mimeOf(name)) }
        }
    }

    private inner class ChunkAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = chunks
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val tv = TextView(parent.context).apply {
                layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                setPadding(dp(14), 0, dp(14), 0)
                setTextIsSelectable(true)
                setLineSpacing(0f, 1.15f)
            }
            return object : RecyclerView.ViewHolder(tv) {}
        }

        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            val tv = h.itemView as TextView
            tv.textSize = sizeSp
            tv.typeface = if (mono) Typeface.MONOSPACE else Typeface.DEFAULT
            val from = pos * CHUNK
            val to = minOf(lines.size, from + CHUNK)
            val sb = StringBuilder()
            val width = lines.size.toString().length
            for (i in from until to) {
                if (numbers) sb.append((i + 1).toString().padStart(width)).append("  ")
                sb.append(lines[i])
                if (i < to - 1) sb.append('\n')
            }
            val text = sb.toString()
            if (query.isEmpty() && !numbers) { tv.text = text; return }
            val sp = SpannableString(text)
            if (numbers) {
                var off = 0
                for (i in from until to) {
                    sp.setSpan(ForegroundColorSpan(0xFF9CA3AF.toInt()), off, off + width, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    off = text.indexOf('\n', off).let { if (it < 0) text.length else it + 1 }
                }
            }
            if (query.isNotEmpty()) {
                val lower = text.lowercase(); val q = query.lowercase()
                var idx = lower.indexOf(q)
                while (idx >= 0) {
                    sp.setSpan(BackgroundColorSpan(0x88FFC107.toInt()), idx, idx + q.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    idx = lower.indexOf(q, idx + q.length)
                }
            }
            tv.text = sp
        }
    }
}
