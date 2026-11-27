package br.com.gooners.pdf.convert

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Grava planilhas como .xlsx (valores e textos; números reconhecidos nos formatos brasileiro e americano). */
object XlsxWriter {
    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
        .filter { it == '\t' || it == '\n' || it == '\r' || it >= ' ' }

    /** "1.234,56", "15,75", "10.5", "-3" -> número; demais textos continuam texto. */
    fun number(v: String): Double? {
        val s = v.trim().replace(" ", "")
        if (s.isEmpty() || s.length > 30 || !Regex("^[-+]?[\\d.,]+(e[-+]?\\d+)?%?$", RegexOption.IGNORE_CASE).matches(s)) return null
        val pct = s.endsWith("%")
        var t = s.removeSuffix("%")
        val lastComma = t.lastIndexOf(','); val lastDot = t.lastIndexOf('.')
        t = when {
            lastComma >= 0 && lastDot >= 0 -> if (lastComma > lastDot) t.replace(".", "").replace(',', '.') else t.replace(",", "")
            lastComma >= 0 -> if (t.count { it == ',' } == 1) t.replace(',', '.') else return null
            lastDot >= 0 && t.count { it == '.' } > 1 -> t.replace(".", "")
            else -> t
        }
        val d = t.toDoubleOrNull() ?: return null
        return if (pct) d / 100 else d
    }

    fun write(out: File, sheets: List<Pair<String, List<List<String>>>>) {
        val names = HashSet<String>()
        val clean = sheets.mapIndexed { i, (n, rows) ->
            var name = n.replace(Regex("[\\\\/?*\\[\\]:]"), " ").trim().take(31).ifEmpty { "Planilha${i + 1}" }
            while (!names.add(name.lowercase())) name = name.take(28) + "_${i + 1}"
            name to rows
        }
        ZipOutputStream(out.outputStream().buffered()).use { z ->
            fun put(path: String, s: String) { z.putNextEntry(ZipEntry(path)); z.write(s.toByteArray(Charsets.UTF_8)); z.closeEntry() }
            put("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>""" +
                clean.indices.joinToString("") { """<Override PartName="/xl/worksheets/sheet${it + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>""" } + "</Types>")
            put("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""")
            put("xl/workbook.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>""" +
                clean.mapIndexed { i, s -> """<sheet name="${esc(s.first)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>""" }.joinToString("") + "</sheets></workbook>")
            put("xl/_rels/workbook.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">""" +
                clean.indices.joinToString("") { """<Relationship Id="rId${it + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${it + 1}.xml"/>""" } +
                """<Relationship Id="rId${clean.size + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>""")
            put("xl/styles.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>""")
            clean.forEachIndexed { i, (_, rows) ->
                val sb = StringBuilder("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""")
                rows.forEachIndexed { r, row ->
                    if (row.all { it.isEmpty() }) return@forEachIndexed
                    sb.append("<row r=\"").append(r + 1).append("\">")
                    row.forEachIndexed { c, v ->
                        if (v.isEmpty()) return@forEachIndexed
                        val ref = XlsxParser.colName(c) + (r + 1)
                        val n = number(v)
                        if (n != null) sb.append("<c r=\"").append(ref).append("\"><v>").append(if (n % 1.0 == 0.0 && kotlin.math.abs(n) < 1e15) n.toLong().toString() else n.toString()).append("</v></c>")
                        else sb.append("<c r=\"").append(ref).append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">").append(esc(v)).append("</t></is></c>")
                    }
                    sb.append("</row>")
                }
                sb.append("</sheetData></worksheet>")
                put("xl/worksheets/sheet${i + 1}.xml", sb.toString())
            }
        }
    }

    fun csv(rows: List<List<String>>, sep: Char): String {
        val sb = StringBuilder()
        val last = rows.indexOfLast { r -> r.any { it.isNotEmpty() } }
        for (r in 0..last) {
            val row = rows[r]
            val end = row.indexOfLast { it.isNotEmpty() }
            sb.append((0..end).joinToString(sep.toString()) { c ->
                val v = row[c]
                if (v.contains(sep) || v.contains('"') || v.contains('\n') || v.contains('\r')) "\"" + v.replace("\"", "\"\"") + "\"" else v
            }).append("\r\n")
        }
        return sb.toString()
    }
}
