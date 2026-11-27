package br.com.gooners.pdf.convert

import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.local
import br.com.gooners.pdf.util.FileUtil
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** XPS/OpenXPS: cada página fixa vira um SVG (caminhos, textos e imagens). */
object XpsParser {
    private fun color(c: String?): String? {
        if (c == null) return null
        val s = c.trim()
        if (!s.startsWith("#")) return if (s.startsWith("sc#")) null else s
        val h = s.substring(1)
        return when (h.length) {
            8 -> { val a = h.substring(0, 2).toInt(16) / 255f; "rgba(${h.substring(2, 4).toInt(16)},${h.substring(4, 6).toInt(16)},${h.substring(6, 8).toInt(16)},${"%.3f".format(Locale.US, a)})" }
            6 -> "#$h"
            else -> null
        }
    }

    private fun matrix(m: String?): String? {
        val v = m?.split(',', ' ')?.filter { it.isNotBlank() }?.mapNotNull { it.toDoubleOrNull() } ?: return null
        return if (v.size == 6) "matrix(${v.joinToString(" ")})" else null
    }

    fun toHtml(zip: ZipRes): String {
        val entries = zip.entries()
        val fdseq = X.rels(zip, "").values.firstOrNull { it.endsWith(".fdseq", true) } ?: entries.firstOrNull { it.endsWith(".fdseq", true) }
        val docs = ArrayList<String>()
        fdseq?.let { seq -> zip.text(seq)?.let { xml -> X.walk(xml, { p -> if (p.local() == "DocumentReference") p.attr("Source")?.let { docs += ZipRes.resolve(seq, it) } }) } }
        if (docs.isEmpty()) docs += entries.filter { it.endsWith(".fdoc", true) }.sorted()
        val pages = ArrayList<String>()
        for (d in docs) zip.text(d)?.let { xml -> X.walk(xml, { p -> if (p.local() == "PageContent") p.attr("Source")?.let { pages += ZipRes.resolve(d, it) } }) }
        if (pages.isEmpty()) pages += entries.filter { it.endsWith(".fpage", true) }.sortedBy { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
        val sb = StringBuilder()
        pages.forEachIndexed { i, pg -> zip.text(pg)?.let { sb.append(page(it, pg, i + 1)) } }
        if (pages.isEmpty()) sb.append("<p><i>(nenhuma página encontrada)</i></p>")
        return sb.toString()
    }

    private fun page(xml: String, path: String, n: Int): String {
        val sb = StringBuilder()
        var w = 816.0; var h = 1056.0
        val stack = ArrayList<String>()
        var pendingPath: MutableMap<String, String>? = null
        X.walk(xml, { p ->
            when (p.local()) {
                "FixedPage" -> {
                    w = p.attr("Width")?.toDoubleOrNull() ?: w; h = p.attr("Height")?.toDoubleOrNull() ?: h
                    sb.append("<div class=\"slide-n\">Página $n</div><svg class=\"xps\" viewBox=\"0 0 $w $h\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">")
                    sb.append("<rect width=\"$w\" height=\"$h\" fill=\"#fff\"/>")
                }
                "Canvas" -> {
                    val t = matrix(p.attr("RenderTransform"))
                    val op = p.attr("Opacity")
                    sb.append("<g").append(t?.let { " transform=\"$it\"" } ?: "").append(op?.let { " opacity=\"$it\"" } ?: "").append(">")
                    stack += "g"
                }
                "Path" -> {
                    val m = HashMap<String, String>()
                    for (k in listOf("Data", "Fill", "Stroke", "StrokeThickness", "RenderTransform", "Opacity")) p.attr(k)?.let { m[k] = it }
                    pendingPath = m
                }
                "PathGeometry" -> pendingPath?.let { m -> p.attr("Figures")?.let { m["Data"] = it } }
                "SolidColorBrush" -> pendingPath?.let { m -> p.attr("Color")?.let { if (!m.containsKey("Fill")) m["Fill"] = it } }
                "ImageBrush" -> pendingPath?.let { m ->
                    p.attr("ImageSource")?.let { m["Image"] = ZipRes.resolve(path, it) }
                    p.attr("Viewport")?.let { m["Viewport"] = it }
                }
                "Glyphs" -> {
                    val text = p.attr("UnicodeString")?.removePrefix("{}") ?: return@walk
                    val x = p.attr("OriginX") ?: "0"; val y = p.attr("OriginY") ?: "0"
                    val size = p.attr("FontRenderingEmSize") ?: "12"
                    val fill = color(p.attr("Fill")) ?: "#000"
                    val t = matrix(p.attr("RenderTransform"))
                    sb.append("<text x=\"$x\" y=\"$y\" font-size=\"$size\" fill=\"$fill\" font-family=\"sans-serif\"")
                    t?.let { sb.append(" transform=\"$it\"") }
                    sb.append(">").append(X.esc(text)).append("</text>")
                }
            }
        }, { p ->
            when (p.local()) {
                "Canvas" -> if (stack.isNotEmpty()) { stack.removeAt(stack.size - 1); sb.append("</g>") }
                "Path" -> pendingPath?.let { m -> sb.append(pathSvg(m)); pendingPath = null }
                "FixedPage" -> { while (stack.isNotEmpty()) { stack.removeAt(stack.size - 1); sb.append("</g>") }; sb.append("</svg>") }
            }
        })
        return sb.toString()
    }

    private fun pathSvg(m: Map<String, String>): String {
        val t = matrix(m["RenderTransform"])?.let { " transform=\"$it\"" } ?: ""
        val img = m["Image"]
        if (img != null) {
            val vp = m["Viewport"]?.split(',', ' ')?.filter { it.isNotBlank() }?.mapNotNull { it.toDoubleOrNull() }
            if (vp != null && vp.size == 4) {
                return "<image$t x=\"${vp[0]}\" y=\"${vp[1]}\" width=\"${vp[2]}\" height=\"${vp[3]}\" preserveAspectRatio=\"none\" " +
                    "xlink:href=\"${DocumentConverter.BASE}${X.esc(img)}\" href=\"${DocumentConverter.BASE}${X.esc(img)}\"/>"
            }
        }
        var d = m["Data"] ?: return ""
        var rule = "nonzero"
        d = d.trim()
        if (d.startsWith("F0")) { rule = "evenodd"; d = d.substring(2) } else if (d.startsWith("F1")) d = d.substring(2)
        val fill = color(m["Fill"]) ?: "none"
        val stroke = color(m["Stroke"])
        val sb = StringBuilder("<path$t d=\"").append(X.esc(d)).append("\" fill=\"").append(fill).append("\" fill-rule=\"").append(rule).append("\"")
        if (stroke != null) sb.append(" stroke=\"").append(stroke).append("\" stroke-width=\"").append(m["StrokeThickness"] ?: "1").append("\"")
        m["Opacity"]?.let { sb.append(" opacity=\"").append(it).append("\"") }
        return sb.append("/>").toString()
    }
}

/** Notebook Jupyter (.ipynb): células de texto, código e saídas (texto, tabelas HTML e gráficos). */
object Notebook {
    private fun src(v: Any?): String = when (v) {
        is JSONArray -> (0 until v.length()).joinToString("") { v.optString(it) }
        null -> ""
        else -> v.toString()
    }

    private val ansi = Regex("\\u001B\\[[0-9;]*[A-Za-z]")

    fun toHtml(text: String): String {
        val nb = JSONObject(text)
        val cells = nb.optJSONArray("cells") ?: nb.optJSONArray("worksheets")?.optJSONObject(0)?.optJSONArray("cells") ?: JSONArray()
        val lang = nb.optJSONObject("metadata")?.optJSONObject("kernelspec")?.optString("language") ?: "python"
        val sb = StringBuilder("<div class=\"note\">Notebook Jupyter · ${cells.length()} células · linguagem: ${X.esc(lang)}</div>")
        for (i in 0 until cells.length()) {
            val c = cells.optJSONObject(i) ?: continue
            val source = src(c.opt("source") ?: c.opt("input"))
            when (c.optString("cell_type")) {
                "markdown" -> sb.append("<div class=\"md\">").append(Markdown.toHtml(source)).append("</div>")
                "code" -> {
                    val n = c.opt("execution_count")?.takeIf { it != JSONObject.NULL } ?: c.opt("prompt_number")?.takeIf { it != JSONObject.NULL } ?: " "
                    sb.append("<div class=\"cell\"><div class=\"in\">In [").append(n).append("]:</div><pre><code>").append(X.esc(source)).append("</code></pre>")
                    val outs = c.optJSONArray("outputs") ?: JSONArray()
                    for (k in 0 until outs.length()) {
                        val o = outs.optJSONObject(k) ?: continue
                        when (o.optString("output_type")) {
                            "stream" -> sb.append("<pre class=\"out\">").append(X.esc(src(o.opt("text")))).append("</pre>")
                            "error", "pyerr" -> sb.append("<pre class=\"out err\">").append(X.esc(ansi.replace(
                                (o.optJSONArray("traceback")?.let { tb -> (0 until tb.length()).joinToString("\n") { tb.optString(it) } }
                                    ?: (o.optString("ename") + ": " + o.optString("evalue"))), ""))).append("</pre>")
                            else -> {
                                val data = o.optJSONObject("data") ?: o
                                when {
                                    data.has("image/png") -> sb.append("<img src=\"data:image/png;base64,").append(src(data.opt("image/png")).replace("\n", "")).append("\">")
                                    data.has("png") -> sb.append("<img src=\"data:image/png;base64,").append(src(data.opt("png")).replace("\n", "")).append("\">")
                                    data.has("image/jpeg") -> sb.append("<img src=\"data:image/jpeg;base64,").append(src(data.opt("image/jpeg")).replace("\n", "")).append("\">")
                                    data.has("image/svg+xml") -> sb.append(src(data.opt("image/svg+xml")))
                                    data.has("text/html") -> sb.append("<div class=\"out\">").append(MailHtml.cleanHtml(src(data.opt("text/html")))).append("</div>")
                                    data.has("text/markdown") -> sb.append(Markdown.toHtml(src(data.opt("text/markdown"))))
                                    data.has("text/plain") -> sb.append("<pre class=\"out\">").append(X.esc(src(data.opt("text/plain")))).append("</pre>")
                                    data.has("text") -> sb.append("<pre class=\"out\">").append(X.esc(src(data.opt("text")))).append("</pre>")
                                }
                            }
                        }
                    }
                    sb.append("</div>")
                }
                else -> sb.append("<pre>").append(X.esc(source)).append("</pre>")
            }
        }
        return sb.toString()
    }
}

/** Linhas de vCard/iCalendar (desdobra continuações e quoted-printable). */
private object Lines {
    class Prop(val name: String, val params: Map<String, String>, val value: String)

    fun parse(text: String): List<Prop> {
        val raw = text.replace("\r\n", "\n").replace('\r', '\n')
        val joined = ArrayList<String>()
        for (line in raw.split('\n')) {
            if ((line.startsWith(" ") || line.startsWith("\t")) && joined.isNotEmpty()) joined[joined.size - 1] = joined.last() + line.substring(1)
            else if (joined.isNotEmpty() && joined.last().endsWith("=") && joined.last().contains("QUOTED-PRINTABLE", true)) joined[joined.size - 1] = joined.last().dropLast(1) + line
            else joined += line
        }
        return joined.filter { it.contains(':') }.map { l ->
            val colon = l.indexOf(':')
            val left = l.substring(0, colon)
            var value = l.substring(colon + 1)
            val parts = left.split(';')
            val name = parts[0].substringAfter('.').uppercase()
            val params = HashMap<String, String>()
            for (p in parts.drop(1)) {
                if (p.contains('=')) params[p.substringBefore('=').uppercase()] = p.substringAfter('=').trim('"')
                else params["TYPE"] = params["TYPE"]?.let { "$it,$p" } ?: p
            }
            if (params["ENCODING"].equals("QUOTED-PRINTABLE", true)) value = String(Mime.qp(value.toByteArray(Charsets.ISO_8859_1)), Mime.charset(params["CHARSET"] ?: "utf-8"))
            Prop(name, params, value)
        }
    }

    fun unescape(s: String) = s.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
}

/** Contatos (.vcf). */
object VCard {
    fun toHtml(text: String): String {
        val props = Lines.parse(text)
        val cards = ArrayList<List<Lines.Prop>>()
        var cur: MutableList<Lines.Prop>? = null
        for (p in props) {
            when {
                p.name == "BEGIN" && p.value.equals("VCARD", true) -> cur = ArrayList()
                p.name == "END" && p.value.equals("VCARD", true) -> { cur?.let { cards += it }; cur = null }
                else -> cur?.add(p)
            }
        }
        val sb = StringBuilder("<div class=\"note\">${cards.size} contato(s)</div>")
        for (c in cards) {
            fun first(n: String) = c.firstOrNull { it.name == n }?.value?.let { Lines.unescape(it) }
            val name = first("FN") ?: first("N")?.split(';')?.let { listOf(it.getOrNull(1), it.getOrNull(0)).filterNotNull().joinToString(" ").trim() } ?: "(sem nome)"
            val photo = c.firstOrNull { it.name == "PHOTO" }
            sb.append("<div class=\"card\"><div class=\"avatar\">")
            if (photo != null && (photo.params["ENCODING"]?.lowercase() in setOf("b", "base64") || photo.value.startsWith("data:"))) {
                val src = if (photo.value.startsWith("data:")) photo.value else "data:image/${(photo.params["TYPE"] ?: "jpeg").lowercase().substringBefore(',')};base64," + photo.value.replace(" ", "")
                sb.append("<img src=\"").append(X.esc(src)).append("\">")
            } else sb.append(X.esc(name.take(1).uppercase()))
            sb.append("</div><div><b>").append(X.esc(name)).append("</b>")
            first("ORG")?.let { sb.append("<br><small>").append(X.esc(it.replace(';', ' ').trim())).append(first("TITLE")?.let { t -> " · " + X.esc(t) } ?: "").append("</small>") }
            sb.append("<ul>")
            for (p in c) {
                val v = Lines.unescape(p.value)
                val type = p.params["TYPE"]?.lowercase()?.replace(",", ", ")?.let { " <small>($it)</small>" } ?: ""
                when (p.name) {
                    "TEL" -> sb.append("<li>📞 <a href=\"tel:").append(X.esc(v.replace(" ", ""))).append("\">").append(X.esc(v)).append("</a>$type</li>")
                    "EMAIL" -> sb.append("<li>✉ <a href=\"mailto:").append(X.esc(v)).append("\">").append(X.esc(v)).append("</a>$type</li>")
                    "ADR" -> sb.append("<li>📍 ").append(X.esc(v.split(';').filter { it.isNotBlank() }.joinToString(", "))).append("$type</li>")
                    "URL" -> sb.append("<li>🔗 <a href=\"").append(X.esc(v)).append("\">").append(X.esc(v)).append("</a></li>")
                    "BDAY" -> sb.append("<li>🎂 ").append(X.esc(v)).append("</li>")
                    "NOTE" -> sb.append("<li>📝 ").append(X.esc(v).replace("\n", "<br>")).append("</li>")
                }
            }
            sb.append("</ul></div></div>")
        }
        return sb.toString()
    }
}

/** Agenda (.ics): eventos e tarefas em ordem cronológica. */
object ICal {
    private fun date(v: String, params: Map<String, String>): Date? {
        val s = v.trim()
        return try {
            when {
                s.length == 8 -> SimpleDateFormat("yyyyMMdd", Locale.US).parse(s)
                s.endsWith("Z") -> SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(s)
                else -> SimpleDateFormat("yyyyMMdd'T'HHmmss", Locale.US).apply { params["TZID"]?.let { timeZone = TimeZone.getTimeZone(it) } }.parse(s)
            }
        } catch (e: Exception) { null }
    }

    fun toHtml(text: String): String {
        class Ev(val kind: String) { val p = ArrayList<Lines.Prop>(); fun first(n: String) = p.firstOrNull { it.name == n } }
        val events = ArrayList<Ev>()
        var cur: Ev? = null
        var calName: String? = null
        for (p in Lines.parse(text)) {
            when {
                p.name == "BEGIN" && (p.value == "VEVENT" || p.value == "VTODO") -> cur = Ev(p.value)
                p.name == "END" && (p.value == "VEVENT" || p.value == "VTODO") -> { cur?.let { events += it }; cur = null }
                p.name == "X-WR-CALNAME" -> calName = p.value
                else -> cur?.p?.add(p)
            }
        }
        val full = DateFormat.getDateTimeInstance(DateFormat.FULL, DateFormat.SHORT, Locale("pt", "BR"))
        val day = DateFormat.getDateInstance(DateFormat.FULL, Locale("pt", "BR"))
        val sorted = events.map { e -> e to (e.first("DTSTART")?.let { date(it.value, it.params) } ?: e.first("DUE")?.let { date(it.value, it.params) }) }
            .sortedBy { it.second?.time ?: Long.MAX_VALUE }
        val sb = StringBuilder("<div class=\"note\">").append(calName?.let { X.esc(it) + " · " } ?: "").append("${events.size} item(ns)</div>")
        for ((e, start) in sorted) {
            val allDay = e.first("DTSTART")?.let { it.value.length == 8 } == true
            sb.append("<div class=\"card\"><div class=\"avatar\">").append(if (e.kind == "VTODO") "✔" else "📅").append("</div><div><b>")
                .append(X.esc(Lines.unescape(e.first("SUMMARY")?.value ?: "(sem título)"))).append("</b><ul>")
            if (start != null) sb.append("<li>").append(if (allDay) day.format(start) + " (dia inteiro)" else full.format(start))
                .append(e.first("DTEND")?.let { d -> date(d.value, d.params)?.let { " → " + (if (allDay) day.format(it) else full.format(it)) } } ?: "").append("</li>")
            e.first("LOCATION")?.let { sb.append("<li>📍 ").append(X.esc(Lines.unescape(it.value))).append("</li>") }
            e.first("RRULE")?.let { sb.append("<li>🔁 ").append(X.esc(it.value)).append("</li>") }
            e.first("ORGANIZER")?.let { sb.append("<li>👤 ").append(X.esc(it.params["CN"] ?: it.value.removePrefix("mailto:"))).append("</li>") }
            e.first("DESCRIPTION")?.let { sb.append("<li>").append(X.esc(Lines.unescape(it.value)).replace("\n", "<br>")).append("</li>") }
            e.first("URL")?.let { sb.append("<li>🔗 <a href=\"").append(X.esc(it.value)).append("\">").append(X.esc(it.value)).append("</a></li>") }
            sb.append("</ul></div></div>")
        }
        return sb.toString()
    }
}

/** Arquivo .torrent (bencode): nome, arquivos, rastreadores e link magnet. */
object Torrent {
    private class Parser(val b: ByteArray) {
        var p = 0
        var infoStart = -1
        var infoEnd = -1
        fun value(depth: Int = 0): Any? {
            if (p >= b.size || depth > 64) return null
            return when (b[p].toInt().toChar()) {
                'i' -> { val e = indexOf('e'.code, p); val v = String(b, p + 1, e - p - 1).toLongOrNull(); p = e + 1; v }
                'l' -> { p++; val l = ArrayList<Any?>(); while (p < b.size && b[p].toInt() != 'e'.code) l += value(depth + 1); p++; l }
                'd' -> {
                    p++
                    val m = LinkedHashMap<String, Any?>()
                    while (p < b.size && b[p].toInt() != 'e'.code) {
                        val k = String(value(depth + 1) as? ByteArray ?: break, Charsets.UTF_8)
                        val start = p
                        m[k] = value(depth + 1)
                        if (k == "info" && depth == 0) { infoStart = start; infoEnd = p }
                    }
                    p++; m
                }
                in '0'..'9' -> {
                    val colon = indexOf(':'.code, p)
                    val len = String(b, p, colon - p).toInt()
                    p = colon + 1
                    val v = b.copyOfRange(p, minOf(b.size, p + len)); p += len; v
                }
                else -> { p = b.size; null }
            }
        }
        private fun indexOf(c: Int, from: Int): Int { var i = from; while (i < b.size && b[i].toInt() != c) i++; return i }
    }

    private fun s(v: Any?) = (v as? ByteArray)?.let { String(it, Charsets.UTF_8) }

    fun toHtml(b: ByteArray): String {
        val parser = Parser(b)
        @Suppress("UNCHECKED_CAST")
        val root = parser.value() as? Map<String, Any?> ?: throw IllegalArgumentException("Torrent inválido")
        @Suppress("UNCHECKED_CAST")
        val info = root["info"] as? Map<String, Any?> ?: emptyMap()
        val name = s(info["name.utf-8"]) ?: s(info["name"]) ?: "torrent"
        val files = ArrayList<Pair<String, Long>>()
        (info["files"] as? List<*>)?.forEach { f ->
            @Suppress("UNCHECKED_CAST")
            val m = f as? Map<String, Any?> ?: return@forEach
            val path = ((m["path.utf-8"] ?: m["path"]) as? List<*>)?.mapNotNull { s(it) }?.joinToString("/") ?: "?"
            files += path to ((m["length"] as? Long) ?: 0L)
        }
        if (files.isEmpty()) files += name to ((info["length"] as? Long) ?: 0L)
        val total = files.sumOf { it.second }
        val trackers = LinkedHashSet<String>()
        s(root["announce"])?.let { trackers += it }
        (root["announce-list"] as? List<*>)?.forEach { tier -> (tier as? List<*>)?.forEach { s(it)?.let { t -> trackers += t } } }
        val hash = if (parser.infoStart >= 0) MessageDigest.getInstance("SHA-1").digest(b.copyOfRange(parser.infoStart, parser.infoEnd)).joinToString("") { "%02x".format(it) } else null
        val sb = StringBuilder("<h2>").append(X.esc(name)).append("</h2><table class=\"meta\">")
        fun row(k: String, v: String?) { if (!v.isNullOrBlank()) sb.append("<tr><th>").append(k).append("</th><td>").append(X.esc(v)).append("</td></tr>") }
        row("Tamanho total", FileUtil.human(total))
        row("Arquivos", files.size.toString())
        row("Tamanho das peças", (info["piece length"] as? Long)?.let { FileUtil.human(it) })
        row("Hash (info)", hash)
        row("Comentário", s(root["comment"]))
        row("Criado com", s(root["created by"]))
        row("Criado em", (root["creation date"] as? Long)?.let { DateFormat.getDateTimeInstance(DateFormat.LONG, DateFormat.SHORT, Locale("pt", "BR")).format(Date(it * 1000)) })
        if ((info["private"] as? Long) == 1L) row("Privado", "sim")
        sb.append("</table>")
        if (hash != null) {
            val magnet = "magnet:?xt=urn:btih:$hash&dn=" + java.net.URLEncoder.encode(name, "UTF-8") + trackers.take(10).joinToString("") { "&tr=" + java.net.URLEncoder.encode(it, "UTF-8") }
            sb.append("<p><a class=\"att\" href=\"").append(X.esc(magnet)).append("\">🧲 Abrir link magnet no app de torrent</a></p>")
        }
        sb.append("<h3>Arquivos</h3><table><tr><th>Arquivo</th><th>Tamanho</th></tr>")
        files.take(2000).forEach { (p, l) -> sb.append("<tr><td>").append(X.esc(p)).append("</td><td class=\"n\">").append(FileUtil.human(l)).append("</td></tr>") }
        sb.append("</table>")
        if (trackers.isNotEmpty()) { sb.append("<h3>Rastreadores</h3><ul>"); trackers.forEach { sb.append("<li>").append(X.esc(it)).append("</li>") }; sb.append("</ul>") }
        return sb.toString()
    }
}

/** Visualização de fontes (.ttf, .otf, .woff…): nomes da tabela "name" e amostras em vários tamanhos. */
object FontInfo {
    private fun be16(b: ByteArray, o: Int) = if (o + 1 < b.size) ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF) else 0
    private fun be32(b: ByteArray, o: Int) = if (o + 3 < b.size) (be16(b, o) shl 16) or be16(b, o + 2) else 0

    fun names(b: ByteArray): Map<Int, String> {
        var base = 0
        if (String(b, 0, 4.coerceAtMost(b.size), Charsets.ISO_8859_1) == "ttcf") base = be32(b, 12)
        val numTables = be16(b, base + 4)
        var nameOff = -1
        for (i in 0 until numTables.coerceAtMost(200)) {
            val r = base + 12 + i * 16
            if (String(b, r, 4.coerceAtMost(maxOf(0, b.size - r)), Charsets.ISO_8859_1) == "name") { nameOff = be32(b, r + 8); break }
        }
        if (nameOff < 0) return emptyMap()
        val count = be16(b, nameOff + 2)
        val strings = nameOff + be16(b, nameOff + 4)
        val out = HashMap<Int, String>()
        for (i in 0 until count.coerceAtMost(500)) {
            val r = nameOff + 6 + i * 12
            val platform = be16(b, r); val id = be16(b, r + 6); val len = be16(b, r + 8); val off = be16(b, r + 10)
            val start = strings + off
            if (start + len > b.size) continue
            val v = if (platform == 3 || platform == 0) String(b, start, len, Charsets.UTF_16BE) else String(b, start, len, Charsets.ISO_8859_1)
            if (platform == 3 || !out.containsKey(id)) out[id] = v
        }
        return out
    }

    fun toHtml(bytes: ByteArray, fileName: String): MailResult {
        val ext = FileUtil.extension(fileName)
        val mime = when (ext) { "otf" -> "font/otf"; "woff" -> "font/woff"; "woff2" -> "font/woff2"; "ttc", "otc" -> "font/collection"; else -> "font/ttf" }
        val n = if (ext == "woff" || ext == "woff2") emptyMap() else runCatching { names(bytes) }.getOrDefault(emptyMap())
        val family = n[16] ?: n[1] ?: FileUtil.baseName(fileName)
        val sb = StringBuilder("<style>@font-face{font-family:'VFont';src:url('${DocumentConverter.BASE}v/font')}.f{font-family:'VFont',serif}</style>")
        sb.append("<h1 class=\"f\">").append(X.esc(family)).append("</h1><table class=\"meta\">")
        for ((id, label) in listOf(2 to "Estilo", 4 to "Nome completo", 5 to "Versão", 9 to "Designer", 8 to "Fabricante", 0 to "Direitos", 13 to "Licença", 11 to "Site")) {
            n[id]?.takeIf { it.isNotBlank() }?.let { sb.append("<tr><th>").append(label).append("</th><td>").append(X.esc(it.take(400))).append("</td></tr>") }
        }
        sb.append("<tr><th>Tamanho</th><td>").append(FileUtil.human(bytes.size.toLong())).append("</td></tr></table>")
        val pangram = "Zebras caolhas de Java querem passar fax para moças gigantes de New York."
        for (size in listOf(12, 16, 20, 28, 40, 56, 72)) sb.append("<p class=\"f\" style=\"font-size:${size}px;margin:6px 0\">").append(pangram).append("</p>")
        sb.append("<p class=\"f\" style=\"font-size:26px\">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 .,;:!?@#\$%&amp;*()[]{}<br>áàâãéêíóôõúüç ÁÀÂÃÉÊÍÓÔÕÚÇ ñ ß € £ ¥</p>")
        return MailResult(sb.toString(), mapOf("font" to VFile(fileName, mime, bytes)), family)
    }
}

/** Arquivos do Apple iWork (Pages, Numbers, Keynote): usam a pré-visualização embutida. */
object IWork {
    class Preview(val pdfPath: String?, val imagePath: String?, val text: String?)

    fun preview(zip: ZipRes): Preview {
        val e = zip.entries()
        val pdf = e.firstOrNull { it.equals("QuickLook/Preview.pdf", true) }
        val img = listOf("preview.jpg", "QuickLook/Thumbnail.jpg", "preview-web.jpg", "QuickLook/Preview.jpg", "preview-micro.jpg").firstOrNull { p -> e.any { it.equals(p, true) } }
        // iWork '09: texto em index.xml (compactado ou não)
        val xml = zip.text("index.xml") ?: zip.bytes("index.xml.gz")?.let { java.util.zip.GZIPInputStream(it.inputStream()).use { s -> String(s.readBytes(), Charsets.UTF_8) } }
        val text = xml?.let { x ->
            Regex("<sf:p[^>]*>(.*?)</sf:p>", RegexOption.DOT_MATCHES_ALL).findAll(x).map { it.groupValues[1].replace(Regex("<[^>]+>"), "").trim() }
                .filter { it.isNotBlank() }.joinToString("\n").ifBlank { null }
        }
        return Preview(pdf, img, text)
    }
}
