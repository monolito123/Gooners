package br.com.gooners.pdf.convert

import android.util.Base64
import br.com.gooners.pdf.convert.Cfb.Companion.f64
import br.com.gooners.pdf.convert.Cfb.Companion.i32
import br.com.gooners.pdf.convert.Cfb.Companion.u16
import java.io.File

/**
 * Formatos binários do Office 97-2003 lidos de verdade a partir do contêiner OLE2:
 * Word (.doc, tabela de peças), Excel (.xls, registros BIFF8) e PowerPoint (.ppt, átomos de texto).
 * Se a estrutura não puder ser lida, cai para a extração de trechos de texto.
 */
object LegacyOffice {
    private val cp1252 = charset("windows-1252")

    fun toHtml(file: File): String {
        if (!Cfb.isCfb(file)) return textFallbackHtml(file.readBytes(), "Arquivo em formato antigo: exibindo o texto encontrado.")
        return try {
            Cfb(file).use { c ->
                when {
                    c.findByName("WordDocument") != null -> docHtml(c)
                    c.findByName("Workbook") != null || c.findByName("Book") != null -> XlsxParser.sheetsHtml(xlsSheets(c))
                    c.findByName("PowerPoint Document") != null -> pptHtml(c)
                    c.entries.any { it.name.startsWith("__substg1.0_") } -> MsgParser.toHtml(c).body
                    else -> {
                        val biggest = c.entries.filter { it.isStream }.maxByOrNull { it.size }
                        textFallbackHtml(biggest?.let { c.read(it) } ?: ByteArray(0), "Documento OLE de tipo desconhecido: exibindo o texto encontrado.")
                    }
                }
            }
        } catch (e: IllegalStateException) {
            throw e
        } catch (e: Exception) {
            textFallbackHtml(file.readBytes(), "Não foi possível ler a estrutura do arquivo (${e.message}). Exibindo o texto encontrado.")
        }
    }

    // ================================================================== Word 97-2003
    fun docText(c: Cfb): String {
        val wd = c.findByName("WordDocument")?.let { c.read(it) } ?: throw IllegalArgumentException("Documento Word inválido")
        val nFib = u16(wd, 2)
        val flags = u16(wd, 0x0A)
        if (flags and 0x0100 != 0) throw IllegalStateException("Este documento Word está protegido por senha.")
        if (nFib < 0x00C1) {
            // Word 6/95: texto contínuo entre fcMin e fcMac
            val fcMin = i32(wd, 0x18); val fcMac = i32(wd, 0x1C)
            if (fcMin in 0 until fcMac && fcMac <= wd.size) return String(wd, fcMin, fcMac - fcMin, cp1252)
            throw IllegalArgumentException("Versão antiga do Word não suportada")
        }
        val table = c.findByName(if (flags and 0x0200 != 0) "1Table" else "0Table")?.let { c.read(it) }
            ?: throw IllegalArgumentException("Tabela do documento ausente")
        val ccpText = i32(wd, 0x4C).coerceAtLeast(0)
        val fcClx = i32(wd, 0x1A2)
        val lcbClx = i32(wd, 0x1A6)
        val sb = StringBuilder()
        var p = fcClx
        val end = minOf(table.size, fcClx + lcbClx)
        while (p in 0 until end) {
            when (table[p].toInt()) {
                1 -> p += 3 + u16(table, p + 1)
                2 -> {
                    val lcb = i32(table, p + 1)
                    val base = p + 5
                    val n = (lcb - 4) / 12
                    for (i in 0 until n) {
                        if (sb.length >= ccpText && ccpText > 0) break
                        val cpStart = i32(table, base + i * 4)
                        val cpEnd = i32(table, base + (i + 1) * 4)
                        val pcd = base + (n + 1) * 4 + i * 8
                        val fcRaw = i32(table, pcd + 2)
                        val compressed = fcRaw and 0x40000000 != 0
                        val fc = fcRaw and 0x3FFFFFFF
                        val len = (cpEnd - cpStart).coerceAtLeast(0)
                        if (compressed) {
                            val off = fc / 2
                            if (off >= 0 && off + len <= wd.size) sb.append(String(wd, off, len, cp1252))
                        } else if (fc >= 0 && fc + len * 2 <= wd.size) sb.append(String(wd, fc, len * 2, Charsets.UTF_16LE))
                    }
                    break
                }
                else -> break
            }
        }
        if (sb.isEmpty()) throw IllegalArgumentException("Tabela de peças vazia")
        return if (ccpText in 1 until sb.length) sb.substring(0, ccpText) else sb.toString()
    }

    /** Remove códigos de campo (mantém o resultado), notas e marcadores de objetos. */
    private fun cleanFields(t: String): String {
        val sb = StringBuilder(t.length)
        // pilha: true = dentro do código do campo (oculto), false = dentro do resultado
        val stack = ArrayList<Boolean>()
        for (ch in t) {
            when (ch) {
                '\u0013' -> stack += true
                '\u0014' -> if (stack.isNotEmpty()) stack[stack.size - 1] = false
                '\u0015' -> if (stack.isNotEmpty()) stack.removeAt(stack.size - 1)
                else -> if (stack.none { it }) when (ch) {
                    '\u0001', '\u0002', '\u0005', '\u0008', '\u001F' -> {}
                    '\u001E' -> sb.append('-')
                    ' ' -> sb.append(' ')
                    else -> sb.append(ch)
                }
            }
        }
        return sb.toString()
    }

    fun docHtml(c: Cfb): String {
        val text = cleanFields(docText(c))
        val out = StringBuilder()
        // parágrafos terminam com \r; células de tabela com \u0007 (e cada linha tem uma marca \u0007 extra)
        var row = ArrayList<String>()
        var cell = StringBuilder()
        var cols = -1
        var inTable = false
        val rows = ArrayList<List<String>>()

        fun para(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\u000B", "<br>").replace("\u000C", "</p><hr class=\"pb\"><p>").replace("\u000E", "<br>").replace("\t", "&emsp;")

        fun flushTable() {
            if (rows.isEmpty()) return
            out.append("<table>")
            for (r in rows) { out.append("<tr>"); r.forEach { out.append("<td>").append(it.ifEmpty { "&nbsp;" }).append("</td>") }; out.append("</tr>") }
            out.append("</table>")
            rows.clear(); inTable = false; cols = -1
        }

        var start = 0
        var lastWasCellEnd = false
        for (i in text.indices) {
            val ch = text[i]
            if (ch != '\r' && ch != '\u0007') continue
            val piece = text.substring(start, i)
            start = i + 1
            if (ch == '\u0007') {
                inTable = true
                if (piece.isEmpty() && lastWasCellEnd && cell.isEmpty() && (cols < 0 || row.size >= cols)) {
                    // marca de fim de linha
                    if (cols < 0) cols = row.size
                    rows += row; row = ArrayList()
                    lastWasCellEnd = false
                } else {
                    if (cell.isNotEmpty()) cell.append("<br>")
                    cell.append(para(piece))
                    row += cell.toString(); cell = StringBuilder()
                    lastWasCellEnd = true
                }
            } else {
                if (inTable && row.isNotEmpty() || cell.isNotEmpty()) {
                    // parágrafo dentro de uma célula com várias linhas
                    if (cell.isNotEmpty()) cell.append("<br>")
                    cell.append(para(piece))
                    lastWasCellEnd = false
                    continue
                }
                if (inTable) flushTable()
                lastWasCellEnd = false
                if (piece.isBlank()) out.append("<p>&nbsp;</p>") else out.append("<p>").append(para(piece)).append("</p>")
            }
        }
        if (row.isNotEmpty()) rows += row
        flushTable()
        if (start < text.length && text.substring(start).isNotBlank()) out.append("<p>").append(para(text.substring(start))).append("</p>")
        c.findByName("Data")?.let { appendImages(out, c.read(it), "Imagens do documento") }
        return out.toString()
    }

    // ================================================================== Excel 97-2003 (BIFF8)
    private class Rec(val type: Int, val data: ByteArray, val pos: Int)

    private fun records(b: ByteArray): List<Rec> {
        val out = ArrayList<Rec>()
        var p = 0
        while (p + 4 <= b.size) {
            val type = u16(b, p); val len = u16(b, p + 2)
            if (p + 4 + len > b.size) break
            out += Rec(type, b.copyOfRange(p + 4, p + 4 + len), p)
            p += 4 + len
        }
        return out
    }

    /** Leitor de dados que atravessa registros CONTINUE (strings longas da SST). */
    private class Chunks(val parts: List<ByteArray>) {
        var part = 0
        var pos = 0
        fun atBoundary() = part < parts.size && pos >= parts[part].size
        fun next(): Boolean { if (atBoundary()) { part++; pos = 0 }; return part < parts.size }
        fun byte(): Int { while (atBoundary()) if (!next()) return 0; return parts[part][pos++].toInt() and 0xFF }
        fun u16() = byte() or (byte() shl 8)
        fun i32() = u16() or (u16() shl 16)
        fun skip(n: Int) { repeat(n) { byte() } }
        fun eof() = part >= parts.size || (part == parts.size - 1 && pos >= parts[part].size)

        fun string(): String {
            val cch = u16()
            var flags = byte()
            var high = flags and 1 != 0
            val runs = if (flags and 8 != 0) u16() else 0
            val ext = if (flags and 4 != 0) i32() else 0
            val sb = StringBuilder(cch)
            var i = 0
            while (i < cch && !eof()) {
                if (atBoundary()) { next(); flags = byte(); high = flags and 1 != 0; continue }
                if (high) sb.append((byte() or (byte() shl 8)).toChar()) else sb.append(String(byteArrayOf(byte().toByte()), charset("windows-1252")))
                i++
            }
            skip(runs * 4 + ext)
            return sb.toString()
        }
    }

    private fun xlString(d: ByteArray, off: Int, twoByteLen: Boolean = true): String {
        val cch = if (twoByteLen) u16(d, off) else d.getOrElse(off) { 0 }.toInt() and 0xFF
        val flagPos = off + if (twoByteLen) 2 else 1
        val high = (d.getOrElse(flagPos) { 0 }.toInt() and 1) != 0
        val start = flagPos + 1
        return if (high) String(d, start, minOf(cch * 2, d.size - start).coerceAtLeast(0), Charsets.UTF_16LE)
        else String(d, start, minOf(cch, d.size - start).coerceAtLeast(0), cp1252)
    }

    private fun rk(v: Int): Double {
        val d = if (v and 2 != 0) (v shr 2).toDouble() else java.lang.Double.longBitsToDouble((v.toLong() and 0xFFFFFFFCL) shl 32)
        return if (v and 1 != 0) d / 100 else d
    }

    fun xlsSheets(c: Cfb, maxRows: Int = 5000, maxCols: Int = 80): List<XlsxParser.Sheet> {
        val wb = (c.findByName("Workbook") ?: c.findByName("Book"))?.let { c.read(it) } ?: throw IllegalArgumentException("Planilha inválida")
        val recs = records(wb)
        if (recs.any { it.type == 0x002F }) throw IllegalStateException("Esta planilha do Excel está protegida por senha.")
        val sst = ArrayList<String>()
        val sheets = ArrayList<Pair<String, Int>>()
        val formats = HashMap<Int, String>()
        val xfFormat = ArrayList<Int>()
        var date1904 = false
        var i = 0
        while (i < recs.size) {
            val r = recs[i]
            when (r.type) {
                0x0085 -> sheets += xlString(r.data, 6, twoByteLen = false) to i32(r.data, 0)
                0x041E -> formats[u16(r.data, 0)] = xlString(r.data, 2)
                0x00E0 -> xfFormat += u16(r.data, 2)
                0x0022 -> date1904 = u16(r.data, 0) == 1
                0x00FC -> {
                    val parts = arrayListOf(r.data)
                    var j = i + 1
                    while (j < recs.size && recs[j].type == 0x003C) { parts += recs[j].data; j++ }
                    val ch = Chunks(parts)
                    ch.skip(4)
                    val unique = ch.i32()
                    var k = 0
                    while (k < unique && !ch.eof()) { sst += ch.string(); k++ }
                    i = j - 1
                }
                0x000A -> if (sheets.isNotEmpty()) break
            }
            i++
        }
        fun isDate(xf: Int): Boolean {
            val fmt = xfFormat.getOrNull(xf) ?: return false
            return XlsxParser.isBuiltinDate(fmt) || formats[fmt]?.let { XlsxParser.isDateFormat(it) } == true
        }
        val byPos = recs.withIndex().associate { it.value.pos to it.index }
        return sheets.map { (name, pos) ->
            val rows = ArrayList<MutableList<String>>()
            fun put(r: Int, col: Int, v: String) {
                if (r >= maxRows || col >= maxCols || r < 0 || col < 0) return
                while (rows.size <= r) rows += ArrayList<String>()
                val row = rows[r]
                while (row.size <= col) row += ""
                row[col] = v
            }
            var idx = byPos[pos] ?: -1
            var pendingString: Pair<Int, Int>? = null
            if (idx >= 0) {
                idx++
                while (idx < recs.size) {
                    val r = recs[idx]
                    val d = r.data
                    when (r.type) {
                        0x000A -> break
                        0x00FD -> put(u16(d, 0), u16(d, 2), sst.getOrElse(i32(d, 6)) { "" })
                        0x0204 -> put(u16(d, 0), u16(d, 2), xlString(d, 6))
                        0x0203 -> put(u16(d, 0), u16(d, 2), XlsxParser.formatValue(f64(d, 6), isDate(u16(d, 4)), date1904))
                        0x027E -> put(u16(d, 0), u16(d, 2), XlsxParser.formatValue(rk(i32(d, 6)), isDate(u16(d, 4)), date1904))
                        0x00BD -> {
                            val row = u16(d, 0); val first = u16(d, 2)
                            val n = (d.size - 6) / 6
                            for (k in 0 until n) put(row, first + k, XlsxParser.formatValue(rk(i32(d, 4 + k * 6 + 2)), isDate(u16(d, 4 + k * 6)), date1904))
                        }
                        0x0205 -> put(u16(d, 0), u16(d, 2), if (d.getOrElse(7) { 0 }.toInt() == 0) (if (d[6].toInt() != 0) "VERDADEIRO" else "FALSO") else "#ERRO")
                        0x0006 -> {
                            val row = u16(d, 0); val col = u16(d, 2)
                            if ((d[12].toInt() and 0xFF) == 0xFF && (d[13].toInt() and 0xFF) == 0xFF) {
                                when (d[6].toInt()) {
                                    0 -> pendingString = row to col
                                    1 -> put(row, col, if (d[8].toInt() != 0) "VERDADEIRO" else "FALSO")
                                    2 -> put(row, col, "#ERRO")
                                }
                            } else put(row, col, XlsxParser.formatValue(f64(d, 6), isDate(u16(d, 4)), date1904))
                        }
                        0x0207 -> pendingString?.let { (row, col) -> put(row, col, xlString(d, 0)); pendingString = null }
                    }
                    idx++
                }
            }
            while (rows.isNotEmpty() && rows.last().all { it.isEmpty() }) rows.removeAt(rows.size - 1)
            XlsxParser.Sheet(name, rows)
        }
    }

    // ================================================================== PowerPoint 97-2003
    private class PptText(val type: Int, val text: String)

    fun pptSlides(c: Cfb): List<List<Pair<Int, String>>> {
        val doc = c.findByName("PowerPoint Document")?.let { c.read(it) } ?: throw IllegalArgumentException("Apresentação inválida")
        val slides = ArrayList<MutableList<Pair<Int, String>>>()
        val listSlides = ArrayList<MutableList<Pair<Int, String>>>()

        // percorre a árvore de registros guardando os textos de cada slide (ignora mestres, notas e folhetos)
        fun walk(start: Int, end: Int, depth: Int, inSlide: MutableList<Pair<Int, String>>?, skip: Boolean, inList: Boolean) {
            var p = start
            var lastType = 4
            var current = inSlide
            while (p + 8 <= end && depth < 30) {
                val verInst = u16(doc, p); val type = u16(doc, p + 2); val len = i32(doc, p + 4)
                val body = p + 8
                if (len < 0 || body + len > end) break
                val container = verInst and 0xF == 0xF
                when {
                    container -> when (type) {
                        0x03EE -> { val s = ArrayList<Pair<Int, String>>(); slides += s; walk(body, body + len, depth + 1, s, false, false) }
                        // mestres, notas e folhetos não fazem parte do conteúdo dos slides
                        0x03F8, 0x03F0, 0x0FC9 -> walk(body, body + len, depth + 1, null, true, false)
                        0x0FF0 -> walk(body, body + len, depth + 1, null, skip || (verInst shr 4) != 0, true)
                        else -> walk(body, body + len, depth + 1, current, skip, inList)
                    }
                    type == 0x03F3 && inList && !skip -> { current = ArrayList(); listSlides += current }
                    type == 0x0F9F -> lastType = i32(doc, body)
                    !skip && type == 0x0FA0 -> current?.add(lastType to String(doc, body, len, Charsets.UTF_16LE))
                    !skip && type == 0x0FA8 -> current?.add(lastType to String(doc, body, len, cp1252))
                }
                p = body + len
            }
        }
        walk(0, doc.size, 0, null, false, false)
        // textos dos marcadores (SlideListWithText) + caixas de texto desenhadas no slide, na mesma ordem
        val n = maxOf(slides.size, listSlides.size)
        val merged = (0 until n).map { i ->
            val a = listSlides.getOrNull(i).orEmpty()
            val b = slides.getOrNull(i).orEmpty().filter { t -> a.none { it.second.trim() == t.second.trim() } }
            a + b
        }
        // "*" é o campo do número do slide
        return merged.map { s -> s.filter { it.second.isNotBlank() && it.second.trim() != "*" } }.filter { it.isNotEmpty() }
    }

    fun pptHtml(c: Cfb): String {
        val slides = pptSlides(c)
        val sb = StringBuilder()
        slides.forEachIndexed { i, texts ->
            sb.append("<div class=\"slide\"><div class=\"slide-n\">Slide ${i + 1}</div>")
            for ((type, t) in texts) {
                val esc = X.esc(t.replace('\u000B', '\n')).replace("\r", "\n")
                if (type == 0 || type == 6) sb.append("<h2>").append(esc.replace("\n", "<br>")).append("</h2>")
                else esc.split('\n').filter { it.isNotBlank() }.forEach { sb.append("<p>• ").append(it).append("</p>") }
            }
            sb.append("</div>")
        }
        if (slides.isEmpty()) sb.append("<p><i>(nenhum texto encontrado nos slides)</i></p>")
        c.findByName("Pictures")?.let { appendImages(sb, c.read(it), "Imagens da apresentação") }
        return sb.toString()
    }

    // ================================================================== auxiliares
    /** Procura imagens JPEG e PNG embutidas num fluxo binário. */
    fun embeddedImages(b: ByteArray, max: Int = 60): List<Pair<String, ByteArray>> {
        val out = ArrayList<Pair<String, ByteArray>>()
        var i = 0
        while (i < b.size - 8 && out.size < max) {
            val x = b[i].toInt() and 0xFF
            if (x == 0xFF && (b[i + 1].toInt() and 0xFF) == 0xD8 && (b[i + 2].toInt() and 0xFF) == 0xFF) {
                var j = i + 2
                var end = -1
                while (j < b.size - 1) { if ((b[j].toInt() and 0xFF) == 0xFF && (b[j + 1].toInt() and 0xFF) == 0xD9) { end = j + 2; break }; j++ }
                if (end > i + 200) { out += "image/jpeg" to b.copyOfRange(i, end); i = end; continue }
            } else if (x == 0x89 && b[i + 1].toInt() == 0x50 && b[i + 2].toInt() == 0x4E && b[i + 3].toInt() == 0x47) {
                val iend = indexOf(b, byteArrayOf(0x49, 0x45, 0x4E, 0x44), i + 8)
                if (iend > 0) { val end = minOf(b.size, iend + 8); out += "image/png" to b.copyOfRange(i, end); i = end; continue }
            }
            i++
        }
        return out
    }

    private fun indexOf(b: ByteArray, pat: ByteArray, from: Int): Int {
        outer@ for (i in from..b.size - pat.size) {
            for (k in pat.indices) if (b[i + k] != pat[k]) continue@outer
            return i
        }
        return -1
    }

    private fun appendImages(sb: StringBuilder, data: ByteArray, title: String) {
        val imgs = embeddedImages(data).filter { it.second.size > 1500 }
        if (imgs.isEmpty()) return
        sb.append("<h3>").append(title).append("</h3>")
        for ((mime, bytes) in imgs) sb.append("<p><img src=\"data:").append(mime).append(";base64,")
            .append(Base64.encodeToString(bytes, Base64.NO_WRAP)).append("\"></p>")
    }

    // ------------------------------------------------------------------ extração genérica de texto
    fun extractText(b: ByteArray): String {
        val utf16 = StringBuilder()
        val ansi = StringBuilder()
        run {
            val cur = StringBuilder()
            var i = 0
            while (i + 1 < b.size) {
                val ch = ((b[i + 1].toInt() and 0xFF) shl 8 or (b[i].toInt() and 0xFF)).toChar()
                if (ok(ch)) cur.append(ch) else flush(cur, utf16, 6)
                i += 2
            }
            flush(cur, utf16, 6)
        }
        run {
            val cur = StringBuilder()
            for (x in b) {
                val ch = String(byteArrayOf(x), cp1252)[0]
                if (ok(ch)) cur.append(ch) else flush(cur, ansi, 10)
            }
            flush(cur, ansi, 10)
        }
        val best = if (letters(utf16) >= letters(ansi) * 0.6) utf16 else ansi
        return best.toString().replace(Regex("\\n{3,}"), "\n\n").trim()
    }

    private fun ok(ch: Char) = ch == '\r' || ch == '\n' || ch == '\t' || (ch >= ' ' && ch.code < 0xD800 && ch != '�' &&
        (ch.isLetterOrDigit() || ch.isWhitespace() || ch in ".,;:!?()[]{}'\"-–—/\\@#$%&*+=<>«»ºª°§|_~^`´"))

    private fun letters(s: CharSequence) = s.count { it.isLetter() }

    private fun flush(cur: StringBuilder, out: StringBuilder, min: Int) {
        val s = cur.toString().trim()
        if (s.length >= min && s.count { it.isLetter() } > s.length * 0.55) out.append(s.replace('\r', '\n')).append('\n')
        cur.setLength(0)
    }

    fun textFallbackHtml(b: ByteArray, note: String): String {
        val text = extractText(b)
        val sb = StringBuilder("<div class=\"note\">").append(X.esc(note)).append("</div>")
        text.split(Regex("\\n+")).forEach { if (it.isNotBlank()) sb.append("<p>").append(X.esc(it)).append("</p>") }
        return sb.toString()
    }

    /** Compatibilidade: HTML a partir dos bytes (usado em testes e formatos sem estrutura). */
    fun toHtml(b: ByteArray): String = textFallbackHtml(b, "Visualização simplificada: só o texto é exibido.")
}
