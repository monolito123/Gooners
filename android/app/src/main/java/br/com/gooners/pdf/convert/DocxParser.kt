package br.com.gooners.pdf.convert

import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.local

/** Word (.docx) -> HTML: parágrafos, títulos, listas, tabelas, imagens e formatação de texto. */
object DocxParser {

    fun toHtml(zip: ZipRes, base: String): String {
        val docPath = "word/document.xml"
        val xml = zip.text(docPath) ?: throw IllegalArgumentException("Documento Word inválido")
        val rels = X.rels(zip, docPath)
        val headings = styleHeadings(zip)
        val styleLists = styleNumbering(zip)
        val ordered = numberingOrdered(zip)

        val out = StringBuilder()
        val para = StringBuilder()
        var pStyle = ""
        var align: String? = null
        var listNum: String? = null
        var listOpen: String? = null
        var inPPr = false
        var inRPr = false
        var inRun = false
        var inText = false
        var inInstr = false
        var bold = false; var italic = false; var under = false; var strike = false
        var color: String? = null; var size: String? = null; var highlight: String? = null; var vert: String? = null
        var linkStack = 0

        fun runOpen(): String {
            val css = StringBuilder()
            if (color != null && color != "auto") css.append("color:#$color;")
            if (size != null) size!!.toIntOrNull()?.let { css.append("font-size:${it / 2f}pt;") }
            if (highlight != null && highlight != "none") css.append("background:${highlight};")
            if (under) css.append("text-decoration:underline;")
            if (strike) css.append("text-decoration:line-through;")
            val sb = StringBuilder()
            if (css.isNotEmpty()) sb.append("<span style=\"$css\">")
            if (bold) sb.append("<b>")
            if (italic) sb.append("<i>")
            if (vert == "superscript") sb.append("<sup>") else if (vert == "subscript") sb.append("<sub>")
            return sb.toString()
        }

        fun runClose(): String {
            val sb = StringBuilder()
            if (vert == "superscript") sb.append("</sup>") else if (vert == "subscript") sb.append("</sub>")
            if (italic) sb.append("</i>")
            if (bold) sb.append("</b>")
            if (color != null && color != "auto" || size != null || (highlight != null && highlight != "none") || under || strike) sb.append("</span>")
            return sb.toString()
        }

        fun closeList() { listOpen?.let { out.append("</$it>") }; listOpen = null }

        X.walk(xml, { p ->
            when (p.local()) {
                "p" -> { para.setLength(0); pStyle = ""; align = null; listNum = null }
                "pPr" -> inPPr = true
                "pStyle" -> if (inPPr) pStyle = p.attr("val") ?: ""
                "jc" -> if (inPPr) align = when (p.attr("val")) { "center" -> "center"; "right", "end" -> "right"; "both", "distribute" -> "justify"; else -> null }
                "numId" -> if (inPPr) listNum = p.attr("val")
                "r" -> { inRun = true; bold = false; italic = false; under = false; strike = false; color = null; size = null; highlight = null; vert = null }
                "rPr" -> inRPr = true
                "b" -> if (inRPr && inRun) bold = p.attr("val").let { it == null || it == "1" || it == "true" }
                "i" -> if (inRPr && inRun) italic = p.attr("val").let { it == null || it == "1" || it == "true" }
                "u" -> if (inRPr && inRun) under = p.attr("val") != "none"
                "strike", "dstrike" -> if (inRPr && inRun) strike = p.attr("val").let { it == null || it == "1" || it == "true" }
                "color" -> if (inRPr && inRun) color = p.attr("val")
                "sz" -> if (inRPr && inRun) size = p.attr("val")
                "highlight" -> if (inRPr && inRun) highlight = p.attr("val")
                "vertAlign" -> if (inRPr && inRun) vert = p.attr("val")
                "t" -> if (inRun) { inText = true; para.append(runOpen()) }
                "instrText" -> inInstr = true
                "tab" -> if (inRun && !inPPr) para.append("&emsp;")
                "br" -> if (inRun) para.append(if (p.attr("type") == "page") "<hr class=\"pb\">" else "<br>")
                "cr" -> if (inRun) para.append("<br>")
                "sym" -> if (inRun) p.attr("char")?.toIntOrNull(16)?.let { para.append("&#${if (it >= 0xF000) it - 0xF000 else it};") }
                "blip" -> p.attr("embed")?.let { rels[it] }?.let { para.append("<img src=\"$base${X.esc(it)}\">") }
                "imagedata" -> p.attr("id")?.let { rels[it] }?.let { para.append("<img src=\"$base${X.esc(it)}\">") }
                "hyperlink" -> { linkStack++; para.append("<u style=\"color:#2563eb\">") }
                "tbl" -> { closeList(); out.append("<table>") }
                "tr" -> out.append("<tr>")
                "tc" -> out.append("<td>")
                "gridSpan" -> {
                    // ajusta o colspan da célula aberta
                    val n = p.attr("val")?.toIntOrNull() ?: 1
                    val idx = out.lastIndexOf("<td>")
                    if (n > 1 && idx >= 0) out.replace(idx, idx + 4, "<td colspan=\"$n\">")
                }
            }
        }, { p ->
            when (p.local()) {
                "pPr" -> inPPr = false
                "rPr" -> inRPr = false
                "r" -> inRun = false
                "t" -> if (inText) { inText = false; para.append(runClose()) }
                "instrText" -> inInstr = false
                "hyperlink" -> if (linkStack > 0) { linkStack--; para.append("</u>") }
                "p" -> {
                    val content = para.toString()
                    val h = headings[pStyle] ?: headingFromName(pStyle)
                    val style = align?.let { " style=\"text-align:$it\"" } ?: ""
                    // a lista pode vir do estilo do parágrafo (ex.: "List Bullet") em vez do próprio parágrafo
                    if (listNum == null) listNum = styleLists[pStyle]
                    if (listNum != null && listNum != "0" && h == 0) {
                        val tag = if (ordered[listNum] == true) "ol" else "ul"
                        if (listOpen != tag) { closeList(); out.append("<$tag>"); listOpen = tag }
                        out.append("<li$style>").append(content).append("</li>")
                    } else {
                        closeList()
                        when {
                            h in 1..6 -> out.append("<h$h$style>").append(content).append("</h$h>")
                            content.isEmpty() -> out.append("<p>&nbsp;</p>")
                            else -> out.append("<p$style>").append(content).append("</p>")
                        }
                    }
                    para.setLength(0)
                }
                "tc" -> out.append("</td>")
                "tr" -> out.append("</tr>")
                "tbl" -> out.append("</table>")
            }
        }, { t -> if (inText && !inInstr) para.append(X.esc(t)) })
        closeList()
        return out.toString()
    }

    private fun headingFromName(id: String): Int {
        val l = id.lowercase()
        if (l == "title" || l == "ttulo" || l == "titulo") return 1
        val m = Regex("(heading|ttulo|titulo|berschrift|titre|encabezado)\\s*(\\d)").find(l) ?: return 0
        return m.groupValues[2].toInt().coerceIn(1, 6)
    }

    /** styleId -> nível de título, lendo os nomes em styles.xml (os ids mudam conforme o idioma do Word). */
    private fun styleHeadings(zip: ZipRes): Map<String, Int> {
        val xml = zip.text("word/styles.xml") ?: return emptyMap()
        val out = HashMap<String, Int>()
        var cur: String? = null
        X.walk(xml, { p ->
            when (p.local()) {
                "style" -> cur = p.attr("styleId")
                "name" -> cur?.let { id ->
                    val n = (p.attr("val") ?: "").lowercase()
                    when {
                        n == "title" -> out[id] = 1
                        n.startsWith("heading ") -> n.removePrefix("heading ").trim().toIntOrNull()?.let { out[id] = it.coerceIn(1, 6) }
                    }
                }
                "outlineLvl" -> cur?.let { id -> if (!out.containsKey(id)) p.attr("val")?.toIntOrNull()?.let { if (it < 6) out[id] = it + 1 } }
            }
        }, { p -> if (p.local() == "style") cur = null })
        return out
    }

    /** styleId -> numId para estilos de parágrafo que já são listas. */
    private fun styleNumbering(zip: ZipRes): Map<String, String> {
        val xml = zip.text("word/styles.xml") ?: return emptyMap()
        val out = HashMap<String, String>()
        var cur: String? = null
        X.walk(xml, { p ->
            when (p.local()) {
                "style" -> cur = p.attr("styleId")
                "numId" -> cur?.let { id -> p.attr("val")?.let { out[id] = it } }
            }
        }, { p -> if (p.local() == "style") cur = null })
        return out
    }

    /** numId -> lista numerada? (senão, marcadores) */
    private fun numberingOrdered(zip: ZipRes): Map<String, Boolean> {
        val xml = zip.text("word/numbering.xml") ?: return emptyMap()
        val abstractOrdered = HashMap<String, Boolean>()
        val numToAbs = HashMap<String, String>()
        var curAbs: String? = null
        var curNum: String? = null
        var lvl0 = false
        X.walk(xml, { p ->
            when (p.local()) {
                "abstractNum" -> curAbs = p.attr("abstractNumId")
                "lvl" -> lvl0 = p.attr("ilvl") == "0"
                "numFmt" -> if (lvl0 && curAbs != null) abstractOrdered[curAbs!!] = p.attr("val") != "bullet" && p.attr("val") != "none"
                "num" -> curNum = p.attr("numId")
                "abstractNumId" -> if (curNum != null) numToAbs[curNum!!] = p.attr("val") ?: ""
            }
        }, { p -> when (p.local()) { "abstractNum" -> curAbs = null; "num" -> curNum = null; "lvl" -> lvl0 = false } })
        return numToAbs.mapValues { abstractOrdered[it.value] == true }
    }
}
