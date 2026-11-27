package br.com.gooners.pdf.convert

import android.util.Base64
import br.com.gooners.pdf.convert.Cfb.Companion.i32
import br.com.gooners.pdf.convert.Cfb.Companion.i64
import br.com.gooners.pdf.util.FileUtil
import java.io.ByteArrayOutputStream
import java.nio.charset.Charset
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Arquivo virtual servido ao leitor (imagem embutida, anexo, recurso de página). */
class VFile(val name: String, val mime: String, val bytes: ByteArray)

class MailResult(val body: String, val files: Map<String, VFile>, val title: String? = null)

/** Partes MIME (RFC 2045/2046) de e-mails .eml, arquivos .mbox e páginas .mht. */
class MimePart(val headers: List<Pair<String, String>>, private val raw: String, val children: List<MimePart>) {
    fun header(name: String): String? = headers.firstOrNull { it.first.equals(name, true) }?.second

    val contentType: String get() = (header("Content-Type") ?: "text/plain").substringBefore(';').trim().lowercase()

    fun param(headerName: String, p: String): String? {
        val h = header(headerName) ?: return null
        // RFC 2231 (filename*=UTF-8''nome%20com%20espaço)
        Regex("(?i);\\s*" + Regex.escape(p) + "\\*=([^;]+)").find(h)?.let { m ->
            val v = m.groupValues[1].trim().trim('"')
            val parts = v.split('\'', limit = 3)
            if (parts.size == 3) return try { java.net.URLDecoder.decode(parts[2].replace("+", "%2B"), parts[0].ifEmpty { "UTF-8" }) } catch (e: Exception) { parts[2] }
        }
        val m = Regex("(?i);\\s*" + Regex.escape(p) + "\\s*=\\s*(\"([^\"]*)\"|[^;\\s]+)").find(h) ?: return null
        return Mime.decodeWords(m.groupValues[2].ifEmpty { m.groupValues[1] }.trim('"'))
    }

    val charset: String get() = param("Content-Type", "charset") ?: "utf-8"
    val filename: String? get() = param("Content-Disposition", "filename") ?: param("Content-Type", "name")
    val isAttachment: Boolean get() = (header("Content-Disposition") ?: "").trim().lowercase().startsWith("attachment") ||
        (filename != null && !contentType.startsWith("text/") && header("Content-ID") == null && header("Content-Location") == null)

    fun bytes(): ByteArray {
        val b = raw.toByteArray(Charsets.ISO_8859_1)
        return when ((header("Content-Transfer-Encoding") ?: "").trim().lowercase()) {
            "base64" -> try { Base64.decode(raw.replace(Regex("[^A-Za-z0-9+/=]"), ""), Base64.DEFAULT) } catch (e: Exception) { b }
            "quoted-printable" -> Mime.qp(b)
            else -> b
        }
    }

    fun text(): String = Mime.decode(bytes(), charset)

    fun walk(): Sequence<MimePart> = sequence { yield(this@MimePart); for (c in children) yieldAll(c.walk()) }
}

object Mime {
    fun charset(name: String?): Charset = try {
        when (val n = name?.trim()?.trim('"')?.lowercase()) {
            null, "", "us-ascii", "ascii", "utf8" -> Charsets.UTF_8
            "cp1252", "windows-1252", "latin1", "iso-8859-1" -> Charset.forName("windows-1252")
            else -> Charset.forName(n)
        }
    } catch (e: Exception) { Charsets.UTF_8 }

    fun decode(b: ByteArray, cs: String?): String {
        val c = charset(cs)
        if (c == Charsets.UTF_8) return TextDecode.decode(b)
        return String(b, c)
    }

    fun qp(b: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(b.size)
        var i = 0
        while (i < b.size) {
            val c = b[i].toInt() and 0xFF
            if (c == '='.code) {
                // quebra de linha "suave" (= no fim da linha)
                if (i + 1 < b.size && (b[i + 1].toInt() == '\r'.code || b[i + 1].toInt() == '\n'.code)) {
                    i += if (b[i + 1].toInt() == '\r'.code && i + 2 < b.size && b[i + 2].toInt() == '\n'.code) 3 else 2
                    continue
                }
                if (i + 2 < b.size) {
                    val h = String(byteArrayOf(b[i + 1], b[i + 2]), Charsets.ISO_8859_1).toIntOrNull(16)
                    if (h != null) { out.write(h); i += 3; continue }
                }
            }
            out.write(c); i++
        }
        return out.toByteArray()
    }

    /** Palavras codificadas RFC 2047 (=?utf-8?B?...?= e =?iso-8859-1?Q?...?=). */
    fun decodeWords(s: String): String {
        val re = Regex("=\\?([^?]+)\\?([bBqQ])\\?([^?]*)\\?=")
        if (!s.contains("=?")) return s
        val joined = s.replace(Regex("\\?=\\s+=\\?"), "?==?")
        return re.replace(joined) { m ->
            val cs = m.groupValues[1].substringBefore('*')
            val data = m.groupValues[3]
            val bytes = if (m.groupValues[2].equals("B", true)) {
                try { Base64.decode(data, Base64.DEFAULT) } catch (e: Exception) { data.toByteArray() }
            } else qp(data.replace('_', ' ').toByteArray(Charsets.ISO_8859_1))
            decode(bytes, cs)
        }
    }

    fun parse(bytes: ByteArray): MimePart = parse(String(bytes, Charsets.ISO_8859_1), 0)

    private fun parse(s: String, depth: Int): MimePart {
        val sep = Regex("\\r?\\n\\r?\\n").find(s)
        val headText = if (sep != null) s.substring(0, sep.range.first) else s
        val body = if (sep != null) s.substring(sep.range.last + 1) else ""
        val headers = ArrayList<Pair<String, String>>()
        for (line in headText.split(Regex("\\r?\\n"))) {
            if (line.isEmpty()) continue
            if ((line[0] == ' ' || line[0] == '\t') && headers.isNotEmpty()) {
                val (k, v) = headers.removeAt(headers.size - 1)
                headers += k to (v + " " + line.trim())
            } else {
                val idx = line.indexOf(':')
                if (idx > 0) headers += line.substring(0, idx).trim() to line.substring(idx + 1).trim()
            }
        }
        // cabeçalhos com UTF-8 "cru" (comum em e-mails modernos)
        val fixed = headers.map { (k, v) ->
            val bytes = v.toByteArray(Charsets.ISO_8859_1)
            k to decodeWords(if (bytes.any { it < 0 }) TextDecode.decode(bytes) else v)
        }
        val part = MimePart(fixed, body, emptyList())
        if (!part.contentType.startsWith("multipart/") || depth > 12) return part
        val boundary = part.param("Content-Type", "boundary") ?: return part
        val children = ArrayList<MimePart>()
        val marker = "--$boundary"
        var pos = body.indexOf(marker)
        while (pos >= 0 && children.size < 500) {
            val lineEnd = body.indexOf('\n', pos)
            if (body.startsWith("$marker--", pos) || lineEnd < 0) break
            val next = body.indexOf("\n$marker", lineEnd)
            val content = if (next < 0) body.substring(lineEnd + 1) else body.substring(lineEnd + 1, next).removeSuffix("\r")
            children += parse(content, depth + 1)
            pos = if (next < 0) -1 else next + 1
        }
        return MimePart(fixed, body, children)
    }

    fun parseDate(s: String?): Date? {
        if (s == null) return null
        val clean = s.replace(Regex("\\s*\\([^)]*\\)\\s*$"), "").trim()
        for (f in listOf("EEE, d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm Z", "EEE, d MMM yy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm:ss z")) {
            try { return SimpleDateFormat(f, Locale.US).parse(clean) } catch (_: Exception) {}
        }
        return null
    }
}

object MailHtml {
    private val df get() = DateFormat.getDateTimeInstance(DateFormat.LONG, DateFormat.SHORT, Locale("pt", "BR"))

    fun header(rows: List<Pair<String, String?>>, subject: String?): String {
        val sb = StringBuilder("<div class=\"mailhead\">")
        if (!subject.isNullOrBlank()) sb.append("<h2>").append(X.esc(subject)).append("</h2>")
        sb.append("<table class=\"meta\">")
        for ((k, v) in rows) if (!v.isNullOrBlank()) sb.append("<tr><th>").append(k).append("</th><td>").append(X.esc(v)).append("</td></tr>")
        sb.append("</table></div>")
        return sb.toString()
    }

    fun date(d: Date?) = d?.let { df.format(it) }

    fun attachments(list: List<Pair<String, VFile>>): String {
        if (list.isEmpty()) return ""
        val sb = StringBuilder("<h3>Anexos (${list.size})</h3><div class=\"atts\">")
        for ((key, f) in list) sb.append("<a class=\"att\" href=\"").append(DocumentConverter.BASE).append("open/").append(key).append("\">📎 ")
            .append(X.esc(f.name)).append(" <small>").append(FileUtil.human(f.bytes.size.toLong())).append("</small></a>")
        sb.append("</div>")
        return sb.toString()
    }

    fun cleanHtml(h: String): String {
        var s = h.replace(Regex("<script[^>]*>.*?</script>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)), "")
        s = s.replace(Regex("<base[^>]*>", RegexOption.IGNORE_CASE), "")
        // só o corpo (o leitor já tem o próprio <head> e estilos)
        Regex("<body[^>]*>(.*)</body>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).find(s)?.let { m ->
            val styles = Regex("<style[^>]*>.*?</style>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).findAll(s).joinToString("") { it.value }
            s = styles + m.groupValues[1]
        }
        return s
    }

    fun plain(t: String): String {
        val esc = X.esc(t)
        val linked = Regex("(https?://[^\\s<>\"]+)").replace(esc) { "<a href=\"${it.value}\">${it.value}</a>" }
        return "<div class=\"plain\">$linked</div>"
    }
}

/** E-mail .eml, caixa .mbox e página salva .mht/.mhtml. */
object EmlParser {
    fun toHtml(bytes: ByteArray, name: String): MailResult {
        val ext = FileUtil.extension(name)
        if (ext == "mbox" || String(bytes, 0, minOf(5, bytes.size), Charsets.ISO_8859_1) == "From " && countMessages(bytes) > 1) return mbox(bytes)
        return message(Mime.parse(bytes), "m", ext == "mht" || ext == "mhtml")
    }

    private fun countMessages(b: ByteArray): Int = Regex("(?m)^From \\S+").findAll(String(b, 0, minOf(b.size, 2_000_000), Charsets.ISO_8859_1)).count()

    private fun mbox(bytes: ByteArray): MailResult {
        val s = String(bytes, Charsets.ISO_8859_1)
        val starts = Regex("(?m)^From \\S+.*$").findAll(s).map { it.range.first }.toList()
        val sb = StringBuilder("<div class=\"note\">Caixa de e-mails com ${starts.size} mensagens" + (if (starts.size > 300) " (exibindo as 300 primeiras)" else "") + "</div>")
        val files = LinkedHashMap<String, VFile>()
        starts.take(300).forEachIndexed { i, st ->
            val end = starts.getOrNull(i + 1) ?: s.length
            val lineEnd = s.indexOf('\n', st).let { if (it < 0) end else it + 1 }
            val msg = message(Mime.parse(s.substring(lineEnd, end).toByteArray(Charsets.ISO_8859_1)), "m$i", false)
            if (i > 0) sb.append("<hr class=\"pb\">")
            sb.append(msg.body)
            files.putAll(msg.files)
        }
        return MailResult(sb.toString(), files)
    }

    fun message(root: MimePart, prefix: String, mht: Boolean): MailResult {
        val files = LinkedHashMap<String, VFile>()
        val parts = root.walk().filter { !it.contentType.startsWith("multipart/") }.toList()
        val htmlPart = parts.firstOrNull { it.contentType == "text/html" && !it.isAttachment }
        val textPart = parts.firstOrNull { it.contentType == "text/plain" && !it.isAttachment }
        val attachments = ArrayList<Pair<String, VFile>>()
        val inline = HashMap<String, String>() // cid / content-location -> url
        parts.forEachIndexed { i, p ->
            if (p === htmlPart || p === textPart && !p.isAttachment) return@forEachIndexed
            val key = "$prefix-$i"
            val name = p.filename ?: (p.header("Content-Location")?.substringAfterLast('/')?.substringBefore('?')?.ifBlank { null }) ?: "anexo_$i"
            val f = VFile(FileUtil.sanitize(name), p.contentType, p.bytes())
            files[key] = f
            val cid = p.header("Content-ID")?.trim()?.removePrefix("<")?.removeSuffix(">")
            val loc = p.header("Content-Location")?.trim()
            if (cid != null) inline["cid:$cid"] = DocumentConverter.BASE + "v/" + key
            if (loc != null) inline[loc] = DocumentConverter.BASE + "v/" + key
            if (p.isAttachment || (cid == null && loc == null)) attachments += key to f
        }
        val sb = StringBuilder()
        val subject = root.header("Subject")
        if (!mht || root.header("From") != null) {
            sb.append(MailHtml.header(listOf(
                "De" to root.header("From"), "Para" to root.header("To"), "Cc" to root.header("Cc"),
                "Data" to (MailHtml.date(Mime.parseDate(root.header("Date"))) ?: root.header("Date"))
            ), if (mht) null else subject ?: "(sem assunto)"))
        }
        when {
            htmlPart != null -> {
                var h = MailHtml.cleanHtml(htmlPart.text())
                // imagens embutidas: os nomes mais longos primeiro para não substituir prefixos
                for ((k, v) in inline.entries.sortedByDescending { it.key.length }) h = h.replace(k, v)
                sb.append(h)
            }
            textPart != null -> sb.append(MailHtml.plain(textPart.text()))
            root.children.isEmpty() && root.contentType.startsWith("text/") -> sb.append(MailHtml.plain(root.text()))
        }
        sb.append(MailHtml.attachments(attachments))
        return MailResult(sb.toString(), files, subject)
    }
}

/** E-mail do Outlook (.msg): propriedades MAPI guardadas em fluxos OLE2. */
object MsgParser {
    private fun codepageCharset(cp: Int): Charset = when (cp) {
        65001 -> Charsets.UTF_8
        1200 -> Charsets.UTF_16LE
        20127 -> Charsets.US_ASCII
        28591 -> Charsets.ISO_8859_1
        0 -> charset("windows-1252")
        else -> try { charset("windows-$cp") } catch (e: Exception) { try { charset("cp$cp") } catch (e2: Exception) { charset("windows-1252") } }
    }

    /** Lê as propriedades de tamanho fixo (datas, números) de __properties_version1.0. */
    private fun fixedProps(c: Cfb, storage: String, headerSize: Int): Map<Int, ByteArray> {
        val path = if (storage.isEmpty()) "__properties_version1.0" else "$storage/__properties_version1.0"
        val b = c.bytes(path) ?: return emptyMap()
        val out = HashMap<Int, ByteArray>()
        var p = headerSize
        while (p + 16 <= b.size) {
            out[i32(b, p)] = b.copyOfRange(p + 8, p + 16)
            p += 16
        }
        return out
    }

    fun toHtml(c: Cfb): MailResult {
        val top = fixedProps(c, "", 32)
        val cp = (top[(0x3FFD shl 16) or 0x0003] ?: top[(0x3FDE shl 16) or 0x0003])?.let { i32(it, 0) } ?: 0
        val cs = codepageCharset(cp)
        fun str(storage: String, id: String): String? {
            // 001F = texto Unicode; 001E = texto 8 bits na página de código da mensagem
            val pre = if (storage.isEmpty()) "" else "$storage/"
            c.bytes("${pre}__substg1.0_${id}001F")?.let { return String(it, Charsets.UTF_16LE).trimEnd('\u0000') }
            c.bytes("${pre}__substg1.0_${id}001E")?.let { return String(it, cs).trimEnd('\u0000') }
            return null
        }
        fun bin(storage: String, id: String): ByteArray? = c.bytes((if (storage.isEmpty()) "" else "$storage/") + "__substg1.0_${id}0102")
        fun time(props: Map<Int, ByteArray>, vararg ids: Int): Date? {
            for (id in ids) props[(id shl 16) or 0x0040]?.let { v ->
                val ft = i64(v, 0)
                if (ft > 0) return Date(ft / 10000 - 11644473600000L)
            }
            return null
        }

        val subject = str("", "0037")
        val fromName = str("", "0C1A") ?: str("", "0042")
        // endereços no formato do Exchange ("/O=EMPRESA/OU=...") não são e-mails
        val fromMail = listOf("5D01", "0C1F", "0065", "5D02").mapNotNull { str("", it) }.firstOrNull { it.contains('@') && !it.startsWith("/") }
        val from = listOfNotNull(fromName, fromMail?.takeIf { it.contains('@') && it != fromName }?.let { "<$it>" }).joinToString(" ").ifBlank { null }
        val date = time(top, 0x0039, 0x0E06, 0x3007)
        val headers = str("", "007D")
        val dateText = MailHtml.date(date) ?: headers?.let { h -> Regex("(?im)^Date:\\s*(.+)$").find(h)?.groupValues?.get(1)?.let { MailHtml.date(Mime.parseDate(it)) ?: it } }

        // destinatários com e-mail
        val recips = c.entries.filter { it.isStorage && it.name.startsWith("__recip_version1.0_") }.map { r ->
            val name = str(r.path, "3001") ?: ""
            val mail = listOf("39FE", "3003").mapNotNull { str(r.path, it) }.firstOrNull { it.contains('@') && !it.startsWith("/") } ?: ""
            if (mail.contains('@') && mail != name) "$name <$mail>".trim() else name
        }.filter { it.isNotBlank() }

        val files = LinkedHashMap<String, VFile>()
        val attachments = ArrayList<Pair<String, VFile>>()
        val inline = HashMap<String, String>()
        c.entries.filter { it.isStorage && it.name.startsWith("__attach_version1.0_") }.forEachIndexed { i, a ->
            val data = bin(a.path, "3701") ?: return@forEachIndexed
            val name = str(a.path, "3707") ?: str(a.path, "3704") ?: str(a.path, "3001") ?: "anexo_$i"
            val mime = str(a.path, "370E") ?: FileUtil.mimeOf(name)
            val key = "a$i"
            val f = VFile(FileUtil.sanitize(name), mime, data)
            files[key] = f
            val cid = str(a.path, "3712")?.trim()?.removePrefix("<")?.removeSuffix(">")
            if (cid != null) inline["cid:$cid"] = DocumentConverter.BASE + "v/" + key
            attachments += key to f
        }

        val sb = StringBuilder()
        sb.append(MailHtml.header(listOf("De" to from, "Para" to (str("", "0E04") ?: recips.joinToString("; ").ifBlank { null }),
            "Cc" to str("", "0E03"), "Data" to dateText), subject ?: "(sem assunto)"))
        val html = bin("", "1013")?.let { ZipRes.decode(it) } ?: str("", "1013")
        val rtf = bin("", "1009")?.let { Lzfu.decompress(it) }
        val text = str("", "1000")
        when {
            !html.isNullOrBlank() -> {
                var h = MailHtml.cleanHtml(html)
                for ((k, v) in inline) h = h.replace(k, v)
                sb.append(h)
            }
            rtf != null && rtf.contains("\\fromhtml") -> {
                var h = RtfParser.deEncapsulateHtml(rtf)?.let { MailHtml.cleanHtml(it) } ?: RtfParser.toHtml(rtf)
                for ((k, v) in inline) h = h.replace(k, v)
                sb.append(h)
            }
            !text.isNullOrBlank() -> sb.append(MailHtml.plain(text))
            rtf != null -> sb.append(RtfParser.toHtml(rtf))
        }
        sb.append(MailHtml.attachments(attachments))
        return MailResult(sb.toString(), files, subject)
    }
}

/** Descompressão de RTF do Outlook ([MS-OXRTFCP], formato "LZFu"). */
object Lzfu {
    const val PREBUF = "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx"

    fun decompress(b: ByteArray): String? {
        if (b.size < 16) return null
        val compSize = i32(b, 0)
        val rawSize = i32(b, 4)
        val magic = i32(b, 8)
        val cp = charset("windows-1252")
        if (magic == 0x414C454D) return String(b, 16, minOf(rawSize, b.size - 16).coerceAtLeast(0), cp)
        if (magic != 0x75465A4C) return null
        val dict = ByteArray(4096)
        val pre = PREBUF.toByteArray(Charsets.ISO_8859_1)
        System.arraycopy(pre, 0, dict, 0, pre.size)
        var w = pre.size
        val out = ByteArrayOutputStream(rawSize.coerceIn(16, 32 * 1024 * 1024))
        var p = 16
        val end = minOf(b.size, compSize + 4)
        outer@ while (p < end) {
            val control = b[p++].toInt() and 0xFF
            for (bit in 0 until 8) {
                if (p >= end) break@outer
                if (control and (1 shl bit) == 0) {
                    val ch = b[p++]
                    out.write(ch.toInt()); dict[w] = ch; w = (w + 1) and 4095
                } else {
                    if (p + 1 >= end) break@outer
                    val hi = b[p].toInt() and 0xFF
                    val lo = b[p + 1].toInt() and 0xFF
                    p += 2
                    val offset = (hi shl 4) or (lo shr 4)
                    val len = (lo and 0xF) + 2
                    if (offset == w) break@outer
                    for (k in 0 until len) {
                        val ch = dict[(offset + k) and 4095]
                        out.write(ch.toInt()); dict[w] = ch; w = (w + 1) and 4095
                    }
                }
            }
        }
        return String(out.toByteArray(), cp)
    }
}
