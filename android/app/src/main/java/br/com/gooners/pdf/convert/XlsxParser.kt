package br.com.gooners.pdf.convert

import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.local
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/** Excel (.xlsx) -> HTML com uma tabela por planilha (cabeçalhos A, B, C… e números de linha). */
object XlsxParser {
    private const val MAX_ROWS = 5000
    private const val MAX_COLS = 80

    class Sheet(val name: String, val rows: List<List<String>>)

    fun read(zip: ZipRes): List<Sheet> {
        val wb = "xl/workbook.xml"
        val wbXml = zip.text(wb) ?: throw IllegalArgumentException("Planilha inválida")
        val rels = X.rels(zip, wb)
        val sheets = ArrayList<Pair<String, String>>()
        X.walk(wbXml, { p ->
            if (p.local() == "sheet") {
                val name = p.attr("name") ?: "Planilha"
                val rid = p.attr("id") ?: return@walk
                rels[rid]?.let { sheets += name to it }
            }
        })
        val shared = sharedStrings(zip)
        val dateStyles = dateStyles(zip)
        return sheets.map { (name, path) -> Sheet(name, readSheet(zip.text(path) ?: "", shared, dateStyles)) }
    }

    fun toHtml(zip: ZipRes): String {
        val sheets = read(zip)
        val sb = StringBuilder()
        if (sheets.size > 1) {
            sb.append("<div class=\"tabs\">")
            sheets.forEachIndexed { i, s -> sb.append("<a href=\"#s$i\">${X.esc(s.name)}</a>") }
            sb.append("</div>")
        }
        sheets.forEachIndexed { i, s ->
            sb.append("<h3 class=\"sheet\" id=\"s$i\">${X.esc(s.name)}</h3>")
            sb.append(gridHtml(s.rows))
        }
        return sb.toString()
    }

    fun gridHtml(rows: List<List<String>>): String {
        if (rows.isEmpty()) return "<p><i>(planilha vazia)</i></p>"
        val cols = rows.maxOf { it.size }.coerceAtMost(MAX_COLS)
        val sb = StringBuilder("<table class=\"grid\"><tr><th></th>")
        for (c in 0 until cols) sb.append("<th>").append(colName(c)).append("</th>")
        sb.append("</tr>")
        rows.forEachIndexed { r, row ->
            sb.append("<tr><th>").append(r + 1).append("</th>")
            for (c in 0 until cols) {
                val v = row.getOrNull(c) ?: ""
                val num = v.isNotEmpty() && v.replace(".", "").replace(",", "").replace("-", "").replace("%", "").all { it.isDigit() }
                sb.append(if (num) "<td class=\"n\">" else "<td>").append(X.esc(v)).append("</td>")
            }
            sb.append("</tr>")
        }
        sb.append("</table>")
        return sb.toString()
    }

    fun colName(i: Int): String {
        var n = i + 1
        val sb = StringBuilder()
        while (n > 0) { val m = (n - 1) % 26; sb.insert(0, ('A' + m)); n = (n - 1) / 26 }
        return sb.toString()
    }

    private fun colIndex(ref: String): Int {
        var n = 0
        for (ch in ref) { if (!ch.isLetter()) break; n = n * 26 + (ch.uppercaseChar() - 'A' + 1) }
        return n - 1
    }

    private fun sharedStrings(zip: ZipRes): List<String> {
        val xml = zip.text("xl/sharedStrings.xml") ?: return emptyList()
        val out = ArrayList<String>()
        val cur = StringBuilder()
        var inT = false
        var inRph = false
        X.walk(xml, { p ->
            when (p.local()) { "si" -> cur.setLength(0); "t" -> inT = true; "rPh" -> inRph = true }
        }, { p ->
            when (p.local()) { "si" -> out += cur.toString(); "t" -> inT = false; "rPh" -> inRph = false }
        }, { t -> if (inT && !inRph) cur.append(t) })
        return out
    }

    /** Índices de estilos de célula cujo formato numérico é data/hora. */
    private fun dateStyles(zip: ZipRes): Set<Int> {
        val xml = zip.text("xl/styles.xml") ?: return emptySet()
        val customDate = HashSet<Int>()
        val out = HashSet<Int>()
        var inXfs = false
        var idx = 0
        X.walk(xml, { p ->
            when (p.local()) {
                "numFmt" -> {
                    val id = p.attr("numFmtId")?.toIntOrNull() ?: return@walk
                    val code = (p.attr("formatCode") ?: "").lowercase().replace(Regex("\\[[^]]*]|\"[^\"]*\""), "")
                    if ((code.contains('d') || code.contains('y') || (code.contains('m') && !code.contains('0'))) && !code.contains('#')) customDate += id
                }
                "cellXfs" -> { inXfs = true; idx = 0 }
                "xf" -> if (inXfs) {
                    val id = p.attr("numFmtId")?.toIntOrNull() ?: 0
                    if (id in 14..22 || id in 45..47 || id in customDate) out += idx
                    idx++
                }
            }
        }, { p -> if (p.local() == "cellXfs") inXfs = false })
        return out
    }

    private val numFmt = DecimalFormat("#,##0.##########", DecimalFormatSymbols(Locale("pt", "BR")))
    private val dateFmt = SimpleDateFormat("dd/MM/yyyy", Locale("pt", "BR")).apply { timeZone = TimeZone.getTimeZone("UTC") }
    private val dateTimeFmt = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR")).apply { timeZone = TimeZone.getTimeZone("UTC") }

    private fun formatNumber(v: String, isDate: Boolean): String {
        val d = v.toDoubleOrNull() ?: return v
        if (isDate && d > 0 && d < 2958466) {
            val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            cal.set(1899, Calendar.DECEMBER, 30, 0, 0, 0); cal.set(Calendar.MILLISECOND, 0)
            cal.timeInMillis += Math.round(d * 86400000.0)
            return if (d % 1.0 == 0.0) dateFmt.format(cal.time) else dateTimeFmt.format(cal.time)
        }
        return if (kotlin.math.abs(d) >= 1e15 || (d != 0.0 && kotlin.math.abs(d) < 1e-9)) v else numFmt.format(d)
    }

    private fun readSheet(xml: String, shared: List<String>, dates: Set<Int>): List<List<String>> {
        val rows = ArrayList<MutableList<String>>()
        var row: MutableList<String>? = null
        var rowIdx = -1
        var col = 0
        var type = ""
        var style = 0
        val value = StringBuilder()
        var inV = false
        var inIs = false
        var stop = false
        X.walk(xml, { p ->
            if (stop) return@walk
            when (p.local()) {
                "row" -> {
                    val r = (p.attr("r")?.toIntOrNull() ?: (rowIdx + 2)) - 1
                    if (r >= MAX_ROWS) { stop = true; return@walk }
                    while (rows.size < r) rows.add(ArrayList())
                    val nr = ArrayList<String>(); row = nr; rows.add(nr); rowIdx = r; col = 0
                }
                "c" -> {
                    col = p.attr("r")?.let { colIndex(it) } ?: col
                    type = p.attr("t") ?: ""
                    style = p.attr("s")?.toIntOrNull() ?: 0
                    value.setLength(0)
                }
                "v" -> inV = true
                "is" -> inIs = true
            }
        }, { p ->
            if (stop) return@walk
            when (p.local()) {
                "v" -> inV = false
                "is" -> inIs = false
                "c" -> {
                    val raw = value.toString()
                    val text = when (type) {
                        "s" -> shared.getOrNull(raw.trim().toIntOrNull() ?: -1) ?: ""
                        "b" -> if (raw == "1") "VERDADEIRO" else "FALSO"
                        "inlineStr", "str", "e" -> raw
                        else -> if (raw.isEmpty()) "" else formatNumber(raw, style in dates)
                    }
                    row?.let { r -> if (col < MAX_COLS) { while (r.size < col) r += ""; if (r.size == col) r += text else r[col] = text } }
                    col++
                }
            }
        }, { t -> if (inV || inIs) value.append(t) })
        // remove linhas vazias do fim
        while (rows.isNotEmpty() && rows.last().all { it.isEmpty() }) rows.removeAt(rows.size - 1)
        return rows
    }
}
