package br.com.gooners.pdf.convert

import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.attrQ

/** OpenDocument (ODT, ODS, ODP) -> HTML. Os três usam a mesma estrutura de content.xml. */
object OdfParser {
    private const val MAX_REPEAT = 50
    private const val MAX_ROWS = 3000

    fun toHtml(zip: ZipRes, base: String): String {
        val xml = zip.text("content.xml") ?: throw IllegalArgumentException("Documento OpenDocument inválido")
        val styles = HashMap<String, String>()
        zip.text("styles.xml")?.let { collectStyles(it, styles) }
        collectStyles(xml, styles)

        val out = StringBuilder()
        val tagStack = ArrayList<String>()
        var inBody = false
        var rows = 0
        var slide = 0
        var repeatCell = 1
        var cellStart = -1
        var skipRow = false
        var inNote = 0
        val isSheet = xml.contains("<office:spreadsheet")

        X.walk(xml, { p ->
            val q = p.name ?: ""
            if (q == "office:body") inBody = true
            if (!inBody) return@walk
            if (inNote > 0) { if (q == "text:note" || q == "office:annotation") inNote++; return@walk }
            val style = p.attrQ("text:style-name") ?: p.attrQ("table:style-name")
            val css = style?.let { styles[it] }?.let { " style=\"$it\"" } ?: ""
            when (q) {
                "text:note", "office:annotation" -> inNote = 1
                "text:h" -> {
                    val lvl = (p.attrQ("text:outline-level")?.toIntOrNull() ?: 1).coerceIn(1, 6)
                    out.append("<h$lvl$css>"); tagStack += "h$lvl"
                }
                "text:p" -> { out.append("<p$css>"); tagStack += "p" }
                "text:span" -> { out.append("<span$css>"); tagStack += "span" }
                "text:a" -> { out.append("<u style=\"color:#2563eb\">"); tagStack += "u" }
                "text:list" -> { out.append("<ul>"); tagStack += "ul" }
                "text:list-item", "text:list-header" -> { out.append("<li>"); tagStack += "li" }
                "text:s" -> out.append("&nbsp;".repeat((p.attrQ("text:c")?.toIntOrNull() ?: 1).coerceAtMost(40)))
                "text:tab" -> out.append("&emsp;")
                "text:line-break" -> out.append("<br>")
                "table:table" -> {
                    rows = 0
                    p.attrQ("table:name")?.let { if (isSheet) out.append("<h3 class=\"sheet\">${X.esc(it)}</h3>") }
                    out.append("<table>"); tagStack += "table"
                }
                "table:table-row" -> {
                    rows++
                    skipRow = rows > MAX_ROWS
                    if (!skipRow) { out.append("<tr>"); tagStack += "tr" } else tagStack += "-"
                }
                "table:table-cell", "table:covered-table-cell" -> {
                    if (skipRow) { tagStack += "-"; return@walk }
                    repeatCell = (p.attrQ("table:number-columns-repeated")?.toIntOrNull() ?: 1).coerceIn(1, MAX_REPEAT)
                    val span = p.attrQ("table:number-columns-spanned")?.toIntOrNull()?.takeIf { it > 1 }?.let { " colspan=\"$it\"" } ?: ""
                    cellStart = out.length
                    out.append("<td$span>"); tagStack += "td"
                }
                "draw:page" -> {
                    slide++
                    out.append("<div class=\"slide\"><div class=\"slide-n\">Slide $slide</div>"); tagStack += "div"
                }
                "draw:image" -> p.attr("href")?.let { if (!it.startsWith("http")) out.append("<img src=\"$base${X.esc(ZipRes.norm(it))}\">") }
                "presentation:notes" -> inNote = 1
            }
        }, { p ->
            val q = p.name ?: ""
            if (!inBody) return@walk
            if (inNote > 0) { if (q == "text:note" || q == "office:annotation" || q == "presentation:notes") inNote--; return@walk }
            when (q) {
                "text:h", "text:p", "text:span", "text:a", "text:list", "text:list-item", "text:list-header",
                "table:table", "table:table-row", "draw:page" -> pop(out, tagStack)
                "table:table-cell", "table:covered-table-cell" -> {
                    val t = tagStack.removeLastOrNull()
                    if (t == "td") {
                        out.append("</td>")
                        if (repeatCell > 1 && cellStart >= 0) {
                            val cell = out.substring(cellStart)
                            // células vazias repetidas no fim da linha não precisam aparecer
                            if (!cell.matches(Regex("<td[^>]*>(<p[^>]*></p>)*</td>"))) repeat(repeatCell - 1) { out.append(cell) }
                        }
                        repeatCell = 1; cellStart = -1
                    }
                }
            }
        }, { t -> if (inBody && inNote == 0) out.append(X.esc(t)) })
        return out.toString()
    }

    private fun pop(out: StringBuilder, stack: ArrayList<String>) {
        val t = stack.removeLastOrNull() ?: return
        if (t != "-") out.append("</$t>")
    }

    private fun collectStyles(xml: String, styles: HashMap<String, String>) {
        var cur: String? = null
        X.walk(xml, { p ->
            when (p.name) {
                "style:style" -> cur = p.attrQ("style:name")
                "style:text-properties" -> cur?.let { name ->
                    val css = StringBuilder()
                    if (p.attrQ("fo:font-weight") == "bold") css.append("font-weight:bold;")
                    if (p.attrQ("fo:font-style") == "italic") css.append("font-style:italic;")
                    p.attrQ("style:text-underline-style")?.let { if (it != "none") css.append("text-decoration:underline;") }
                    p.attrQ("style:text-line-through-style")?.let { if (it != "none") css.append("text-decoration:line-through;") }
                    p.attrQ("fo:color")?.let { css.append("color:$it;") }
                    p.attrQ("fo:font-size")?.let { if (it.endsWith("pt")) css.append("font-size:$it;") }
                    p.attrQ("fo:background-color")?.let { if (it != "transparent") css.append("background:$it;") }
                    if (css.isNotEmpty()) styles[name] = (styles[name] ?: "") + css
                }
                "style:paragraph-properties" -> cur?.let { name ->
                    p.attrQ("fo:text-align")?.let { a ->
                        val v = when (a) { "center" -> "center"; "end", "right" -> "right"; "justify" -> "justify"; else -> null }
                        if (v != null) styles[name] = (styles[name] ?: "") + "text-align:$v;"
                    }
                }
            }
        }, { p -> if (p.name == "style:style") cur = null })
    }
}

/** Planilhas OpenDocument (.ods) como linhas e colunas de texto, para o editor de planilhas. */
object OdsReader {
    fun sheets(zip: ZipRes, maxRows: Int = 20000, maxCols: Int = 200): List<XlsxParser.Sheet> {
        val xml = zip.text("content.xml") ?: throw IllegalArgumentException("Planilha OpenDocument inválida")
        val out = ArrayList<XlsxParser.Sheet>()
        var name = ""
        var rows = ArrayList<MutableList<String>>()
        var row: MutableList<String>? = null
        var rowRepeat = 1
        var cellRepeat = 1
        var cell: StringBuilder? = null
        var cellValue: String? = null
        var inP = 0
        X.walk(xml, { p ->
            when (p.name) {
                "table:table" -> { name = p.getAttributeValue(null, "table:name") ?: "Planilha ${out.size + 1}"; rows = ArrayList() }
                "table:table-row" -> { row = ArrayList(); rowRepeat = (p.getAttributeValue(null, "table:number-rows-repeated")?.toIntOrNull() ?: 1).coerceIn(1, 1000) }
                "table:table-cell", "table:covered-table-cell" -> {
                    cell = StringBuilder()
                    cellRepeat = (p.getAttributeValue(null, "table:number-columns-repeated")?.toIntOrNull() ?: 1).coerceIn(1, 1000)
                    cellValue = when (p.getAttributeValue(null, "office:value-type")) {
                        "float", "percentage", "currency" -> p.getAttributeValue(null, "office:value")
                        "date" -> p.getAttributeValue(null, "office:date-value")?.let { d ->
                            Regex("(\\d{4})-(\\d{2})-(\\d{2})").find(d)?.let { "${it.groupValues[3]}/${it.groupValues[2]}/${it.groupValues[1]}" } ?: d
                        }
                        "boolean" -> if (p.getAttributeValue(null, "office:boolean-value") == "true") "VERDADEIRO" else "FALSO"
                        else -> null
                    }
                }
                "text:p" -> { if ((cell?.length ?: 0) > 0) cell?.append('\n'); inP++ }
                "text:s" -> cell?.append(" ".repeat((p.getAttributeValue(null, "text:c")?.toIntOrNull() ?: 1).coerceAtMost(40)))
                "text:tab" -> cell?.append('\t')
                "text:line-break" -> cell?.append('\n')
            }
        }, { p ->
            when (p.name) {
                "text:p" -> inP--
                "table:table-cell", "table:covered-table-cell" -> {
                    val v = cellValue?.let { raw -> raw.toDoubleOrNull()?.let { XlsxParser.formatValue(it, false) } ?: raw } ?: cell?.toString().orEmpty()
                    row?.let { r -> repeat(cellRepeat) { if (r.size < maxCols) r += v } }
                    cell = null; cellValue = null
                }
                "table:table-row" -> row?.let { r ->
                    while (r.isNotEmpty() && r.last().isEmpty()) r.removeAt(r.size - 1)
                    repeat(if (r.isEmpty()) minOf(rowRepeat, 100) else rowRepeat) { if (rows.size < maxRows) rows += ArrayList(r) }
                    row = null
                }
                "table:table" -> {
                    while (rows.isNotEmpty() && rows.last().isEmpty()) rows.removeAt(rows.size - 1)
                    out += XlsxParser.Sheet(name, rows)
                }
            }
        }, { t -> if (inP > 0) cell?.append(t) })
        return out
    }
}
