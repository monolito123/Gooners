package br.com.gooners.pdf.convert

import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.local

/** PowerPoint (.pptx) -> HTML: cada slide vira um cartão com título, tópicos, tabelas e imagens. */
object PptxParser {

    fun toHtml(zip: ZipRes, base: String): String {
        val pres = "ppt/presentation.xml"
        val xml = zip.text(pres) ?: throw IllegalArgumentException("Apresentação inválida")
        val rels = X.rels(zip, pres)
        val slides = ArrayList<String>()
        X.walk(xml, { p -> if (p.local() == "sldId") p.attr("id")?.let { rels[it] }?.let { slides += it } })
        if (slides.isEmpty()) slides += zip.entries().filter { it.matches(Regex("ppt/slides/slide\\d+\\.xml")) }
            .sortedBy { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
        val sb = StringBuilder()
        slides.forEachIndexed { i, path ->
            sb.append("<div class=\"slide\"><div class=\"slide-n\">Slide ${i + 1}</div>")
            zip.text(path)?.let { sb.append(slide(it, X.rels(zip, path), base)) }
            sb.append("</div>")
        }
        return sb.toString()
    }

    private fun slide(xml: String, rels: Map<String, String>, base: String): String {
        val out = StringBuilder()
        var isTitle = false
        var inTxBody = false
        var inTable = false
        val para = StringBuilder()
        var lvl = 0
        var bold = false
        var inT = false
        X.walk(xml, { p ->
            when (p.local()) {
                "sp" -> isTitle = false
                "ph" -> { val t = p.attr("type"); if (t == "title" || t == "ctrTitle") isTitle = true }
                "txBody" -> inTxBody = true
                "tbl" -> { inTable = true; out.append("<table>") }
                "tr" -> if (inTable) out.append("<tr>")
                "tc" -> if (inTable) out.append("<td>")
                "p" -> { para.setLength(0); lvl = 0 }
                "pPr" -> lvl = p.attr("lvl")?.toIntOrNull() ?: 0
                "rPr" -> bold = p.attr("b") == "1"
                "t" -> { inT = true; if (bold) para.append("<b>") }
                "br" -> para.append("<br>")
                "blip" -> p.attr("embed")?.let { rels[it] }?.let { out.append("<img src=\"$base${X.esc(it)}\">") }
            }
        }, { p ->
            when (p.local()) {
                "t" -> { inT = false; if (bold) para.append("</b>") }
                "r" -> bold = false
                "p" -> if (inTxBody || inTable) {
                    val c = para.toString()
                    if (c.isNotBlank()) when {
                        inTable -> out.append(c).append("<br>")
                        isTitle -> out.append("<h2>").append(c).append("</h2>")
                        else -> out.append("<p style=\"margin-left:${lvl * 1.4}em\">• ").append(c).append("</p>")
                    }
                }
                "txBody" -> inTxBody = false
                "tc" -> if (inTable) out.append("</td>")
                "tr" -> if (inTable) out.append("</tr>")
                "tbl" -> { inTable = false; out.append("</table>") }
            }
        }, { t -> if (inT) para.append(X.esc(t)) })
        return out.toString()
    }
}
