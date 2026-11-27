package br.com.gooners.pdf.create

import android.content.res.Configuration
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.HtmlPdfWriter
import br.com.gooners.pdf.convert.TextDecode
import br.com.gooners.pdf.tools.PdfTools
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Prefs
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Editor de texto puro e código-fonte: localizar/substituir, desfazer/refazer, realce de sintaxe e salvar no original. */
class CodeEditorActivity : AppCompatActivity() {
    companion object {
        const val MAX_BYTES = 6L * 1024 * 1024
        const val EXTRA_NEW = "new"
    }

    private lateinit var code: EditText
    private lateinit var status: TextView
    private lateinit var toolbar: MaterialToolbar
    private var uri: Uri? = null
    private var name = "texto.txt"
    private var lang = Highlighter.Lang.NONE
    private var dirty = false
    private var applying = false
    private val undo = ArrayDeque<Edit>()
    private val redo = ArrayDeque<Edit>()
    private val handler = Handler(Looper.getMainLooper())
    private val rehighlight = Runnable { highlight() }
    private val statusRunnable = Runnable { updateStatus() }
    private val saver = SaveHelper(this)
    private var crlf = false

    private class Edit(val start: Int, val before: CharSequence, val after: CharSequence)

    private val saveAs = registerForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { u ->
        if (u != null) { Router.persist(this, u); uri = u; name = FileUtil.displayName(this, u); toolbar.title = name; save() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_code_editor)
        toolbar = findViewById(R.id.toolbar)
        code = findViewById(R.id.code)
        status = findViewById(R.id.status)
        uri = intent.data
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: uri?.let { FileUtil.displayName(this, it) } ?: "novo.txt"
        lang = Highlighter.lang(name)
        toolbar.title = name
        toolbar.setNavigationOnClickListener { onBackPressedDispatcher.onBackPressed() }
        toolbar.inflateMenu(R.menu.code_editor)
        val wrap = Prefs.getBoolean("code_wrap", lang == Highlighter.Lang.NONE)
        val mono = Prefs.getBoolean("code_mono", lang != Highlighter.Lang.NONE)
        toolbar.menu.findItem(R.id.m_wrap).isChecked = wrap
        toolbar.menu.findItem(R.id.m_mono).isChecked = mono
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }
        applyWrap(wrap)
        code.typeface = if (mono) Typeface.MONOSPACE else Typeface.DEFAULT
        code.textSize = Prefs.getLong("code_size", 14).toFloat()
        code.addTextChangedListener(object : TextWatcher {
            private var before: CharSequence = ""
            private var start = 0
            override fun beforeTextChanged(s: CharSequence, st: Int, count: Int, after: Int) { if (!applying) { start = st; before = s.subSequence(st, st + count).toString() } }
            override fun onTextChanged(s: CharSequence, st: Int, b: Int, count: Int) {
                if (applying) return
                undo.addLast(Edit(start, before, s.subSequence(st, st + count).toString()))
                if (undo.size > 1000) undo.removeFirst()
                redo.clear()
                if (!dirty) { dirty = true; toolbar.subtitle = "alterado" }
            }
            override fun afterTextChanged(s: Editable) {
                handler.removeCallbacks(statusRunnable)
                handler.postDelayed(statusRunnable, 400)
                handler.removeCallbacks(rehighlight)
                if (s.length < 300_000) handler.postDelayed(rehighlight, 600)
            }
        })
        code.setOnClickListener { updateStatus() }
        code.setOnKeyListener { _, _, _ -> handler.removeCallbacks(statusRunnable); handler.postDelayed(statusRunnable, 300); false }
        setupFind()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!dirty) { finish(); return }
                MaterialAlertDialogBuilder(this@CodeEditorActivity).setTitle("Salvar alterações?")
                    .setPositiveButton("Salvar") { _, _ -> save(); finish() }
                    .setNegativeButton("Descartar") { _, _ -> finish() }
                    .setNeutralButton("Cancelar", null).show()
            }
        })
        load()
    }

    private fun applyWrap(wrap: Boolean) {
        code.setHorizontallyScrolling(!wrap)
        code.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        code.isSingleLine = false
        code.setHorizontallyScrolling(!wrap)
    }

    private fun load() {
        val u = uri
        if (u == null || intent.getBooleanExtra(EXTRA_NEW, false)) { code.requestFocus(); updateStatus(); return }
        lifecycleScope.launch {
            val text = withContext(Dispatchers.IO) {
                try {
                    if (FileUtil.size(this@CodeEditorActivity, u) > MAX_BYTES) null
                    else FileUtil.open(this@CodeEditorActivity, u).use { TextDecode.decode(it.readBytes()) }
                } catch (e: Exception) { null }
            }
            if (text == null) {
                Dialogs.message(this@CodeEditorActivity, "Não foi possível editar", "O arquivo é grande demais para o editor (limite de 6 MB) ou não pôde ser lido. Use o leitor de texto para visualizá-lo.")
                return@launch
            }
            crlf = text.contains("\r\n")
            applying = true
            code.setText(text.replace("\r\n", "\n"))
            applying = false
            dirty = false
            toolbar.subtitle = null
            highlight()
            updateStatus()
        }
    }

    private fun highlight() {
        if (lang == Highlighter.Lang.NONE || code.length() > 300_000) return
        val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        applying = true
        try { Highlighter.apply(code.text, lang, if (night) Highlighter.dark else Highlighter.light) } finally { applying = false }
    }

    private fun updateStatus() {
        val t = code.text
        val pos = code.selectionStart.coerceAtLeast(0)
        var line = 1; var col = 1
        for (i in 0 until minOf(pos, t.length)) { if (t[i] == '\n') { line++; col = 1 } else col++ }
        val lines = t.count { it == '\n' } + 1
        status.text = "Ln $line, Col $col · $lines linhas · ${t.length} caracteres · UTF-8" + if (crlf) " · CRLF" else ""
    }

    private fun undoOnce() {
        val e = undo.removeLastOrNull() ?: run { toast("Nada para desfazer"); return }
        applying = true
        code.text.replace(e.start, (e.start + e.after.length).coerceAtMost(code.length()), e.before)
        applying = false
        redo.addLast(e)
        code.setSelection((e.start + e.before.length).coerceAtMost(code.length()))
        dirty = true
    }

    private fun redoOnce() {
        val e = redo.removeLastOrNull() ?: run { toast("Nada para refazer"); return }
        applying = true
        code.text.replace(e.start, (e.start + e.before.length).coerceAtMost(code.length()), e.after)
        applying = false
        undo.addLast(e)
        code.setSelection((e.start + e.after.length).coerceAtMost(code.length()))
        dirty = true
    }

    // ------------------------------------------------------------------ localizar e substituir
    private fun setupFind() {
        val find = findViewById<EditText>(R.id.findInput)
        val repl = findViewById<EditText>(R.id.replaceInput)
        val caseBox = findViewById<CheckBox>(R.id.matchCase)
        val count = findViewById<TextView>(R.id.findCount)
        fun matches(): List<Int> {
            val q = find.text.toString()
            if (q.isEmpty()) return emptyList()
            val t = code.text.toString()
            val out = ArrayList<Int>()
            var i = t.indexOf(q, 0, !caseBox.isChecked)
            while (i >= 0 && out.size < 100_000) { out += i; i = t.indexOf(q, i + maxOf(1, q.length), !caseBox.isChecked) }
            return out
        }
        fun go(forward: Boolean) {
            val q = find.text.toString()
            val all = matches()
            if (all.isEmpty()) { count.text = "0"; return }
            val cur = code.selectionStart
            val idx = if (forward) all.indexOfFirst { it > cur }.let { if (it < 0) 0 else it }
            else all.indexOfLast { it < cur }.let { if (it < 0) all.size - 1 else it }
            code.requestFocus()
            code.setSelection(all[idx], all[idx] + q.length)
            count.text = "${idx + 1}/${all.size}"
        }
        find.setOnEditorActionListener { _, _, _ -> go(true); true }
        findViewById<View>(R.id.findNext).setOnClickListener { go(true) }
        findViewById<View>(R.id.findPrev).setOnClickListener { go(false) }
        findViewById<View>(R.id.findClose).setOnClickListener { findViewById<View>(R.id.findBar).visibility = View.GONE }
        findViewById<View>(R.id.replaceOne).setOnClickListener {
            val q = find.text.toString()
            val s = code.selectionStart; val e = code.selectionEnd
            if (q.isNotEmpty() && e - s == q.length && code.text.substring(s, e).equals(q, !caseBox.isChecked)) code.text.replace(s, e, repl.text)
            go(true)
        }
        findViewById<View>(R.id.replaceAll).setOnClickListener {
            val q = find.text.toString()
            if (q.isEmpty()) return@setOnClickListener
            val all = matches()
            for (i in all.reversed()) code.text.replace(i, i + q.length, repl.text)
            count.text = "0"
            toast("${all.size} substituições")
        }
    }

    private fun save() {
        val u = uri
        if (u == null || u.scheme == "file" && !(u.path?.let { java.io.File(it).canWrite() } ?: false)) { saveAs.launch(name); return }
        val text = code.text.toString().let { if (crlf) it.replace("\n", "\r\n") else it }
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching { (contentResolver.openOutputStream(u, "wt") ?: throw IllegalStateException()).use { it.write(text.toByteArray(Charsets.UTF_8)) } }.isSuccess
            }
            if (ok) { dirty = false; toolbar.subtitle = "salvo"; toast("Arquivo salvo") }
            else { toast("Sem permissão para alterar este arquivo — escolha onde salvar"); saveAs.launch(name) }
        }
    }

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_save -> save()
            R.id.m_undo -> undoOnce()
            R.id.m_redo -> redoOnce()
            R.id.m_find -> { findViewById<View>(R.id.findBar).visibility = View.VISIBLE; findViewById<View>(R.id.findInput).requestFocus() }
            R.id.m_goto -> Dialogs.input(this, "Ir para a linha", type = InputType.TYPE_CLASS_NUMBER) { s ->
                val n = s.toIntOrNull() ?: return@input
                val t = code.text
                var line = 1; var pos = 0
                while (line < n && pos < t.length) { if (t[pos] == '\n') line++; pos++ }
                code.requestFocus(); code.setSelection(pos.coerceAtMost(t.length))
            }
            R.id.m_wrap -> { val v = !Prefs.getBoolean("code_wrap", lang == Highlighter.Lang.NONE); Prefs.putBoolean("code_wrap", v); toolbar.menu.findItem(R.id.m_wrap).isChecked = v; applyWrap(v) }
            R.id.m_mono -> { val v = !Prefs.getBoolean("code_mono", lang != Highlighter.Lang.NONE); Prefs.putBoolean("code_mono", v); toolbar.menu.findItem(R.id.m_mono).isChecked = v; code.typeface = if (v) Typeface.MONOSPACE else Typeface.DEFAULT }
            R.id.m_size -> {
                val sizes = listOf(11L, 12L, 14L, 16L, 18L, 22L)
                Dialogs.single(this, "Tamanho da fonte", sizes.map { "$it sp" }, sizes.indexOf(Prefs.getLong("code_size", 14)).coerceAtLeast(2)) {
                    Prefs.putLong("code_size", sizes[it]); code.textSize = sizes[it].toFloat()
                }
            }
            R.id.m_saveas -> saveAs.launch(name)
            R.id.m_pdf -> lifecycleScope.launch {
                val out = FileUtil.newOutFile(this@CodeEditorActivity, FileUtil.baseName(name) + ".pdf")
                withContext(Dispatchers.IO) {
                    val ps = PdfTools.pageSizes[0]
                    HtmlPdfWriter.write(HtmlPdfWriter.plain(code.text.toString(), lang != Highlighter.Lang.NONE), out, HtmlPdfWriter.Page(ps.w.toInt(), ps.h.toInt(), 48), 10f, name)
                }
                saver.showResult(listOf(out), "PDF gerado.")
            }
            R.id.m_share -> lifecycleScope.launch {
                val f = withContext(Dispatchers.IO) { FileUtil.newOutFile(this@CodeEditorActivity, name).also { it.writeText(code.text.toString()) } }
                FileUtil.share(this@CodeEditorActivity, listOf(f))
            }
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
