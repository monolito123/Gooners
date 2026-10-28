package br.com.gooners.pdf.convert

import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.local

/** FictionBook (.fb2) -> HTML com imagens embutidas. */
object Fb2Parser {
    fun toHtml(xml: String): String {
        val binaries = HashMap<String, String>()
        var binId: String? = null
        var binType = ""
        val bin = StringBuilder()
        X.walk(xml, { p -> if (p.local() == "binary") { binId = p.attr("id"); binType = p.attr("content-type") ?: "image/jpeg"; bin.setLength(0) } },
            { p -> if (p.local() == "binary") { binId?.let { binaries[it] = "data:$binType;base64," + bin.toString().replace(Regex("\\s"), "") }; binId = null } },
            { t -> if (binId != null) bin.append(t) })

        val out = StringBuilder()
        var inBody = false
        var sectionDepth = 0
        var inTitle = false
        X.walk(xml, { p ->
            when (p.local()) {
                "body" -> inBody = true
                "binary" -> inBody = false
            }
            if (!inBody) return@walk
            when (p.local()) {
                "section" -> sectionDepth++
                "title" -> { inTitle = true; out.append("<h${(sectionDepth + 1).coerceIn(1, 4)}>") }
                "p" -> out.append(if (inTitle) "" else "<p>")
                "emphasis" -> out.append("<i>")
                "strong" -> out.append("<b>")
                "strikethrough" -> out.append("<s>")
                "epigraph", "cite" -> out.append("<blockquote>")
                "poem", "stanza" -> out.append("<div class=\"poem\">")
                "v" -> out.append("<div>")
                "subtitle" -> out.append("<h4>")
                "empty-line" -> out.append("<br>")
                "text-author" -> out.append("<p style=\"text-align:right\"><i>")
                "image" -> (p.attr("href"))?.removePrefix("#")?.let { binaries[it] }?.let { out.append("<img src=\"$it\">") }
            }
        }, { p ->
            if (!inBody) return@walk
            when (p.local()) {
                "body" -> inBody = false
                "section" -> sectionDepth--
                "title" -> { inTitle = false; out.append("</h${(sectionDepth + 1).coerceIn(1, 4)}>") }
                "p" -> out.append(if (inTitle) " " else "</p>")
                "emphasis" -> out.append("</i>")
                "strong" -> out.append("</b>")
                "strikethrough" -> out.append("</s>")
                "epigraph", "cite" -> out.append("</blockquote>")
                "poem", "stanza" -> out.append("</div>")
                "v" -> out.append("</div>")
                "subtitle" -> out.append("</h4>")
                "text-author" -> out.append("</i></p>")
            }
        }, { t -> if (inBody) out.append(X.esc(t)) })
        return out.toString()
    }
}
