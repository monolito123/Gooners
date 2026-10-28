package br.com.gooners.pdf.convert

import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.local

/** Livro EPUB 2/3: capítulos na ordem de leitura (spine) e sumário (nav.xhtml ou toc.ncx). */
class EpubBook(val zip: ZipRes) {
    class TocEntry(val title: String, val chapter: Int, val level: Int)

    var title = ""
        private set
    val chapters = ArrayList<String>()
    val toc = ArrayList<TocEntry>()

    init {
        val container = zip.text("META-INF/container.xml") ?: throw IllegalArgumentException("EPUB inválido")
        var opfPath = ""
        X.walk(container, { p -> if (p.local() == "rootfile" && opfPath.isEmpty()) opfPath = p.attr("full-path") ?: "" })
        val opf = zip.text(opfPath) ?: throw IllegalArgumentException("EPUB sem OPF")
        val manifest = HashMap<String, Pair<String, String>>()
        var navHref: String? = null
        var ncxId: String? = null
        val spine = ArrayList<String>()
        var inTitle = false
        X.walk(opf, { p ->
            when (p.local()) {
                "title" -> if (title.isEmpty()) inTitle = true
                "item" -> {
                    val id = p.attr("id") ?: return@walk
                    val href = ZipRes.resolve(opfPath, java.net.URLDecoder.decode(p.attr("href") ?: "", "UTF-8"))
                    manifest[id] = href to (p.attr("media-type") ?: "")
                    if (p.attr("properties")?.split(' ')?.contains("nav") == true) navHref = href
                }
                "spine" -> ncxId = p.attr("toc")
                "itemref" -> p.attr("idref")?.let { spine += it }
            }
        }, { p -> if (p.local() == "title") inTitle = false }, { t -> if (inTitle) title += t.trim() })
        spine.mapNotNullTo(chapters) { id -> manifest[id]?.first }
        if (chapters.isEmpty()) manifest.values.filter { it.second.contains("html") }.mapTo(chapters) { it.first }
        try {
            val nav = navHref
            val ncx = ncxId?.let { manifest[it]?.first } ?: manifest.values.firstOrNull { it.second.contains("ncx") }?.first
            if (nav != null) readNav(nav) else if (ncx != null) readNcx(ncx)
        } catch (_: Exception) {
        }
        if (toc.isEmpty()) chapters.forEachIndexed { i, c -> toc += TocEntry("Capítulo ${i + 1} · ${c.substringAfterLast('/')}", i, 0) }
    }

    private fun chapterOf(path: String, href: String): Int {
        val target = ZipRes.resolve(path, href.substringBefore('#').let { java.net.URLDecoder.decode(it, "UTF-8") })
        return chapters.indexOf(target)
    }

    private fun readNav(path: String) {
        val xml = zip.text(path) ?: return
        var inToc = false
        var depth = 0
        var href: String? = null
        val text = StringBuilder()
        X.walk(xml, { p ->
            when (p.local()) {
                "nav" -> if (p.attr("type") == "toc" || !inToc && toc.isEmpty()) inToc = true
                "ol" -> if (inToc) depth++
                "a" -> if (inToc) { href = p.attr("href"); text.setLength(0) }
            }
        }, { p ->
            when (p.local()) {
                "nav" -> inToc = false
                "ol" -> if (inToc) depth--
                "a" -> if (inToc) href?.let { h ->
                    val ch = chapterOf(path, h)
                    if (ch >= 0) toc += TocEntry(text.toString().trim(), ch, (depth - 1).coerceAtLeast(0))
                    href = null
                }
            }
        }, { t -> if (href != null) text.append(t) })
    }

    private fun readNcx(path: String) {
        val xml = zip.text(path) ?: return
        var depth = 0
        var label = StringBuilder()
        var inText = false
        X.walk(xml, { p ->
            when (p.local()) {
                "navPoint" -> { depth++; label = StringBuilder() }
                "text" -> inText = true
                "content" -> p.attr("src")?.let { src ->
                    val ch = chapterOf(path, src)
                    if (ch >= 0) toc += TocEntry(label.toString().trim(), ch, depth - 1)
                }
            }
        }, { p -> when (p.local()) { "navPoint" -> depth--; "text" -> inText = false } }, { t -> if (inText) label.append(t) })
    }

    /** Todo o livro em um HTML só (para conversão em PDF), com imagens apontando para o ZIP. */
    fun combinedHtml(base: String): String {
        val sb = StringBuilder()
        chapters.forEachIndexed { i, ch ->
            val html = zip.text(ch) ?: return@forEachIndexed
            val body = Regex("<body[^>]*>(.*)</body>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)).find(html)?.groupValues?.get(1) ?: html
            val fixed = Regex("(src|xlink:href|href)=\"([^\"#:]+)\"").replace(body) { m ->
                "${m.groupValues[1]}=\"$base${ZipRes.resolve(ch, m.groupValues[2])}\""
            }
            if (i > 0) sb.append("<hr class=\"pb\">")
            sb.append(fixed)
        }
        return sb.toString()
    }
}
