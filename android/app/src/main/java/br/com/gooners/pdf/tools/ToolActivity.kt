package br.com.gooners.pdf.tools

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.DocumentConverter
import br.com.gooners.pdf.create.EditorActivity
import br.com.gooners.pdf.edit.PdfBoxUtil
import br.com.gooners.pdf.ocr.OcrHelper
import br.com.gooners.pdf.organize.OrganizeActivity
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.BitmapUtil
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.slider.Slider
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Tela única para todas as ferramentas: escolhe arquivos, mostra as opções, executa e entrega o resultado. */
class ToolActivity : AppCompatActivity() {
    companion object {
        private const val EXTRA_TOOL = "tool_id"
        private const val EXTRA_FILE = "file"
        private const val EXTRA_NAME = "name"
        private const val EXTRA_PW = "pw"

        fun start(ctx: Context, tool: ToolId, file: File? = null, name: String? = null, password: String? = null) {
            ctx.startActivity(Intent(ctx, ToolActivity::class.java).putExtra(EXTRA_TOOL, tool.name)
                .putExtra(EXTRA_FILE, file?.path).putExtra(EXTRA_NAME, name).putExtra(EXTRA_PW, password))
        }
    }

    private class InFile(val file: File?, val uri: Uri?, val name: String, var password: String? = null)
    private class Result(val files: List<File>, val message: String, val text: String? = null)

    private lateinit var tool: ToolId
    private val inputs = ArrayList<InFile>()
    private lateinit var filesBox: LinearLayout
    private lateinit var options: LinearLayout
    private lateinit var status: TextView
    private lateinit var progress: LinearProgressIndicator
    private lateinit var results: LinearLayout
    private lateinit var runBtn: MaterialButton
    private var action: (suspend (Progress) -> Result)? = null
    private val saver = SaveHelper(this)
    private var busy = false
    private val scanImages = ArrayList<File>()
    private var cameraFile: File? = null

    private val pickOne = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { addInputs(listOf(it)) } }
    private val pickMany = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) addInputs(uris) }
    private val scanLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
        val res = GmsDocumentScanningResult.fromActivityResultIntent(r.data)
        val pdf = res?.pdf
        if (r.resultCode == RESULT_OK && pdf != null) lifecycleScope.launch {
            val out = FileUtil.newOutFile(this@ToolActivity, "Digitalizado_${stamp()}.pdf")
            withContext(Dispatchers.IO) { FileUtil.open(this@ToolActivity, pdf.uri).use { i -> out.outputStream().use { i.copyTo(it) } } }
            showResult(Result(listOf(out), "Documento digitalizado com ${pdf.pageCount} página(s)."))
        } else if (inputs.isEmpty() && scanImages.isEmpty()) finish()
    }
    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = cameraFile
        if (ok && f != null && f.length() > 0) {
            scanImages += f
            status.text = "${scanImages.size} página(s) fotografada(s)"
            com.google.android.material.dialog.MaterialAlertDialogBuilder(this).setTitle("Página ${scanImages.size} adicionada")
                .setPositiveButton("Fotografar outra") { _, _ -> launchCamera() }
                .setNegativeButton("Concluir") { _, _ -> finishCameraScan() }
                .setCancelable(false).show()
        } else if (scanImages.isEmpty()) finish() else finishCameraScan()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tool = runCatching { ToolId.valueOf(intent.getStringExtra(EXTRA_TOOL) ?: "") }.getOrNull() ?: run { finish(); return }
        when (tool) {
            ToolId.NEW_DOC -> { startActivity(Intent(this, EditorActivity::class.java)); finish(); return }
            else -> {}
        }
        setContentView(R.layout.activity_tool)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = tool.title
        toolbar.setNavigationOnClickListener { finish() }
        findViewById<TextView>(R.id.desc).text = tool.desc
        filesBox = findViewById(R.id.files)
        options = findViewById(R.id.options)
        status = findViewById(R.id.status)
        progress = findViewById(R.id.progress)
        results = findViewById(R.id.results)
        runBtn = findViewById(R.id.run)
        runBtn.setOnClickListener { run() }
        findViewById<MaterialButton>(R.id.pick).apply {
            text = when (tool.input) { Input.PDFS, Input.IMAGES -> "Adicionar arquivos"; else -> "Escolher arquivo" }
            setOnClickListener { pick() }
        }
        if (tool.input == Input.NONE) findViewById<View>(R.id.filesCard).visibility = View.GONE
        buildOptions()

        val path = intent.getStringExtra(EXTRA_FILE)
        when {
            tool == ToolId.SCAN -> { runBtn.visibility = View.GONE; startScan() }
            path != null -> {
                inputs += InFile(File(path), null, intent.getStringExtra(EXTRA_NAME) ?: File(path).name, intent.getStringExtra(EXTRA_PW))
                onInputsChanged()
            }
            tool.input != Input.NONE && savedInstanceState == null -> pick()
        }
    }

    private fun stamp() = SimpleDateFormat("yyyyMMdd_HHmm", Locale.US).format(Date())

    // ------------------------------------------------------------------ entrada
    private fun pick() {
        when (tool.input) {
            Input.PDF -> pickOne.launch(arrayOf("application/pdf"))
            Input.PDFS -> pickMany.launch(arrayOf("application/pdf"))
            Input.IMAGES -> pickMany.launch(arrayOf("image/*"))
            Input.DOCUMENT, Input.IMAGE_OR_PDF -> pickOne.launch(arrayOf("*/*"))
            Input.NONE -> {}
        }
    }

    private fun addInputs(uris: List<Uri>) {
        // ferramentas que abrem o editor visual
        if (tool in setOf(ToolId.EDIT, ToolId.SIGN, ToolId.FILL_FORM, ToolId.REDACT)) {
            Router.persist(this, uris[0])
            Router.open(this, uris[0]) {
                putExtra(Router.EXTRA_EDIT, true)
                when (tool) {
                    ToolId.SIGN -> putExtra(Router.EXTRA_TOOL, "SIGN")
                    ToolId.FILL_FORM -> putExtra(Router.EXTRA_TOOL, "FORM")
                    ToolId.REDACT -> putExtra(Router.EXTRA_TOOL, "REDACT")
                    else -> {}
                }
            }
            finish(); return
        }
        if (tool.input == Input.PDF || tool.input == Input.DOCUMENT) inputs.clear()
        lifecycleScope.launch {
            status.text = "Carregando…"
            for (u in uris) {
                val name = FileUtil.displayName(this@ToolActivity, u)
                if (tool.input == Input.IMAGES) { inputs += InFile(null, u, name); continue }
                try {
                    val f = withContext(Dispatchers.IO) { FileUtil.copyToCache(this@ToolActivity, u, "work", name) }
                    inputs += InFile(f, u, name)
                } catch (e: Exception) {
                    Toast.makeText(this@ToolActivity, "Erro ao ler $name", Toast.LENGTH_SHORT).show()
                }
            }
            status.text = ""
            onInputsChanged()
        }
    }

    /** Pede a senha dos PDFs protegidos, um de cada vez. */
    private fun checkPasswords(then: () -> Unit) {
        lifecycleScope.launch {
            for (inf in inputs) {
                val f = inf.file ?: continue
                if (inf.password != null || DocKind.fromName(inf.name) != DocKind.PDF && tool.input == Input.DOCUMENT) continue
                val needs = withContext(Dispatchers.IO) { runCatching { PdfBoxUtil.needsPassword(f) }.getOrDefault(false) }
                if (needs) { askPassword(inf) { checkPasswords(then) }; return@launch }
            }
            then()
        }
    }

    private fun askPassword(inf: InFile, then: () -> Unit) {
        Dialogs.password(this, "Senha de \"${inf.name}\"", "Este PDF é protegido.", onCancel = { inputs.remove(inf); renderInputs() }) { pw ->
            lifecycleScope.launch {
                val ok = withContext(Dispatchers.IO) { runCatching { PdfBoxUtil.load(inf.file!!, pw).close() }.isSuccess }
                if (ok) { inf.password = pw; then() } else { Toast.makeText(this@ToolActivity, "Senha incorreta", Toast.LENGTH_SHORT).show(); askPassword(inf, then) }
            }
        }
    }

    private fun onInputsChanged() {
        renderInputs()
        if (tool == ToolId.ORGANIZE && inputs.isNotEmpty()) {
            checkPasswords {
                val inf = inputs[0]
                lifecycleScope.launch {
                    val f = withContext(Dispatchers.IO) {
                        val pw = inf.password
                        if (pw == null) inf.file!! else File(inf.file!!.parentFile, "aberto_" + inf.name).also { PdfBoxUtil.decrypt(inf.file, pw, it) }
                    }
                    startActivity(Intent(this@ToolActivity, OrganizeActivity::class.java).putExtra(OrganizeActivity.EXTRA_FILE, f.path).putExtra(OrganizeActivity.EXTRA_NAME, inf.name))
                    finish()
                }
            }
            return
        }
        checkPasswords {
            if (tool == ToolId.METADATA) inputs.firstOrNull()?.let { prefillMeta(it) }
            if (tool == ToolId.UNLOCK) inputs.firstOrNull()?.let { inf ->
                if (inf.password == null) status.text = "Este PDF não está protegido por senha de abertura. Executar removerá apenas restrições de permissão."
            }
        }
    }

    private fun renderInputs() {
        filesBox.removeAllViews()
        inputs.forEachIndexed { i, inf ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
            row.addView(TextView(this).apply {
                val size = inf.file?.length()?.let { " · " + FileUtil.human(it) } ?: ""
                text = "${i + 1}. ${inf.name}$size"; maxLines = 2
            }, LinearLayout.LayoutParams(0, -2, 1f))
            if (inputs.size > 1) {
                row.addView(iconBtn(R.drawable.ic_up, "Mover para cima") { if (i > 0) { inputs.add(i - 1, inputs.removeAt(i)); renderInputs() } })
                row.addView(iconBtn(R.drawable.ic_down, "Mover para baixo") { if (i < inputs.size - 1) { inputs.add(i + 1, inputs.removeAt(i)); renderInputs() } })
            }
            row.addView(iconBtn(R.drawable.ic_close, "Remover") { inputs.removeAt(i); renderInputs() })
            filesBox.addView(row)
        }
        if (inputs.isEmpty()) filesBox.addView(TextView(this).apply { text = "Nenhum arquivo escolhido"; alpha = 0.6f })
    }

    private fun iconBtn(icon: Int, desc: String, fn: () -> Unit) = ImageButton(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
        setImageResource(icon); contentDescription = desc; setOnClickListener { fn() }
        layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
    }

    // ------------------------------------------------------------------ campos de opções
    private fun label(t: String) = options.addView(TextView(this).apply {
        text = t; setPadding(0, dp(12), 0, dp(2)); setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_LabelLarge)
    })

    private fun text(lbl: String, hint: String = "", initial: String = "", type: Int = InputType.TYPE_CLASS_TEXT): EditText {
        label(lbl)
        val et = EditText(this).apply { this.hint = hint; setText(initial); inputType = type }
        options.addView(et)
        return et
    }

    private fun spinner(lbl: String, items: List<String>, def: Int = 0): Spinner {
        label(lbl)
        val sp = Spinner(this)
        sp.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, items)
        sp.setSelection(def)
        options.addView(sp)
        return sp
    }

    private fun check(lbl: String, def: Boolean) = CheckBox(this).apply { text = lbl; isChecked = def; options.addView(this) }

    private fun slider(lbl: String, from: Float, to: Float, value: Float, step: Float): Slider {
        label(lbl)
        val s = Slider(this).apply { valueFrom = from; valueTo = to; this.value = value; stepSize = step }
        options.addView(s)
        return s
    }

    private fun colorField(lbl: String, def: Int): () -> Int {
        var color = def
        label(lbl)
        val v = View(this)
        fun paint() { v.background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(color); setStroke(dp(1), 0x55888888) } }
        paint()
        v.setOnClickListener { Dialogs.color(this, color) { color = it; paint() } }
        options.addView(v, LinearLayout.LayoutParams(dp(64), dp(36)))
        return { color }
    }

    private fun base(i: Int = 0) = FileUtil.baseName(inputs[i].name)
    private fun pdf(i: Int = 0) = inputs[i].file!!
    private fun pw(i: Int = 0) = inputs[i].password
    private fun outFile(name: String) = FileUtil.newOutFile(this, name)
    private fun outDir() = File(FileUtil.dir(this, "out"), "d" + System.currentTimeMillis()).apply { mkdirs() }

    private fun buildOptions() {
        when (tool) {
            ToolId.MERGE -> action = { p ->
                require(inputs.size >= 2) { "Escolha pelo menos 2 PDFs" }
                val plain = inputs.map { inf -> inf.password?.let { pw -> File(inf.file!!.parentFile, "m_" + inf.name).also { PdfBoxUtil.decrypt(inf.file, pw, it) } } ?: inf.file!! }
                val out = outFile("${base()}_mesclado.pdf")
                PdfTools.merge(plain, out, p)
                Result(listOf(out), "${inputs.size} PDFs mesclados em ${PdfTools.pageCount(out)} páginas.")
            }
            ToolId.SPLIT -> {
                val mode = spinner("Como dividir", listOf("Intervalos personalizados", "A cada N páginas", "Uma página por arquivo"))
                val ranges = text("Intervalos (ex.: 1-3, 4-8, 9)", "1-3, 4-6")
                val every = text("N (para \"a cada N páginas\")", "2", "2", InputType.TYPE_CLASS_NUMBER)
                action = { p ->
                    val total = PdfTools.pageCount(pdf(), pw())
                    val list = when (mode.selectedItemPosition) {
                        0 -> PdfTools.parseRanges(ranges.text.toString().ifBlank { throw IllegalArgumentException("Informe os intervalos") }, total)
                        1 -> { val n = (every.text.toString().toIntOrNull() ?: 1).coerceAtLeast(1); (0 until total step n).map { it..minOf(total - 1, it + n - 1) } }
                        else -> (0 until total).map { it..it }
                    }
                    val files = PdfTools.split(pdf(), pw(), list, outDir(), base(), p)
                    Result(files, "PDF dividido em ${files.size} arquivos.")
                }
            }
            ToolId.EXTRACT_PAGES -> {
                val ranges = text("Páginas a extrair (ex.: 1, 3-5, 10-)", "1-3")
                action = { _ ->
                    val total = PdfTools.pageCount(pdf(), pw())
                    val pages = PdfTools.parseRanges(ranges.text.toString().ifBlank { throw IllegalArgumentException("Informe as páginas") }, total).flatMap { it.toList() }
                    val out = outFile("${base()}_extraido.pdf")
                    PdfTools.extract(pdf(), pw(), pages, out)
                    Result(listOf(out), "${pages.size} páginas extraídas.")
                }
            }
            ToolId.DELETE_PAGES -> {
                val ranges = text("Páginas a excluir (ex.: 2, 5-7)", "2")
                action = { _ ->
                    val total = PdfTools.pageCount(pdf(), pw())
                    val pages = PdfTools.parseRanges(ranges.text.toString().ifBlank { throw IllegalArgumentException("Informe as páginas") }, total).flatMap { it.toList() }.toSet()
                    val out = outFile("${base()}.pdf")
                    PdfTools.deletePages(pdf(), pw(), pages, out)
                    Result(listOf(out), "${pages.size} páginas excluídas; restaram ${total - pages.size}.")
                }
            }
            ToolId.COMPRESS -> {
                val level = spinner("Nível de compressão", listOf(
                    "Leve — qualidade máxima", "Recomendada — bom equilíbrio", "Forte — arquivo bem menor", "Extrema — páginas viram imagem (digitalizações)"), 1)
                action = { p ->
                    val out = outFile("${base()}_comprimido.pdf")
                    when (level.selectedItemPosition) {
                        0 -> PdfTools.compress(pdf(), pw(), out, 2400, 0.85f, 0, p)
                        1 -> PdfTools.compress(pdf(), pw(), out, 1600, 0.72f, 0, p)
                        2 -> PdfTools.compress(pdf(), pw(), out, 1100, 0.55f, 0, p)
                        else -> PdfTools.compress(pdf(), pw(), out, 0, 0.5f, 100, p)
                    }
                    val before = pdf().length(); val after = out.length()
                    val pct = if (before > 0) 100 - after * 100 / before else 0
                    Result(listOf(out), "De ${FileUtil.human(before)} para ${FileUtil.human(after)}" + if (pct > 0) " (−$pct%)." else ". O arquivo já estava otimizado.")
                }
            }
            ToolId.GRAYSCALE -> {
                val dpi = spinner("Resolução", listOf("100 ppp (menor)", "150 ppp (recomendado)", "200 ppp (melhor)"), 1)
                action = { p ->
                    val out = outFile("${base()}_cinza.pdf")
                    PdfTools.rasterize(pdf(), pw(), out, listOf(100, 150, 200)[dpi.selectedItemPosition], 0.75f, true, p)
                    Result(listOf(out), "PDF convertido para tons de cinza.")
                }
            }
            ToolId.TO_DOCX -> action = { p ->
                val out = outFile("${base()}.docx"); PdfTools.toDocx(pdf(), pw(), out, base(), p)
                Result(listOf(out), "Documento Word criado. Texto e parágrafos são preservados; o layout pode variar.")
            }
            ToolId.TO_TEXT -> action = { p ->
                val out = outFile("${base()}.txt"); PdfTools.toText(pdf(), pw(), out, p)
                val t = out.readText()
                Result(listOf(out), if (t.isBlank()) "Nenhum texto encontrado. Para PDFs digitalizados, use \"OCR: PDF pesquisável\"." else "Texto extraído (${t.length} caracteres).", t.take(20000))
            }
            ToolId.TO_HTML -> action = { p ->
                val out = outFile("${base()}.html"); PdfTools.toHtml(pdf(), pw(), out, base(), p)
                Result(listOf(out), "Página HTML criada.")
            }
            ToolId.TO_IMAGES -> {
                val fmt = spinner("Formato", listOf("JPG (menor)", "PNG (sem perdas)"))
                val dpi = spinner("Resolução", listOf("72 ppp", "96 ppp", "150 ppp", "200 ppp", "300 ppp (impressão)"), 2)
                val pages = text("Páginas (vazio = todas)", "ex.: 1-3, 5")
                action = { p ->
                    val total = PdfTools.pageCount(pdf(), pw())
                    val list = if (pages.text.isBlank()) null else PdfTools.parseRanges(pages.text.toString(), total).flatMap { it.toList() }
                    val files = PdfTools.toImages(pdf(), pw(), outDir(), base(), listOf(72, 96, 150, 200, 300)[dpi.selectedItemPosition], fmt.selectedItemPosition == 1, list, p)
                    Result(files, "${files.size} imagens criadas.")
                }
            }
            ToolId.EXTRACT_IMAGES -> action = { p ->
                val files = PdfTools.extractImages(pdf(), pw(), outDir(), base(), p)
                Result(files, if (files.isEmpty()) "Nenhuma imagem encontrada neste PDF." else "${files.size} imagens extraídas.")
            }
            ToolId.OCR_PDF -> {
                val only = check("Só páginas sem texto (mais rápido)", true)
                action = { p ->
                    val out = outFile("${base()}_pesquisavel.pdf")
                    val n = PdfTools.ocrPdf(pdf(), pw(), out, only.isChecked, p)
                    Result(listOf(out), if (n == 0) "Nenhuma página precisou de OCR (ou nenhum texto foi reconhecido)." else "Texto reconhecido em $n página(s). Agora o PDF pode ser pesquisado e copiado.")
                }
            }
            ToolId.OCR_IMAGE -> action = { p ->
                val sb = StringBuilder()
                inputs.forEachIndexed { i, inf ->
                    p("Reconhecendo imagem ${i + 1} de ${inputs.size}…", i / inputs.size.toFloat())
                    val bmp = BitmapUtil.decode(this, inf.uri!!, 2600) ?: return@forEachIndexed
                    val t = OcrHelper.recognize(bmp).text
                    bmp.recycle()
                    if (inputs.size > 1) sb.append("——— ${inf.name} ———\n")
                    sb.append(t).append("\n\n")
                }
                val out = outFile("${base()}_texto.txt").also { it.writeText(sb.toString().trim()) }
                Result(listOf(out), "Texto reconhecido.", sb.toString().trim())
            }
            ToolId.DOC_TO_PDF -> {
                val size = spinner("Tamanho da página", PdfTools.pageSizes.map { it.label })
                val land = check("Paisagem (bom para planilhas)", false)
                val font = spinner("Tamanho do texto", listOf("Pequeno (9)", "Normal (11)", "Grande (13)", "Muito grande (16)"), 1)
                action = { p ->
                    val inf = inputs[0]
                    val kind = DocKind.detect(this, Uri.fromFile(inf.file!!), inf.name)
                    val out = outFile("${base()}.pdf")
                    DocumentConverter.toPdf(this, inf.file, kind, inf.name, out, size.selectedItemPosition, land.isChecked, listOf(9f, 11f, 13f, 16f)[font.selectedItemPosition], p)
                    Result(listOf(out), "${kind.label} convertido para PDF (${PdfTools.pageCount(out)} páginas). Dica: no leitor do documento, \"Imprimir / salvar como PDF\" preserva mais o layout visual.")
                }
            }
            ToolId.PROTECT -> {
                val p1 = text("Senha para abrir", "mínimo 4 caracteres", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
                val p2 = text("Confirme a senha", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
                val owner = text("Senha de proprietário (opcional)", "para alterar permissões", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
                val print = check("Permitir imprimir", true)
                val copy = check("Permitir copiar texto", true)
                val modify = check("Permitir modificar", false)
                action = { _ ->
                    val a = p1.text.toString()
                    require(a.length >= 4) { "A senha precisa ter pelo menos 4 caracteres" }
                    require(a == p2.text.toString()) { "As senhas não conferem" }
                    val out = outFile("${base()}_protegido.pdf")
                    PdfTools.protect(pdf(), out, a, owner.text.toString().ifEmpty { a + "#owner" }, print.isChecked, copy.isChecked, modify.isChecked, pw())
                    Result(listOf(out), "PDF protegido com criptografia AES-256. Guarde a senha: sem ela não é possível abrir o arquivo.")
                }
            }
            ToolId.UNLOCK -> action = { _ ->
                val out = outFile("${base()}_sem_senha.pdf")
                PdfTools.unlock(pdf(), pw() ?: "", out)
                Result(listOf(out), "Senha e restrições removidas.")
            }
            ToolId.WATERMARK -> {
                val t = text("Texto da marca d'água", "CONFIDENCIAL", "CONFIDENCIAL")
                val size = slider("Tamanho", 16f, 140f, 64f, 2f)
                val op = slider("Opacidade", 0.05f, 0.8f, 0.18f, 0.01f)
                val color = colorField("Cor", 0xFF6B7280.toInt())
                val diag = check("Na diagonal", true)
                action = { _ ->
                    require(t.text.isNotBlank()) { "Digite o texto" }
                    val out = outFile("${base()}_marca.pdf")
                    PdfTools.watermark(pdf(), pw(), out, t.text.toString(), size.value, op.value, color(), diag.isChecked)
                    Result(listOf(out), "Marca d'água aplicada em todas as páginas.")
                }
            }
            ToolId.PAGE_NUMBERS -> {
                val pos = spinner("Posição", PdfTools.Pos.values().map { it.label }, 4)
                val formats = listOf("{n}", "Página {n}", "Página {n} de {total}", "{n} / {total}", "- {n} -")
                val fmt = spinner("Formato", formats.map { it.replace("{n}", "1").replace("{total}", "10") }, 0)
                val start = text("Começar em", "1", "1", InputType.TYPE_CLASS_NUMBER)
                val size = slider("Tamanho da fonte", 6f, 24f, 10f, 1f)
                val skip = check("Não numerar a primeira página (capa)", false)
                action = { _ ->
                    val out = outFile("${base()}_numerado.pdf")
                    PdfTools.pageNumbers(pdf(), pw(), out, PdfTools.Pos.values()[pos.selectedItemPosition], formats[fmt.selectedItemPosition],
                        start.text.toString().toIntOrNull() ?: 1, size.value, skip.isChecked)
                    Result(listOf(out), "Páginas numeradas.")
                }
            }
            ToolId.HEADER_FOOTER -> {
                val h = text("Cabeçalho", "use {n}, {total} e {data}")
                val f = text("Rodapé", "ex.: Página {n} de {total}", "Página {n} de {total}")
                val size = slider("Tamanho da fonte", 6f, 20f, 9f, 1f)
                action = { _ ->
                    val out = outFile("${base()}_cabecalho.pdf")
                    PdfTools.headerFooter(pdf(), pw(), out, h.text.toString(), f.text.toString(), size.value)
                    Result(listOf(out), "Cabeçalho e rodapé aplicados.")
                }
            }
            ToolId.ROTATE -> {
                val deg = spinner("Girar", listOf("90° à direita", "180°", "90° à esquerda"))
                val pages = text("Páginas (vazio = todas)", "ex.: 1, 3-4")
                action = { _ ->
                    val total = PdfTools.pageCount(pdf(), pw())
                    val set = if (pages.text.isBlank()) null else PdfTools.parseRanges(pages.text.toString(), total).flatMap { it.toList() }.toSet()
                    val out = outFile("${base()}_girado.pdf")
                    PdfTools.rotate(pdf(), pw(), listOf(90, 180, 270)[deg.selectedItemPosition], set, out)
                    Result(listOf(out), "Páginas giradas.")
                }
            }
            ToolId.METADATA -> {
                val t = text("Título"); val a = text("Autor"); val s = text("Assunto"); val k = text("Palavras-chave")
                metaFields = listOf(t, a, s, k)
                action = { _ ->
                    val out = outFile("${base()}.pdf")
                    PdfTools.writeMeta(pdf(), pw(), out, t.text.toString(), a.text.toString(), s.text.toString(), k.text.toString())
                    Result(listOf(out), "Propriedades atualizadas.")
                }
            }
            ToolId.FLATTEN -> action = { _ ->
                val out = outFile("${base()}_achatado.pdf"); PdfTools.flatten(pdf(), pw(), out)
                Result(listOf(out), "Campos de formulário fixados no documento.")
            }
            ToolId.IMAGES_TO_PDF -> {
                val size = spinner("Tamanho da página", listOf("Igual à imagem") + PdfTools.pageSizes.map { it.label }, 1)
                val margin = spinner("Margem", listOf("Sem margem", "Pequena", "Média", "Grande"), 1)
                val q = spinner("Qualidade", listOf("Alta", "Média (menor)", "Baixa (mínimo)"))
                action = { p ->
                    require(inputs.isNotEmpty()) { "Escolha as imagens" }
                    val out = outFile("${if (inputs.size == 1) base() else "Imagens_${stamp()}"}.pdf")
                    PdfTools.imagesToPdf(this, inputs.map { it.uri!! }, out, size.selectedItemPosition - 1,
                        listOf(0f, 18f, 36f, 54f)[margin.selectedItemPosition], listOf(0.9f, 0.75f, 0.55f)[q.selectedItemPosition], p)
                    Result(listOf(out), "PDF criado com ${inputs.size} imagem(ns).")
                }
            }
            ToolId.BLANK_PDF -> {
                val n = text("Número de páginas", "1", "1", InputType.TYPE_CLASS_NUMBER)
                val size = spinner("Tamanho", PdfTools.pageSizes.map { it.label })
                val land = check("Paisagem", false)
                val style = spinner("Estilo", listOf("Liso", "Pautado", "Quadriculado", "Pontilhado"))
                action = { _ ->
                    val out = outFile("Novo_${stamp()}.pdf")
                    PdfTools.blank(out, n.text.toString().toIntOrNull() ?: 1, size.selectedItemPosition, land.isChecked, style.selectedItemPosition)
                    Result(listOf(out), "PDF criado. Abra para escrever, desenhar e assinar.")
                }
            }
            else -> {}
        }
    }

    private var metaFields: List<EditText> = emptyList()

    private fun prefillMeta(inf: InFile) {
        lifecycleScope.launch {
            val m = withContext(Dispatchers.IO) { runCatching { PdfTools.readMeta(inf.file!!, inf.password) }.getOrNull() } ?: return@launch
            listOf("title", "author", "subject", "keywords").forEachIndexed { i, k -> metaFields.getOrNull(i)?.setText(m[k]) }
        }
    }

    // ------------------------------------------------------------------ execução
    private fun run() {
        if (busy) return
        val act = action ?: return
        if (tool.input != Input.NONE && inputs.isEmpty()) { pick(); return }
        checkPasswords {
            busy = true
            runBtn.isEnabled = false
            results.removeAllViews()
            progress.visibility = View.VISIBLE
            progress.isIndeterminate = true
            lifecycleScope.launch {
                try {
                    val r = withContext(Dispatchers.IO) {
                        act { msg, f ->
                            runOnUiThread {
                                status.text = msg
                                if (f == null) progress.isIndeterminate = true else {
                                    if (progress.isIndeterminate) { progress.visibility = View.INVISIBLE; progress.isIndeterminate = false; progress.visibility = View.VISIBLE }
                                    progress.setProgressCompat((f * 100).toInt(), true)
                                }
                            }
                        }
                    }
                    showResult(r)
                } catch (e: OutOfMemoryError) {
                    status.text = "Memória insuficiente para este arquivo. Tente uma opção mais leve (ex.: resolução menor)."
                } catch (e: Exception) {
                    status.text = "Erro: " + (e.message ?: e.javaClass.simpleName)
                } finally {
                    busy = false
                    runBtn.isEnabled = true
                    progress.visibility = View.GONE
                }
            }
        }
    }

    private fun showResult(r: Result) {
        status.text = "✔ " + r.message
        results.removeAllViews()
        if (r.text != null && r.text.isNotBlank()) {
            results.addView(TextView(this).apply {
                text = r.text.take(3000) + if (r.text.length > 3000) "\n…" else ""
                setTextIsSelectable(true); setPadding(dp(12), dp(12), dp(12), dp(12))
                setBackgroundResource(R.drawable.bg_chip)
            })
            results.addView(MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = "Copiar texto"; setOnClickListener {
                    (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("texto", r.text))
                    Toast.makeText(this@ToolActivity, "Copiado", Toast.LENGTH_SHORT).show()
                }
            })
        }
        if (r.files.size > 1) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(MaterialButton(this).apply { text = "Salvar todos"; setOnClickListener { saver.saveAll(r.files) } }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(8) })
            row.addView(MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = "Compartilhar todos"; setOnClickListener { FileUtil.share(this@ToolActivity, r.files) }
            }, LinearLayout.LayoutParams(0, -2, 1f))
            results.addView(row)
        }
        for (f in r.files.take(200)) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(6))
                setBackgroundResource(R.drawable.bg_chip)
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) }
            }
            card.addView(TextView(this).apply { text = "${f.name}  ·  ${FileUtil.human(f.length())}"; setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleSmall) })
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            fun b(t: String, fn: () -> Unit) = row.addView(MaterialButton(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply { text = t; setOnClickListener { fn() } })
            b("Abrir") { Router.openFile(this, f) }
            b("Compartilhar") { FileUtil.share(this, listOf(f)) }
            b("Salvar") { saver.saveAs(f) }
            card.addView(row)
            results.addView(card)
        }
        if (tool == ToolId.BLANK_PDF && r.files.size == 1) Router.openFile(this, r.files[0]) { putExtra(Router.EXTRA_EDIT, true) }
    }

    // ------------------------------------------------------------------ digitalização
    private fun startScan() {
        status.text = "Abrindo o digitalizador…"
        if (Build.VERSION.SDK_INT >= 23) {
            try {
                val opts = GmsDocumentScannerOptions.Builder()
                    .setGalleryImportAllowed(true)
                    .setPageLimit(200)
                    .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
                    .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                    .build()
                GmsDocumentScanning.getClient(opts).getStartScanIntent(this)
                    .addOnSuccessListener { scanLauncher.launch(IntentSenderRequest.Builder(it).build()) }
                    .addOnFailureListener { launchCamera() }
                return
            } catch (_: Throwable) {
            }
        }
        launchCamera()
    }

    private fun launchCamera() {
        status.text = "Fotografe cada página do documento"
        val f = File(FileUtil.dir(this, "tmp"), "scan_${System.currentTimeMillis()}.jpg")
        cameraFile = f
        try {
            takePicture.launch(FileUtil.uriFor(this, f))
        } catch (e: Exception) {
            status.text = "Nenhum app de câmera disponível."
        }
    }

    private fun finishCameraScan() {
        if (scanImages.isEmpty()) return
        lifecycleScope.launch {
            progress.visibility = View.VISIBLE
            val out = outFile("Digitalizado_${stamp()}.pdf")
            try {
                withContext(Dispatchers.IO) { PdfTools.imagesToPdf(this@ToolActivity, scanImages.map { Uri.fromFile(it) }, out, 0, 12f, 0.82f) { _, _ -> } }
                showResult(Result(listOf(out), "Documento digitalizado com ${scanImages.size} página(s)."))
            } catch (e: Exception) {
                status.text = "Erro: ${e.message}"
            } finally { progress.visibility = View.GONE }
        }
    }
}
