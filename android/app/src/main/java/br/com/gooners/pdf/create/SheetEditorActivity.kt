package br.com.gooners.pdf.create

import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.Cfb
import br.com.gooners.pdf.convert.CsvParser
import br.com.gooners.pdf.convert.LegacyOffice
import br.com.gooners.pdf.convert.OdsReader
import br.com.gooners.pdf.convert.TextDecode
import br.com.gooners.pdf.convert.XlsxParser
import br.com.gooners.pdf.convert.XlsxWriter
import br.com.gooners.pdf.convert.ZipRes
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Editor de planilhas: abre CSV, XLSX, XLS e ODS; edita células, linhas e colunas; salva em CSV ou XLSX. */
class SheetEditorActivity : AppCompatActivity() {
    private class Sheet(var name: String, val rows: MutableList<MutableList<String>>)

    private val sheets = ArrayList<Sheet>()
    private var cur = 0
    private var selR = 0
    private var selC = 0
    private var cols = 12
    private var dirty = false
    private var uri: Uri? = null
    private var name = "planilha.xlsx"
    private var kind = DocKind.XLSX
    private var csvSep = ';'
    private lateinit var grid: RecyclerView
    private lateinit var hscroll: HorizontalScrollView
    private lateinit var cellRef: TextView
    private lateinit var input: EditText
    private lateinit var chips: ChipGroup
    private lateinit var toolbar: MaterialToolbar
    private val saver = SaveHelper(this)
    private val cellW by lazy { dp(108) }
    private val headW by lazy { dp(46) }
    private val cellH by lazy { dp(38) }

    private val saveCsvAs = registerForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { u -> u?.let { writeCsv(it) } }
    private val saveXlsxAs = registerForActivityResult(ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) { u -> u?.let { writeXlsx(it) } }

    private val sheet get() = sheets[cur]

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        uri = intent.data
        name = intent.getStringExtra(Router.EXTRA_NAME) ?: uri?.let { FileUtil.displayName(this, it) } ?: "Planilha.xlsx"
        kind = runCatching { DocKind.valueOf(intent.getStringExtra(Router.EXTRA_KIND) ?: "") }.getOrNull() ?: DocKind.fromName(name)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        toolbar = MaterialToolbar(this).apply {
            title = name; setNavigationIcon(R.drawable.ic_prev); setNavigationOnClickListener { onBackPressedDispatcher.onBackPressed() }
            setBackgroundColor(ContextCompat.getColor(context, android.R.color.transparent))
        }
        listOf("Salvar", "Inserir linha abaixo", "Inserir linha acima", "Excluir linha", "Inserir coluna à direita", "Excluir coluna",
            "Ordenar A → Z pela coluna", "Ordenar Z → A pela coluna", "Localizar", "Nova planilha", "Renomear planilha", "Excluir planilha",
            "Salvar como CSV…", "Salvar como XLSX…", "Exportar como PDF").forEachIndexed { i, t ->
            val item = toolbar.menu.add(t)
            if (i == 0) { item.setIcon(R.drawable.ic_save); item.setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS) }
        }
        toolbar.setOnMenuItemClickListener { onMenu(it.title.toString()); true }
        root.addView(toolbar, LinearLayout.LayoutParams(-1, dp(56)))

        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), 0, dp(8), 0) }
        cellRef = TextView(this).apply { typeface = Typeface.DEFAULT_BOLD; minWidth = dp(52); gravity = Gravity.CENTER }
        input = EditText(this).apply {
            hint = "Conteúdo da célula"; isSingleLine = true; imeOptions = EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, a, ev -> if (a == EditorInfo.IME_ACTION_DONE || ev?.keyCode == KeyEvent.KEYCODE_ENTER) { commit(); move(1, 0); true } else false }
        }
        bar.addView(cellRef)
        bar.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        bar.addView(TextView(this).apply { text = "✓"; textSize = 20f; setPadding(dp(14), dp(8), dp(8), dp(8)); setOnClickListener { commit() } })
        root.addView(bar)

        chips = ChipGroup(this).apply { isSingleSelection = true; isSelectionRequired = true; setPadding(dp(8), 0, dp(8), 0) }
        root.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(chips) })

        hscroll = HorizontalScrollView(this).apply { isFillViewport = false }
        grid = RecyclerView(this)
        grid.layoutManager = LinearLayoutManager(this)
        grid.adapter = RowAdapter()
        hscroll.addView(grid, ViewGroup.LayoutParams(headW + cols * cellW, -1))
        root.addView(hscroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                commit()
                if (!dirty) { finish(); return }
                MaterialAlertDialogBuilder(this@SheetEditorActivity).setTitle("Salvar alterações?")
                    .setPositiveButton("Salvar") { _, _ -> onMenu("Salvar") }
                    .setNegativeButton("Descartar") { _, _ -> finish() }
                    .setNeutralButton("Cancelar", null).show()
            }
        })
        load()
    }

    private fun load() {
        val u = uri
        if (u == null) { sheets += Sheet("Planilha1", ArrayList()); onLoaded(); return }
        lifecycleScope.launch {
            try {
                val loaded = withContext(Dispatchers.IO) {
                    val f = FileUtil.copyToCache(this@SheetEditorActivity, u, "work", name)
                    when (kind) {
                        DocKind.XLSX -> ZipRes(f).use { XlsxParser.read(it) }
                        DocKind.XLS -> Cfb(f).use { LegacyOffice.xlsSheets(it, 20000, 200) }
                        DocKind.ODS -> ZipRes(f).use { OdsReader.sheets(it) }
                        else -> {
                            val text = TextDecode.decode(f.readBytes())
                            csvSep = CsvParser.separator(text)
                            listOf(XlsxParser.Sheet(FileUtil.baseName(name), CsvParser.parse(text, 50000)))
                        }
                    }
                }
                loaded.forEach { s -> sheets += Sheet(s.name, s.rows.map { it.toMutableList() }.toMutableList()) }
                if (sheets.isEmpty()) sheets += Sheet("Planilha1", ArrayList())
                onLoaded()
            } catch (e: Throwable) {
                Dialogs.message(this@SheetEditorActivity, "Não foi possível abrir", e.message ?: e.toString())
            }
        }
    }

    private fun onLoaded() {
        renderChips()
        select(0, 0)
        if (kind != DocKind.CSV && uri != null) toast("Fórmulas e formatação não são preservadas: valores e textos sim")
    }

    private fun renderChips() {
        chips.removeAllViews()
        sheets.forEachIndexed { i, s ->
            chips.addView(Chip(this).apply {
                text = s.name; isCheckable = true; isChecked = i == cur; id = View.generateViewId()
                setOnClickListener { commit(); cur = i; select(0, 0); relayout() }
            })
        }
        relayout()
    }

    private fun relayout() {
        cols = maxOf(10, (sheet.rows.maxOfOrNull { it.size } ?: 0) + 2).coerceAtMost(500)
        grid.layoutParams = grid.layoutParams.apply { width = headW + cols * cellW }
        grid.adapter?.notifyDataSetChanged()
        toolbar.subtitle = "${sheet.rows.size} linhas · ${XlsxParser.colName(cols - 1)} colunas"
    }

    private fun value(r: Int, c: Int): String = sheet.rows.getOrNull(r)?.getOrNull(c) ?: ""

    private fun setValue(r: Int, c: Int, v: String) {
        if (value(r, c) == v) return
        while (sheet.rows.size <= r) sheet.rows.add(ArrayList())
        val row = sheet.rows[r]
        while (row.size <= c) row += ""
        row[c] = v
        dirty = true
        if (c + 2 > cols) relayout() else grid.adapter?.notifyItemChanged(r + 1)
    }

    private fun select(r: Int, c: Int) {
        val oldR = selR
        selR = r.coerceAtLeast(0); selC = c.coerceIn(0, cols - 1)
        cellRef.text = XlsxParser.colName(selC) + (selR + 1)
        input.setText(value(selR, selC))
        input.setSelection(input.text.length)
        grid.adapter?.notifyItemChanged(oldR + 1)
        grid.adapter?.notifyItemChanged(selR + 1)
    }

    private fun commit() = setValue(selR, selC, input.text.toString())

    private fun move(dr: Int, dc: Int) {
        select(selR + dr, selC + dc)
        (grid.layoutManager as LinearLayoutManager).scrollToPosition(selR + 1)
    }

    private fun onMenu(t: String) {
        commit()
        val rows = sheet.rows
        when (t) {
            "Salvar" -> save()
            "Inserir linha abaixo" -> { rows.add((selR + 1).coerceAtMost(rows.size), ArrayList()); dirty = true; relayout() }
            "Inserir linha acima" -> { rows.add(selR.coerceAtMost(rows.size), ArrayList()); dirty = true; relayout() }
            "Excluir linha" -> if (selR < rows.size) { rows.removeAt(selR); dirty = true; relayout(); select(selR, selC) }
            "Inserir coluna à direita" -> { rows.forEach { r -> if (r.size > selC) r.add(selC + 1, "") }; dirty = true; relayout() }
            "Excluir coluna" -> { rows.forEach { r -> if (r.size > selC) r.removeAt(selC) }; dirty = true; relayout(); select(selR, selC) }
            "Ordenar A → Z pela coluna", "Ordenar Z → A pela coluna" -> {
                val desc = t.contains("Z → A")
                Dialogs.confirm(this, "Ordenar pela coluna ${XlsxParser.colName(selC)}", "A primeira linha é cabeçalho e ficará fixa?", "Sim, manter cabeçalho") { sortBy(desc, true) }
            }
            "Localizar" -> Dialogs.input(this, "Localizar na planilha") { q -> find(q) }
            "Nova planilha" -> { sheets += Sheet("Planilha${sheets.size + 1}", ArrayList()); cur = sheets.size - 1; dirty = true; renderChips(); select(0, 0) }
            "Renomear planilha" -> Dialogs.input(this, "Nome da planilha", initial = sheet.name) { n -> if (n.isNotBlank()) { sheet.name = n.trim(); dirty = true; renderChips() } }
            "Excluir planilha" -> if (sheets.size > 1) Dialogs.confirm(this, "Excluir \"${sheet.name}\"", "Esta planilha e seus dados serão removidos.", "Excluir") {
                sheets.removeAt(cur); cur = 0; dirty = true; renderChips(); select(0, 0)
            } else toast("A pasta precisa ter pelo menos uma planilha")
            "Salvar como CSV…" -> saveCsvAs.launch(FileUtil.baseName(name) + (if (sheets.size > 1) "_" + sheet.name else "") + ".csv")
            "Salvar como XLSX…" -> saveXlsxAs.launch(FileUtil.baseName(name) + ".xlsx")
            "Exportar como PDF" -> lifecycleScope.launch {
                val out = FileUtil.newOutFile(this@SheetEditorActivity, FileUtil.baseName(name) + ".pdf")
                withContext(Dispatchers.IO) {
                    val f = FileUtil.newOutFile(this@SheetEditorActivity, FileUtil.baseName(name) + ".xlsx")
                    XlsxWriter.write(f, sheets.map { it.name to it.rows })
                    br.com.gooners.pdf.convert.DocumentConverter.toPdf(this@SheetEditorActivity, f, DocKind.XLSX, f.name, out, 0, true, 9f) { _, _ -> }
                }
                saver.showResult(listOf(out), "PDF gerado.")
            }
        }
    }

    private fun sortBy(desc: Boolean, header: Boolean) {
        val rows = sheet.rows
        val head = if (header && rows.isNotEmpty()) listOf(rows.removeAt(0)) else emptyList()
        val c = selC
        val cmp = Comparator<MutableList<String>> { a, b ->
            val x = a.getOrElse(c) { "" }; val y = b.getOrElse(c) { "" }
            val nx = XlsxWriter.number(x); val ny = XlsxWriter.number(y)
            when {
                x.isEmpty() && y.isEmpty() -> 0
                x.isEmpty() -> 1
                y.isEmpty() -> -1
                nx != null && ny != null -> nx.compareTo(ny)
                else -> x.compareTo(y, ignoreCase = true)
            }
        }
        val sorted = rows.sortedWith(if (desc) java.util.Collections.reverseOrder(cmp) else cmp)
        rows.clear(); rows.addAll(head); rows.addAll(sorted)
        dirty = true
        relayout()
        select(selR, selC)
    }

    private fun find(q: String) {
        if (q.isBlank()) return
        val start = selR * 100000 + selC
        val hits = ArrayList<Pair<Int, Int>>()
        sheet.rows.forEachIndexed { r, row -> row.forEachIndexed { c, v -> if (v.contains(q, true)) hits += r to c } }
        val next = hits.firstOrNull { it.first * 100000 + it.second > start } ?: hits.firstOrNull()
        if (next == null) { toast("Não encontrado"); return }
        select(next.first, next.second)
        (grid.layoutManager as LinearLayoutManager).scrollToPositionWithOffset(next.first + 1, dp(80))
        hscroll.post { hscroll.smoothScrollTo((headW + next.second * cellW - dp(40)).coerceAtLeast(0), 0) }
        toast("${hits.size} ocorrência(s)")
    }

    private fun save() {
        val u = uri
        when {
            u != null && kind == DocKind.CSV -> writeCsv(u)
            u != null && kind == DocKind.XLSX -> Dialogs.choose(this, "Salvar", listOf("Sobrescrever o arquivo original (.xlsx)", "Salvar uma cópia em XLSX…", "Salvar como CSV…")) { i ->
                when (i) { 0 -> writeXlsx(u); 1 -> saveXlsxAs.launch(FileUtil.baseName(name) + ".xlsx"); else -> saveCsvAs.launch(FileUtil.baseName(name) + ".csv") }
            }
            else -> Dialogs.choose(this, "Salvar como", listOf("Excel (.xlsx)", "CSV (.csv)")) { i ->
                if (i == 0) saveXlsxAs.launch(FileUtil.baseName(name) + ".xlsx") else saveCsvAs.launch(FileUtil.baseName(name) + ".csv")
            }
        }
    }

    private fun writeCsv(u: Uri) {
        val sep = if (kind == DocKind.CSV) csvSep else ';'
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching { (contentResolver.openOutputStream(u, "wt") ?: throw IllegalStateException()).use { it.write(XlsxWriter.csv(sheet.rows, sep).toByteArray(Charsets.UTF_8)) } }.isSuccess
            }
            if (ok) { dirty = false; toast("Planilha salva (CSV)") } else { toast("Sem permissão para salvar aqui"); saveCsvAs.launch(FileUtil.baseName(name) + ".csv") }
        }
    }

    private fun writeXlsx(u: Uri) {
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    val f = FileUtil.newOutFile(this@SheetEditorActivity, FileUtil.baseName(name) + ".xlsx")
                    XlsxWriter.write(f, sheets.map { it.name to it.rows })
                    FileUtil.writeTo(this@SheetEditorActivity, f, u)
                }.isSuccess
            }
            if (ok) { dirty = false; toast("Planilha salva (XLSX)") } else { toast("Sem permissão para salvar aqui"); saveXlsxAs.launch(FileUtil.baseName(name) + ".xlsx") }
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    // ------------------------------------------------------------------ grade
    private inner class RowAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        // a planilha ainda está carregando: grade vazia
        override fun getItemCount() = if (sheets.isEmpty()) 0 else sheet.rows.size + 60 + 1

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
            object : RecyclerView.ViewHolder(LinearLayout(parent.context).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, cellH)
            }) {}

        private fun cellView(row: LinearLayout, i: Int): TextView {
            while (row.childCount <= i) row.addView(TextView(row.context).apply {
                maxLines = 1; ellipsize = TextUtils.TruncateAt.END; gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(6), 0, dp(6), 0); textSize = 13f
            })
            return row.getChildAt(i) as TextView
        }

        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            val row = h.itemView as LinearLayout
            val border = ContextCompat.getDrawable(this@SheetEditorActivity, R.drawable.bg_cell)
            val selBg = ContextCompat.getDrawable(this@SheetEditorActivity, R.drawable.bg_cell_selected)
            val headBg = ContextCompat.getDrawable(this@SheetEditorActivity, R.drawable.bg_cell_header)
            while (row.childCount > cols + 1) row.removeViewAt(row.childCount - 1)
            for (i in 0..cols) {
                val tv = cellView(row, i)
                tv.layoutParams = LinearLayout.LayoutParams(if (i == 0) headW else cellW, cellH)
                if (pos == 0) {
                    tv.text = if (i == 0) "" else XlsxParser.colName(i - 1)
                    tv.gravity = Gravity.CENTER; tv.background = headBg?.constantState?.newDrawable(); tv.setTypeface(null, Typeface.BOLD)
                    tv.setOnClickListener(null)
                    continue
                }
                val r = pos - 1
                if (i == 0) {
                    tv.text = (r + 1).toString(); tv.gravity = Gravity.CENTER; tv.background = headBg?.constantState?.newDrawable(); tv.setTypeface(null, Typeface.BOLD)
                    tv.setOnClickListener { commit(); select(r, selC) }
                } else {
                    val c = i - 1
                    val v = value(r, c)
                    tv.text = v
                    tv.setTypeface(null, if (r == 0 && v.isNotEmpty()) Typeface.BOLD else Typeface.NORMAL)
                    tv.gravity = if (XlsxWriter.number(v) != null) Gravity.END or Gravity.CENTER_VERTICAL else Gravity.START or Gravity.CENTER_VERTICAL
                    tv.background = (if (r == selR && c == selC) selBg else border)?.constantState?.newDrawable()
                    tv.setOnClickListener { commit(); select(r, c) }
                }
            }
        }
    }
}
