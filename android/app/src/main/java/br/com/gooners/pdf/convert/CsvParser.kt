package br.com.gooners.pdf.convert

/** CSV/TSV com aspas, quebras de linha em campos e detecção do separador (vírgula, ponto e vírgula, tab). */
object CsvParser {
    fun parse(text: String, maxRows: Int = 5000): List<List<String>> {
        val firstLine = text.lineSequence().firstOrNull() ?: ""
        val sep = listOf('\t', ';', ',', '|').maxByOrNull { c -> firstLine.count { it == c } } ?: ','
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>()
        val cell = StringBuilder()
        var quoted = false
        var i = 0
        while (i < text.length && rows.size < maxRows) {
            val c = text[i]
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length && text[i + 1] == '"') { cell.append('"'); i++ } else quoted = false
                } else cell.append(c)
            } else when (c) {
                '"' -> quoted = true
                sep -> { row += cell.toString(); cell.setLength(0) }
                '\n' -> { row += cell.toString(); cell.setLength(0); rows += row; row = ArrayList() }
                '\r' -> {}
                else -> cell.append(c)
            }
            i++
        }
        if (cell.isNotEmpty() || row.isNotEmpty()) { row += cell.toString(); rows += row }
        return rows
    }

    fun toHtml(text: String) = XlsxParser.gridHtml(parse(text))
}
