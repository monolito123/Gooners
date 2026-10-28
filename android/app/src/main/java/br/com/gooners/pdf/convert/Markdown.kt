package br.com.gooners.pdf.convert

/** Conversor Markdown leve: títulos, ênfase, listas, citações, código, tabelas, links, imagens e linhas. */
object Markdown {

    private fun inline(s: String): String {
        var t = X.esc(s)
        val codes = ArrayList<String>()
        t = Regex("`([^`]+)`").replace(t) { codes += it.groupValues[1]; "\u0000${codes.size - 1}\u0000" }
        t = Regex("!\\[([^]]*)]\\(([^)\\s]+)[^)]*\\)").replace(t) { "<img alt=\"${it.groupValues[1]}\" src=\"${it.groupValues[2]}\">" }
        t = Regex("\\[([^]]+)]\\(([^)\\s]+)[^)]*\\)").replace(t) { "<a href=\"${it.groupValues[2]}\">${it.groupValues[1]}</a>" }
        t = Regex("\\*\\*(.+?)\\*\\*|__(.+?)__").replace(t) { "<b>${it.groupValues[1].ifEmpty { it.groupValues[2] }}</b>" }
        t = Regex("(?<![*\\w])\\*(?!\\s)(.+?)(?<!\\s)\\*(?!\\*)|(?<![_\\w])_(?!\\s)(.+?)(?<!\\s)_(?![_\\w])").replace(t) { "<i>${it.groupValues[1].ifEmpty { it.groupValues[2] }}</i>" }
        t = Regex("~~(.+?)~~").replace(t) { "<s>${it.groupValues[1]}</s>" }
        t = Regex("\u0000(\\d+)\u0000").replace(t) { "<code>${codes[it.groupValues[1].toInt()]}</code>" }
        return t
    }

    fun toHtml(md: String): String {
        val lines = md.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val out = StringBuilder()
        val para = StringBuilder()
        val listStack = ArrayList<String>()
        var i = 0

        fun flushPara() {
            if (para.isNotEmpty()) { out.append("<p>").append(inline(para.toString().trim())).append("</p>"); para.setLength(0) }
        }
        fun closeLists() { while (listStack.isNotEmpty()) out.append("</${listStack.removeAt(listStack.size - 1)}>") }

        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trim()
            when {
                trimmed.startsWith("```") || trimmed.startsWith("~~~") -> {
                    flushPara(); closeLists()
                    val fence = trimmed.take(3)
                    val code = StringBuilder()
                    i++
                    while (i < lines.size && !lines[i].trim().startsWith(fence)) { code.append(lines[i]).append('\n'); i++ }
                    out.append("<pre><code>").append(X.esc(code.toString())).append("</code></pre>")
                }
                trimmed.isEmpty() -> { flushPara(); closeLists() }
                Regex("^#{1,6}\\s").containsMatchIn(trimmed) -> {
                    flushPara(); closeLists()
                    val level = trimmed.takeWhile { it == '#' }.length
                    out.append("<h$level>").append(inline(trimmed.drop(level).trim().trimEnd('#').trim())).append("</h$level>")
                }
                Regex("^(\\*\\s*\\*\\s*\\*|-\\s*-\\s*-|_\\s*_\\s*_)[\\s*_-]*$").matches(trimmed) -> { flushPara(); closeLists(); out.append("<hr>") }
                trimmed.startsWith(">") -> {
                    flushPara(); closeLists()
                    val q = StringBuilder()
                    while (i < lines.size && lines[i].trim().startsWith(">")) { q.append(lines[i].trim().removePrefix(">").trim()).append('\n'); i++ }
                    out.append("<blockquote>").append(toHtml(q.toString())).append("</blockquote>")
                    continue
                }
                trimmed.startsWith("|") && i + 1 < lines.size && Regex("^\\|?\\s*:?-{2,}").containsMatchIn(lines[i + 1].trim()) -> {
                    flushPara(); closeLists()
                    fun cells(l: String) = l.trim().trim('|').split('|').map { it.trim() }
                    out.append("<table><tr>")
                    cells(line).forEach { out.append("<th>").append(inline(it)).append("</th>") }
                    out.append("</tr>")
                    i += 2
                    while (i < lines.size && lines[i].trim().startsWith("|")) {
                        out.append("<tr>"); cells(lines[i]).forEach { out.append("<td>").append(inline(it)).append("</td>") }; out.append("</tr>"); i++
                    }
                    out.append("</table>")
                    continue
                }
                Regex("^\\s*([-*+]|\\d+[.)])\\s+").containsMatchIn(line) -> {
                    flushPara()
                    val m = Regex("^(\\s*)([-*+]|\\d+[.)])\\s+(.*)").find(line)!!
                    val depth = m.groupValues[1].replace("\t", "    ").length / 2 + 1
                    val tag = if (m.groupValues[2][0].isDigit()) "ol" else "ul"
                    while (listStack.size > depth) out.append("</${listStack.removeAt(listStack.size - 1)}>")
                    while (listStack.size < depth) { out.append("<$tag>"); listStack += tag }
                    var item = m.groupValues[3]
                    item = item.replaceFirst(Regex("^\\[ ]\\s"), "☐ ").replaceFirst(Regex("^\\[[xX]]\\s"), "☑ ")
                    out.append("<li>").append(inline(item)).append("</li>")
                }
                line.startsWith("    ") || line.startsWith("\t") -> {
                    flushPara(); closeLists()
                    val code = StringBuilder()
                    while (i < lines.size && (lines[i].startsWith("    ") || lines[i].startsWith("\t") || lines[i].isBlank())) {
                        code.append(lines[i].removePrefix("    ").removePrefix("\t")).append('\n'); i++
                    }
                    out.append("<pre><code>").append(X.esc(code.toString().trimEnd())).append("</code></pre>")
                    continue
                }
                else -> {
                    closeLists()
                    if (line.endsWith("  ")) para.append(trimmed).append("<br>") else para.append(trimmed).append(' ')
                }
            }
            i++
        }
        flushPara(); closeLists()
        return out.toString().replace("&lt;br&gt;", "<br>")
    }
}
