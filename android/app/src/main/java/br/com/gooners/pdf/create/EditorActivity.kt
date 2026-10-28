package br.com.gooners.pdf.create

import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.Layout
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.style.AlignmentSpan
import android.text.style.BulletSpan
import android.text.style.CharacterStyle
import android.text.style.ImageSpan
import android.text.style.MetricAffectingSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.text.HtmlCompat
import androidx.lifecycle.lifecycleScope
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.DocumentConverter
import br.com.gooners.pdf.convert.DocxPara
import br.com.gooners.pdf.convert.DocxRun
import br.com.gooners.pdf.convert.DocxWriter
import br.com.gooners.pdf.convert.HtmlPdfWriter
import br.com.gooners.pdf.convert.X
import br.com.gooners.pdf.tools.PdfTools
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Título (H1/H2) desenhado maior e em negrito. */
class HeadingSpan(val level: Int) : MetricAffectingSpan() {
    private val factor get() = if (level == 1) 1.6f else 1.3f
    override fun updateMeasureState(p: TextPaint) = apply(p)
    override fun updateDrawState(p: TextPaint) = apply(p)
    private fun apply(p: TextPaint) { p.textSize *= factor; p.isFakeBoldText = true }
}

/** Editor de documentos: escreve com formatação básica e exporta para PDF, Word, HTML, Markdown e texto. */
class EditorActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_TEXT = "text"
        const val EXTRA_HTML = "html"
        const val EXTRA_TITLE = "title"
        const val EXTRA_SOURCE_NAME = "source_name"
    }

    private lateinit var body: EditText
    private lateinit var title: EditText
    private val saver = SaveHelper(this)
    private val draft by lazy { File(filesDir, "draft.html") }
    private val draftTitle by lazy { File(filesDir, "draft_title.txt") }
    private var useDraft = true

    private val pickDoc = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { importDoc(it) } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_editor)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.setNavigationOnClickListener { finish() }
        toolbar.inflateMenu(R.menu.editor)
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }
        body = findViewById(R.id.body)
        title = findViewById(R.id.docTitle)
        setupFormatBar()

        val text = intent.getStringExtra(EXTRA_TEXT)
        val html = intent.getStringExtra(EXTRA_HTML)
        when {
            text != null -> { body.setText(text); useDraft = false }
            html != null -> { body.setText(cleanSpans(HtmlCompat.fromHtml(HtmlPdfWriter.simplify(html), HtmlCompat.FROM_HTML_MODE_COMPACT))); useDraft = false }
            draft.exists() -> {
                body.setText(cleanSpans(HtmlCompat.fromHtml(draft.readText(), HtmlCompat.FROM_HTML_MODE_COMPACT)))
                title.setText(runCatching { draftTitle.readText() }.getOrDefault(""))
            }
        }
        intent.getStringExtra(EXTRA_TITLE)?.let { title.setText(it) }
        if (intent.data != null && text != null) toolbar.menu.findItem(R.id.m_save_orig).isVisible = true
        toolbar.title = if (useDraft) "Novo documento" else "Editar documento"
    }

    /** Remove imagens e normaliza títulos vindos de HTML. */
    private fun cleanSpans(s: Spanned): Spannable {
        val sb = SpannableStringBuilder(s)
        sb.getSpans(0, sb.length, ImageSpan::class.java).forEach { sp ->
            val a = sb.getSpanStart(sp); val b = sb.getSpanEnd(sp); sb.removeSpan(sp); if (a in 0 until b) sb.replace(a, b, "")
        }
        sb.getSpans(0, sb.length, RelativeSizeSpan::class.java).forEach { sp ->
            val a = sb.getSpanStart(sp); val b = sb.getSpanEnd(sp)
            if (sp.sizeChange >= 1.15f) { sb.removeSpan(sp); sb.setSpan(HeadingSpan(if (sp.sizeChange >= 1.4f) 1 else 2), a, b, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        }
        return sb
    }

    private fun setupFormatBar() {
        val bar = findViewById<LinearLayout>(R.id.formatBar)
        fun btn(icon: Int, desc: String, fn: () -> Unit) {
            bar.addView(ImageButton(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
                setImageResource(icon); contentDescription = desc
                setOnClickListener { fn() }
                setOnLongClickListener { Toast.makeText(context, desc, Toast.LENGTH_SHORT).show(); true }
            }, LinearLayout.LayoutParams(dp(46), dp(46)))
        }
        btn(R.drawable.ic_bold, "Negrito") { toggle { StyleSpan(Typeface.BOLD) } }
        btn(R.drawable.ic_italic, "Itálico") { toggle { StyleSpan(Typeface.ITALIC) } }
        btn(R.drawable.ic_underline, "Sublinhado") { toggle { UnderlineSpan() } }
        btn(R.drawable.ic_line, "Tachado") { toggle { StrikethroughSpan() } }
        btn(R.drawable.ic_text, "Título 1") { heading(1) }
        btn(R.drawable.ic_text, "Título 2") { heading(2) }
        btn(R.drawable.ic_bullets, "Lista") { paragraphToggle(BulletSpan::class.java) { BulletSpan(dp(10)) } }
        btn(R.drawable.ic_toc, "Alinhar") { align() }
        btn(R.drawable.ic_close, "Limpar formatação") { clearFormat() }
        btn(R.drawable.ic_undo, "Inserir data") {
            val d = java.text.DateFormat.getDateInstance(java.text.DateFormat.LONG, java.util.Locale("pt", "BR")).format(java.util.Date())
            body.text.insert(body.selectionStart.coerceAtLeast(0), d)
        }
    }

    private fun selection(): Pair<Int, Int>? {
        val s = body.selectionStart; val e = body.selectionEnd
        if (s < 0 || s == e) { Toast.makeText(this, "Selecione o texto primeiro", Toast.LENGTH_SHORT).show(); return null }
        return minOf(s, e) to maxOf(s, e)
    }

    private fun sameKind(a: Any, b: Any) = a.javaClass == b.javaClass && (a !is StyleSpan || a.style == (b as StyleSpan).style)

    private fun toggle(make: () -> CharacterStyle) {
        val (s, e) = selection() ?: return
        val t = body.text
        val probe = make()
        val existing = t.getSpans(s, e, CharacterStyle::class.java).filter { sameKind(it, probe) }
        val covered = existing.any { t.getSpanStart(it) <= s && t.getSpanEnd(it) >= e }
        if (covered) {
            // remove só no trecho selecionado, preservando o resto
            for (sp in existing) {
                val a = t.getSpanStart(sp); val b = t.getSpanEnd(sp)
                t.removeSpan(sp)
                if (a < s) t.setSpan(make(), a, s, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
                if (b > e) t.setSpan(make(), e, b, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
            }
        } else t.setSpan(probe, s, e, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
    }

    private fun paragraphRange(): Pair<Int, Int> {
        val t = body.text
        val s = body.selectionStart.coerceAtLeast(0); val e = body.selectionEnd.coerceAtLeast(s)
        val a = t.lastIndexOf('\n', (s - 1).coerceAtLeast(0)).let { if (it < 0 || s == 0) 0 else it + 1 }
        val b = t.indexOf('\n', e).let { if (it < 0) t.length else it }
        return a to b
    }

    private fun <T : Any> paragraphToggle(cls: Class<T>, make: () -> T) {
        val (a, b) = paragraphRange()
        val t = body.text
        val existing = t.getSpans(a, maxOf(a, b), cls)
        if (existing.isNotEmpty()) existing.forEach { t.removeSpan(it) }
        else t.setSpan(make(), a, maxOf(a, b), Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    }

    private fun heading(level: Int) {
        val (a, b) = paragraphRange()
        val t = body.text
        val existing = t.getSpans(a, b, HeadingSpan::class.java)
        val same = existing.any { it.level == level }
        existing.forEach { t.removeSpan(it) }
        if (!same && b > a) t.setSpan(HeadingSpan(level), a, b, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    }

    private fun align() {
        val (a, b) = paragraphRange()
        val t = body.text
        val existing = t.getSpans(a, b, AlignmentSpan::class.java)
        val cur = existing.firstOrNull()?.alignment ?: Layout.Alignment.ALIGN_NORMAL
        existing.forEach { t.removeSpan(it) }
        val next = when (cur) { Layout.Alignment.ALIGN_NORMAL -> Layout.Alignment.ALIGN_CENTER; Layout.Alignment.ALIGN_CENTER -> Layout.Alignment.ALIGN_OPPOSITE; else -> null }
        if (next != null && b > a) t.setSpan(AlignmentSpan.Standard(next), a, b, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        Toast.makeText(this, when (next) { Layout.Alignment.ALIGN_CENTER -> "Centralizado"; Layout.Alignment.ALIGN_OPPOSITE -> "À direita"; else -> "À esquerda" }, Toast.LENGTH_SHORT).show()
    }

    private fun clearFormat() {
        val (s, e) = selection() ?: return
        val t = body.text
        t.getSpans(s, e, Any::class.java).filter { it is CharacterStyle || it is HeadingSpan || it is BulletSpan || it is AlignmentSpan }.forEach { t.removeSpan(it) }
    }

    // ------------------------------------------------------------------ modelo para exportação
    private class Run(val text: String, val b: Boolean, val i: Boolean, val u: Boolean, val s: Boolean)
    private class Para(val runs: List<Run>, val heading: Int, val bullet: Boolean, val align: Layout.Alignment?)

    private fun model(t: Editable): List<Para> {
        val out = ArrayList<Para>()
        var start = 0
        val str = t.toString()
        while (start <= str.length) {
            val end = str.indexOf('\n', start).let { if (it < 0) str.length else it }
            val heading = t.getSpans(start, maxOf(start, end), HeadingSpan::class.java).firstOrNull()?.level ?: 0
            val bullet = t.getSpans(start, maxOf(start, end), BulletSpan::class.java).isNotEmpty()
            val align = t.getSpans(start, maxOf(start, end), AlignmentSpan::class.java).firstOrNull()?.alignment
            val cuts = sortedSetOf(start, end)
            t.getSpans(start, end, CharacterStyle::class.java).forEach { cuts += t.getSpanStart(it).coerceIn(start, end); cuts += t.getSpanEnd(it).coerceIn(start, end) }
            val runs = ArrayList<Run>()
            val list = cuts.toList()
            for (k in 0 until list.size - 1) {
                val a = list[k]; val b = list[k + 1]
                if (b <= a) continue
                val spans = t.getSpans(a, b, CharacterStyle::class.java).filter { t.getSpanStart(it) <= a && t.getSpanEnd(it) >= b }
                runs += Run(str.substring(a, b),
                    spans.any { it is StyleSpan && (it.style == Typeface.BOLD || it.style == Typeface.BOLD_ITALIC) },
                    spans.any { it is StyleSpan && (it.style == Typeface.ITALIC || it.style == Typeface.BOLD_ITALIC) },
                    spans.any { it is UnderlineSpan }, spans.any { it is StrikethroughSpan })
            }
            out += Para(runs, heading, bullet, align)
            start = end + 1
        }
        return out
    }

    private fun toHtml(paras: List<Para>, docTitle: String): String {
        val sb = StringBuilder()
        if (docTitle.isNotBlank()) sb.append("<h1>").append(X.esc(docTitle)).append("</h1>")
        var inList = false
        for (p in paras) {
            if (p.bullet && !inList) { sb.append("<ul>"); inList = true }
            if (!p.bullet && inList) { sb.append("</ul>"); inList = false }
            val style = when (p.align) { Layout.Alignment.ALIGN_CENTER -> " style=\"text-align:center\""; Layout.Alignment.ALIGN_OPPOSITE -> " style=\"text-align:right\""; else -> "" }
            val tag = when { p.bullet -> "li"; p.heading == 1 -> "h2"; p.heading == 2 -> "h3"; else -> "p" }
            sb.append("<$tag$style>")
            if (p.runs.isEmpty()) sb.append("&nbsp;")
            for (r in p.runs) {
                var s = X.esc(r.text)
                if (r.b) s = "<b>$s</b>"; if (r.i) s = "<i>$s</i>"; if (r.u) s = "<u>$s</u>"; if (r.s) s = "<s>$s</s>"
                sb.append(s)
            }
            sb.append("</$tag>")
        }
        if (inList) sb.append("</ul>")
        return DocumentConverter.wrap(sb.toString(), docTitle, false)
    }

    private fun toMarkdown(paras: List<Para>, docTitle: String): String {
        val sb = StringBuilder()
        if (docTitle.isNotBlank()) sb.append("# ").append(docTitle).append("\n\n")
        for (p in paras) {
            val line = p.runs.joinToString("") { r ->
                var s = r.text
                if (s.isBlank()) return@joinToString s
                if (r.s) s = "~~$s~~"; if (r.i) s = "*$s*"; if (r.b) s = "**$s**"
                s
            }
            when {
                p.heading == 1 -> sb.append("## ").append(line)
                p.heading == 2 -> sb.append("### ").append(line)
                p.bullet -> sb.append("- ").append(line)
                else -> sb.append(line)
            }
            sb.append(if (p.bullet) "\n" else "\n\n")
        }
        return sb.toString().trimEnd() + "\n"
    }

    private fun toDocx(paras: List<Para>, docTitle: String, out: File) {
        val list = ArrayList<DocxPara>()
        if (docTitle.isNotBlank()) list += DocxPara(listOf(DocxRun(docTitle)), heading = 1)
        for (p in paras) list += DocxPara(
            p.runs.map { DocxRun(it.text, it.b, it.i, it.u) },
            heading = if (p.heading > 0) p.heading + 1 else 0,
            align = when (p.align) { Layout.Alignment.ALIGN_CENTER -> "center"; Layout.Alignment.ALIGN_OPPOSITE -> "right"; else -> null },
            bullet = p.bullet
        )
        DocxWriter.write(out, list, docTitle)
    }

    private fun docName() = FileUtil.sanitize(title.text.toString().ifBlank { "Documento" })

    private fun export(ext: String) {
        val t = SpannableStringBuilder(body.text)
        val docTitle = title.text.toString().trim()
        if (t.isBlank() && docTitle.isBlank()) { Toast.makeText(this, "O documento está vazio", Toast.LENGTH_SHORT).show(); return }
        if (ext == "pdf") {
            Dialogs.single(this, "Tamanho da página", PdfTools.pageSizes.map { it.label }, 0) { size -> doExport(ext, t, docTitle, size) }
        } else doExport(ext, t, docTitle, 0)
    }

    private fun doExport(ext: String, t: SpannableStringBuilder, docTitle: String, sizeIndex: Int) {
        val pd = Dialogs.progress(this, "Exportando…")
        lifecycleScope.launch {
            try {
                val out = FileUtil.newOutFile(this@EditorActivity, "${docName()}.$ext")
                withContext(Dispatchers.IO) {
                    val paras = model(t)
                    when (ext) {
                        "pdf" -> {
                            val ps = PdfTools.pageSizes[sizeIndex]
                            HtmlPdfWriter.write(t, out, HtmlPdfWriter.Page(ps.w.toInt(), ps.h.toInt(), 56), 11.5f, docTitle.ifBlank { null })
                        }
                        "docx" -> toDocx(paras, docTitle, out)
                        "html" -> out.writeText(toHtml(paras, docTitle))
                        "md" -> out.writeText(toMarkdown(paras, docTitle))
                        else -> out.writeText((if (docTitle.isNotBlank()) docTitle + "\n\n" else "") + t.toString())
                    }
                }
                pd.dismiss()
                saver.showResult(listOf(out), "Documento exportado.")
            } catch (e: Exception) {
                pd.dismiss(); Dialogs.message(this@EditorActivity, "Erro ao exportar", e.message ?: e.toString())
            }
        }
    }

    private fun importDoc(uri: Uri) {
        lifecycleScope.launch {
            try {
                val name = FileUtil.displayName(this@EditorActivity, uri)
                val kind = DocKind.detect(this@EditorActivity, uri, name)
                val spanned = withContext(Dispatchers.IO) {
                    val f = FileUtil.copyToCache(this@EditorActivity, uri, "work", name)
                    when (kind) {
                        DocKind.TEXT, DocKind.CODE, DocKind.UNKNOWN, DocKind.CSV -> SpannableStringBuilder(DocumentConverter.readText(f))
                        DocKind.PDF -> SpannableStringBuilder(FileUtil.tempFile(this@EditorActivity, "txt").also { PdfTools.toText(f, null, it) { _, _ -> } }.readText())
                        else -> DocumentConverter.load(this@EditorActivity, f, kind, name).use { d ->
                            cleanSpans(HtmlCompat.fromHtml(HtmlPdfWriter.simplify(d.epub?.combinedHtml("") ?: d.body), HtmlCompat.FROM_HTML_MODE_COMPACT))
                        }
                    }
                }
                body.setText(spanned)
                title.setText(FileUtil.baseName(name))
            } catch (e: Exception) {
                Dialogs.message(this@EditorActivity, "Não foi possível importar", e.message ?: e.toString())
            }
        }
    }

    private fun onMenu(id: Int) {
        when (id) {
            R.id.m_pdf -> export("pdf")
            R.id.m_docx -> export("docx")
            R.id.m_html -> export("html")
            R.id.m_md -> export("md")
            R.id.m_txt -> export("txt")
            R.id.m_save_orig -> intent.data?.let { uri ->
                lifecycleScope.launch {
                    val ok = withContext(Dispatchers.IO) {
                        runCatching {
                            (contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException()).use { it.write(body.text.toString().toByteArray()) }
                        }.isSuccess
                    }
                    Toast.makeText(this@EditorActivity, if (ok) "Arquivo salvo" else "Sem permissão para alterar o original — use Exportar", Toast.LENGTH_LONG).show()
                }
            }
            R.id.m_open -> pickDoc.launch(arrayOf("*/*"))
            R.id.m_new -> Dialogs.confirm(this, "Novo documento", "Descartar o texto atual?", "Descartar") {
                body.setText(""); title.setText(""); draft.delete()
            }
            R.id.m_stats -> {
                val s = body.text.toString()
                val words = s.split(Regex("\\s+")).count { it.isNotBlank() }
                Dialogs.message(this, "Contagem", "Palavras: $words\nCaracteres: ${s.length}\nCaracteres sem espaços: ${s.count { !it.isWhitespace() }}\nParágrafos: ${s.split('\n').count { it.isNotBlank() }}")
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (useDraft) {
            // rascunho automático
            runCatching {
                draft.writeText(toHtml(model(body.text), "").substringAfter("<body>").substringBefore("</body>"))
                draftTitle.writeText(title.text.toString())
            }
        }
    }
}
