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
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.text.style.AbsoluteSizeSpan
import android.text.style.AlignmentSpan
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
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
import br.com.gooners.pdf.util.BitmapUtil
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
        /** com intent.data: abre esse documento para edição e salva de volta no mesmo formato */
        const val EXTRA_SOURCE_KIND = "source_kind"
    }

    private lateinit var body: EditText
    private lateinit var title: EditText
    private val saver = SaveHelper(this)
    private val draft by lazy { File(filesDir, "draft.html") }
    private val draftTitle by lazy { File(filesDir, "draft_title.txt") }
    private var useDraft = true
    private var sourceKind: DocKind? = null
    private var sourceName = ""
    private var dirty = false

    private val pickDoc = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { importDoc(it) } }
    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let { insertImage(it) } }
    private val saveCopy = registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri -> uri?.let { writeSource(it, sourceKind ?: DocKind.DOCX, true) } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_editor)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.setNavigationOnClickListener { onBackPressedDispatcher.onBackPressed() }
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
        sourceKind = intent.getStringExtra(EXTRA_SOURCE_KIND)?.let { runCatching { DocKind.valueOf(it) }.getOrNull() }
        if (intent.data != null && text != null) sourceKind = DocKind.TEXT
        sourceName = intent.getStringExtra(EXTRA_SOURCE_NAME) ?: intent.data?.let { FileUtil.displayName(this, it) } ?: ""
        toolbar.menu.findItem(R.id.m_save_orig).isVisible = sourceKind != null
        toolbar.title = if (sourceKind != null) sourceName else if (useDraft) "Novo documento" else "Editar documento"
        if (sourceKind != null && text == null) { useDraft = false; loadSource() }
        body.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) { dirty = true }
            override fun afterTextChanged(s: Editable?) {}
        })
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (sourceKind == null || !dirty) { finish(); return }
                com.google.android.material.dialog.MaterialAlertDialogBuilder(this@EditorActivity).setTitle("Salvar alterações?")
                    .setPositiveButton("Salvar") { _, _ -> saveSource() }
                    .setNegativeButton("Descartar") { _, _ -> finish() }
                    .setNeutralButton("Cancelar", null).show()
            }
        })
    }

    /** Remove imagens sem conteúdo e normaliza títulos vindos de HTML. */
    private fun cleanSpans(s: Spanned, keepImages: Boolean = false): Spannable {
        val sb = SpannableStringBuilder(s)
        sb.getSpans(0, sb.length, ImageSpan::class.java).forEach { sp ->
            if (keepImages && (sp.drawable as? BitmapDrawable)?.bitmap != null) return@forEach
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
        btn(R.drawable.ic_text_color, "Cor do texto") { colorSpan(false) }
        btn(R.drawable.ic_highlight, "Marca-texto") { colorSpan(true) }
        btn(R.drawable.ic_font, "Tamanho da fonte") { sizeSpan() }
        btn(R.drawable.ic_bullets, "Lista") { paragraphToggle(BulletSpan::class.java) { BulletSpan(dp(10)) } }
        btn(R.drawable.ic_toc, "Alinhar") { align() }
        btn(R.drawable.ic_image, "Inserir imagem") { pickImage.launch("image/*") }
        btn(R.drawable.ic_replace, "Localizar e substituir") { findReplace() }
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

    private fun colorSpan(background: Boolean) {
        val (s, e) = selection() ?: return
        Dialogs.color(this, if (background) 0xFFFDE047.toInt() else 0xFFDC2626.toInt()) { c ->
            val t = body.text
            if (background) t.getSpans(s, e, BackgroundColorSpan::class.java).forEach { t.removeSpan(it) } else t.getSpans(s, e, ForegroundColorSpan::class.java).forEach { t.removeSpan(it) }
            t.setSpan(if (background) BackgroundColorSpan(c) else ForegroundColorSpan(c), s, e, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
            dirty = true
        }
    }

    private fun sizeSpan() {
        val (s, e) = selection() ?: return
        val sizes = listOf(10, 12, 14, 16, 18, 20, 24, 28, 32, 40)
        Dialogs.choose(this, "Tamanho da fonte", sizes.map { "$it pt" }) { i ->
            val t = body.text
            t.getSpans(s, e, AbsoluteSizeSpan::class.java).forEach { t.removeSpan(it) }
            t.setSpan(AbsoluteSizeSpan(sizes[i], true), s, e, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
            dirty = true
        }
    }

    private fun imageSpan(bmp: Bitmap): ImageSpan {
        val maxW = (resources.displayMetrics.widthPixels - dp(48)).coerceAtLeast(200)
        val d = BitmapDrawable(resources, bmp)
        val w = minOf(maxW, bmp.width)
        d.setBounds(0, 0, w, (bmp.height.toLong() * w / bmp.width).toInt().coerceAtLeast(1))
        return ImageSpan(d)
    }

    private fun insertImage(uri: Uri) {
        lifecycleScope.launch {
            val bmp = withContext(Dispatchers.IO) { BitmapUtil.decode(this@EditorActivity, uri, 1400) } ?: run { toast("Imagem ilegível"); return@launch }
            val pos = body.selectionStart.coerceAtLeast(0)
            val sb = SpannableStringBuilder("\uFFFC")
            sb.setSpan(imageSpan(bmp), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            body.text.insert(pos, "\n")
            body.text.insert(pos + 1, sb)
            body.text.insert(pos + 2, "\n")
            dirty = true
        }
    }

    private fun findReplace() {
        val find = Dialogs.field(this, "Localizar")
        val repl = Dialogs.field(this, "Substituir por")
        val case = android.widget.CheckBox(this).apply { text = "Diferenciar maiúsculas" }
        com.google.android.material.dialog.MaterialAlertDialogBuilder(this).setTitle("Localizar e substituir")
            .setView(Dialogs.wrap(this, find, repl, case))
            .setPositiveButton("Substituir tudo") { _, _ ->
                val q = find.text.toString()
                if (q.isEmpty()) return@setPositiveButton
                val t = body.text
                var n = 0
                var i = t.toString().indexOf(q, 0, !case.isChecked)
                while (i >= 0) { t.replace(i, i + q.length, repl.text); n++; i = t.toString().indexOf(q, i + repl.text.length, !case.isChecked) }
                toast("$n substituições"); if (n > 0) dirty = true
            }
            .setNeutralButton("Localizar") { _, _ ->
                val q = find.text.toString()
                val i = body.text.toString().indexOf(q, body.selectionEnd.coerceAtLeast(0), !case.isChecked).let { if (it < 0) body.text.toString().indexOf(q, 0, !case.isChecked) else it }
                if (i >= 0) { body.requestFocus(); body.setSelection(i, i + q.length) } else toast("Não encontrado")
            }
            .setNegativeButton("Cancelar", null).show()
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    private fun clearFormat() {
        val (s, e) = selection() ?: return
        val t = body.text
        t.getSpans(s, e, Any::class.java).filter { (it is CharacterStyle && it !is ImageSpan) || it is HeadingSpan || it is BulletSpan || it is AlignmentSpan }.forEach { t.removeSpan(it) }
    }

    // ------------------------------------------------------------------ modelo para exportação
    private class Run(val text: String, val b: Boolean, val i: Boolean, val u: Boolean, val s: Boolean,
                      val color: Int? = null, val bg: Int? = null, val size: Int? = null, val image: Bitmap? = null)
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
                val img = spans.filterIsInstance<ImageSpan>().firstOrNull()?.drawable?.let { (it as? BitmapDrawable)?.bitmap }
                runs += Run(if (img != null) "" else str.substring(a, b),
                    spans.any { it is StyleSpan && (it.style == Typeface.BOLD || it.style == Typeface.BOLD_ITALIC) },
                    spans.any { it is StyleSpan && (it.style == Typeface.ITALIC || it.style == Typeface.BOLD_ITALIC) },
                    spans.any { it is UnderlineSpan }, spans.any { it is StrikethroughSpan },
                    spans.filterIsInstance<ForegroundColorSpan>().lastOrNull()?.foregroundColor,
                    spans.filterIsInstance<BackgroundColorSpan>().lastOrNull()?.backgroundColor,
                    spans.filterIsInstance<AbsoluteSizeSpan>().lastOrNull()?.size, img)
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
                if (r.image != null) {
                    val bo = java.io.ByteArrayOutputStream(); r.image.compress(Bitmap.CompressFormat.PNG, 100, bo)
                    sb.append("<img src=\"data:image/png;base64,").append(android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP)).append("\">")
                    continue
                }
                var s = X.esc(r.text)
                if (r.b) s = "<b>$s</b>"; if (r.i) s = "<i>$s</i>"; if (r.u) s = "<u>$s</u>"; if (r.s) s = "<s>$s</s>"
                val css = listOfNotNull(r.color?.let { "color:#%06X".format(it and 0xFFFFFF) }, r.bg?.let { "background:#%06X".format(it and 0xFFFFFF) }, r.size?.let { "font-size:${it}pt" })
                if (css.isNotEmpty()) s = "<span style=\"${css.joinToString(";")}\">$s</span>"
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
            p.runs.map { r ->
                if (r.image != null) {
                    val bo = java.io.ByteArrayOutputStream(); r.image.compress(Bitmap.CompressFormat.PNG, 100, bo)
                    DocxRun("", image = bo.toByteArray(), imageW = r.image.width, imageH = r.image.height)
                } else DocxRun(r.text, r.b, r.i, r.u, sizePt = r.size?.toFloat() ?: 0f, color = r.color?.let { "%06X".format(it and 0xFFFFFF) },
                    strike = r.s, shade = r.bg?.let { "%06X".format(it and 0xFFFFFF) })
            },
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
            R.id.m_save_orig -> saveSource()
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

    // ------------------------------------------------------------------ edição de arquivos existentes
    private fun loadSource() {
        val uri = intent.data ?: return
        val kind = sourceKind ?: return
        val pd = Dialogs.progress(this, "Abrindo para edição…")
        lifecycleScope.launch {
            try {
                val spanned = withContext(Dispatchers.IO) {
                    val f = FileUtil.copyToCache(this@EditorActivity, uri, "work", sourceName)
                    when (kind) {
                        DocKind.TEXT, DocKind.CODE, DocKind.CSV -> SpannableStringBuilder(DocumentConverter.readText(f))
                        else -> DocumentConverter.load(this@EditorActivity, f, kind, sourceName).use { d ->
                            val maxW = (resources.displayMetrics.widthPixels - dp(48)).coerceAtLeast(200)
                            val html = HtmlPdfWriter.simplify(d.epub?.combinedHtml(DocumentConverter.BASE) ?: d.body)
                            val getter = android.text.Html.ImageGetter { src ->
                                val bytes = if (src.startsWith("data:")) android.util.Base64.decode(src.substringAfter(","), android.util.Base64.DEFAULT) else d.resource(src)
                                val bmp = bytes?.let { b -> android.graphics.BitmapFactory.decodeByteArray(b, 0, b.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = 1 }) }
                                bmp?.let { BitmapDrawable(resources, it).apply { val w = minOf(maxW, it.width); setBounds(0, 0, w, (it.height.toLong() * w / it.width).toInt().coerceAtLeast(1)) } }
                            }
                            cleanSpans(HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT, getter, null), keepImages = true)
                        }
                    }
                }
                body.setText(spanned)
                dirty = false
                if (title.text.isEmpty()) title.setText("")
            } catch (e: Exception) {
                Dialogs.message(this@EditorActivity, "Não foi possível abrir para edição", e.message ?: e.toString())
            } finally { pd.dismiss() }
        }
    }

    /** Formatos que conseguimos regravar sem perder conteúdo; os demais viram uma cópia nova. */
    private fun saveSource() {
        val uri = intent.data ?: return
        val kind = sourceKind ?: return
        when (kind) {
            DocKind.TEXT, DocKind.CODE, DocKind.MARKDOWN, DocKind.HTML -> writeSource(uri, kind, false)
            DocKind.DOCX -> Dialogs.choose(this, "Salvar documento Word", listOf("Salvar como uma cópia nova (recomendado)", "Sobrescrever o original")) { i ->
                if (i == 0) saveCopy.launch(FileUtil.baseName(sourceName) + "_editado.docx")
                else Dialogs.confirm(this, "Sobrescrever o original", "Tabelas complexas, cabeçalhos, notas e estilos avançados do Word podem ser simplificados.", "Sobrescrever") { writeSource(uri, kind, false) }
            }
            else -> { toast("Este formato será salvo como Word (.docx)"); sourceKind = DocKind.DOCX; saveCopy.launch(FileUtil.baseName(sourceName) + ".docx") }
        }
    }

    private fun writeSource(target: Uri, kind: DocKind, copy: Boolean) {
        val t = SpannableStringBuilder(body.text)
        val docTitle = title.text.toString().trim()
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    val paras = model(t)
                    val tmp = FileUtil.tempFile(this@EditorActivity, "out")
                    when (kind) {
                        DocKind.DOCX, DocKind.ODT, DocKind.RTF, DocKind.DOC -> toDocx(paras, docTitle, tmp)
                        DocKind.HTML -> tmp.writeText(toHtml(paras, docTitle))
                        DocKind.MARKDOWN -> tmp.writeText(toMarkdown(paras, docTitle))
                        else -> tmp.writeText(t.toString())
                    }
                    FileUtil.writeTo(this@EditorActivity, tmp, target)
                    tmp.delete()
                }.isSuccess
            }
            if (ok) { dirty = false; toast(if (copy) "Cópia salva" else "Documento salvo") }
            else { toast("Sem permissão para gravar aqui — escolha onde salvar"); saveCopy.launch(FileUtil.baseName(sourceName) + (if (kind == DocKind.DOCX || kind.isOffice) ".docx" else "." + FileUtil.extension(sourceName))) }
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
