package br.com.gooners.pdf.convert

import java.io.ByteArrayOutputStream

/**
 * E-books Kindle/Mobipocket (.mobi, .azw, .azw3, .prc) e PalmDOC (.pdb).
 * Lê o banco PalmDB, descompacta (PalmDOC ou HUFF/CDIC) e entrega o HTML com as imagens.
 */
object MobiParser {
    private fun be16(b: ByteArray, o: Int) = if (o + 1 < b.size) ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF) else 0
    private fun be32(b: ByteArray, o: Int) = if (o + 3 < b.size) ((b[o].toInt() and 0xFF) shl 24) or ((b[o + 1].toInt() and 0xFF) shl 16) or
        ((b[o + 2].toInt() and 0xFF) shl 8) or (b[o + 3].toInt() and 0xFF) else 0

    class Book(val title: String, val author: String?, val html: String, val images: Map<Int, ByteArray>, val firstImage: Int)

    fun read(b: ByteArray): Book {
        require(b.size > 86) { "Arquivo MOBI inválido" }
        val count = be16(b, 76)
        val offsets = IntArray(count) { be32(b, 78 + it * 8) }
        fun record(i: Int): ByteArray {
            if (i !in 0 until count) return ByteArray(0)
            val start = offsets[i].coerceIn(0, b.size)
            val end = (if (i + 1 < count) offsets[i + 1] else b.size).coerceIn(start, b.size)
            return b.copyOfRange(start, end)
        }
        val r0 = record(0)
        val compression = be16(r0, 0)
        val textRecords = be16(r0, 8)
        val encryption = be16(r0, 12)
        if (encryption != 0) throw IllegalStateException("Este e-book tem proteção DRM e não pode ser aberto.")
        val isMobi = String(r0, 16, 4.coerceAtMost(maxOf(0, r0.size - 16)), Charsets.ISO_8859_1) == "MOBI"
        val headerLen = if (isMobi) be32(r0, 20) else 0
        val utf8 = isMobi && be32(r0, 28) == 65001
        val extraFlags = if (isMobi && headerLen >= 0xE4) be16(r0, 0xF2) else 0
        val firstImage = if (isMobi) be32(r0, 0x6C) else -1
        var title = String(b, 0, 32, Charsets.ISO_8859_1).substringBefore('\u0000').trim()
        var author: String? = null
        if (isMobi) {
            val nameOff = be32(r0, 0x54); val nameLen = be32(r0, 0x58)
            if (nameOff > 0 && nameLen in 1..1000 && nameOff + nameLen <= r0.size) title = String(r0, nameOff, nameLen, if (utf8) Charsets.UTF_8 else charset("windows-1252"))
            if (be32(r0, 0x80) and 0x40 != 0) {
                var p = 16 + headerLen
                if (String(r0, p, 4.coerceAtMost(maxOf(0, r0.size - p)), Charsets.ISO_8859_1) == "EXTH") {
                    val n = be32(r0, p + 8)
                    p += 12
                    repeat(n.coerceAtMost(500)) {
                        val type = be32(r0, p); val len = be32(r0, p + 4)
                        if (len < 8 || p + len > r0.size) return@repeat
                        val v = String(r0, p + 8, len - 8, if (utf8) Charsets.UTF_8 else charset("windows-1252"))
                        if (type == 100 && author == null) author = v
                        if (type == 503) title = v
                        p += len
                    }
                }
            }
        }
        val huff = if (compression == 17480) Huff(r0, ::record) else null
        val text = ByteArrayOutputStream()
        for (i in 1..textRecords) {
            var d = record(i)
            if (d.isEmpty()) continue
            val trail = trailingSize(d, extraFlags)
            if (trail in 1 until d.size) d = d.copyOf(d.size - trail)
            text.write(
                when (compression) {
                    2 -> palmDoc(d)
                    17480 -> huff!!.unpack(d)
                    else -> d
                }
            )
        }
        val raw = String(text.toByteArray(), if (utf8) Charsets.UTF_8 else charset("windows-1252"))
        val images = HashMap<Int, ByteArray>()
        if (firstImage in 1 until count) {
            for (i in firstImage until count) {
                val d = record(i)
                if (d.size > 4 && imageMime(d) != null) images[i - firstImage + 1] = d
            }
        }
        val html = if (isMobi) raw else "<pre style=\"white-space:pre-wrap\">" + X.esc(raw) + "</pre>"
        return Book(title.ifBlank { "E-book" }, author, html, images, firstImage)
    }

    fun imageMime(d: ByteArray): String? = when {
        d.size > 3 && (d[0].toInt() and 0xFF) == 0xFF && (d[1].toInt() and 0xFF) == 0xD8 -> "image/jpeg"
        d.size > 4 && d[1].toInt() == 'P'.code && d[2].toInt() == 'N'.code && d[3].toInt() == 'G'.code -> "image/png"
        d.size > 3 && d[0].toInt() == 'G'.code && d[1].toInt() == 'I'.code && d[2].toInt() == 'F'.code -> "image/gif"
        d.size > 2 && d[0].toInt() == 'B'.code && d[1].toInt() == 'M'.code -> "image/bmp"
        else -> null
    }

    /** Converte em HTML pronto para o leitor (imagens como recursos virtuais). */
    fun toHtml(b: ByteArray): MailResult {
        val book = read(b)
        val files = HashMap<String, VFile>()
        for ((n, d) in book.images) files["img$n"] = VFile("imagem_$n", imageMime(d) ?: "image/jpeg", d)
        var h = book.html
        // MOBI 6: <img recindex="00012">
        h = Regex("<img([^>]*?)recindex=\"?0*(\\d+)\"?([^>]*)>", RegexOption.IGNORE_CASE).replace(h) { m ->
            "<img${m.groupValues[1]}src=\"${DocumentConverter.BASE}v/img${m.groupValues[2]}\"${m.groupValues[3]}>"
        }
        // KF8: kindle:embed:XXXX (base 32)
        h = Regex("kindle:embed:([0-9A-Va-v]{4})(\\?[^\"')]*)?").replace(h) { m ->
            val n = m.groupValues[1].uppercase().fold(0) { acc, ch -> acc * 32 + (if (ch.isDigit()) ch - '0' else ch - 'A' + 10) }
            "${DocumentConverter.BASE}v/img$n"
        }
        h = h.replace(Regex("<mbp:pagebreak\\s*/?>", RegexOption.IGNORE_CASE), "<hr class=\"pb\">")
            .replace(Regex("</?mbp:[^>]*>", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\sfilepos=\"?\\d+\"?", RegexOption.IGNORE_CASE), "")
            .replace(Regex("<\\?xml[^>]*>|<!DOCTYPE[^>]*>", RegexOption.IGNORE_CASE), "")
        val head = StringBuilder("<h1>").append(X.esc(book.title)).append("</h1>")
        book.author?.let { head.append("<p><i>").append(X.esc(it)).append("</i></p>") }
        return MailResult(head.toString() + h, files, book.title)
    }

    // ------------------------------------------------------------------ compressão
    fun palmDoc(d: ByteArray): ByteArray {
        var out = ByteArray(maxOf(4096, d.size * 8))
        var o = 0
        fun put(x: Int) { if (o >= out.size) out = out.copyOf(out.size * 2); out[o++] = x.toByte() }
        var i = 0
        while (i < d.size) {
            val c = d[i++].toInt() and 0xFF
            when (c) {
                in 1..8 -> repeat(c) { if (i < d.size) put(d[i++].toInt() and 0xFF) }
                in 0x80..0xBF -> {
                    if (i >= d.size) break
                    val c2 = d[i++].toInt() and 0xFF
                    val v = (c shl 8) or c2
                    val dist = (v shr 3) and 0x7FF
                    val len = (v and 7) + 3
                    // cópia byte a byte: a origem pode se sobrepor ao que está sendo escrito
                    if (dist in 1..o) repeat(len) { put(out[o - dist].toInt() and 0xFF) }
                }
                in 0xC0..0xFF -> { put(' '.code); put(c xor 0x80) }
                else -> put(c)
            }
        }
        return out.copyOf(o)
    }

    /** Bytes extras no fim de cada registro de texto (multibyte e entradas de "trailing data"). */
    fun trailingSize(d: ByteArray, flags: Int): Int {
        var num = 0
        var test = flags shr 1
        while (test != 0) {
            if (test and 1 != 0) {
                var size = d.size - num
                var bitpos = 0
                var result = 0
                while (size > 0) {
                    val v = d[size - 1].toInt() and 0xFF
                    result = result or ((v and 0x7F) shl bitpos)
                    bitpos += 7
                    size--
                    if (v and 0x80 != 0 || bitpos >= 28) break
                }
                num += result
            }
            test = test shr 1
        }
        if (flags and 1 != 0 && d.size - num - 1 >= 0) num += (d[d.size - num - 1].toInt() and 0x3) + 1
        return num
    }

    /** Descompressão HUFF/CDIC (usada em livros gerados pela Amazon). */
    private class Huff(r0: ByteArray, record: (Int) -> ByteArray) {
        private val dict1 = LongArray(256 * 3)
        private val minCode = LongArray(33)
        private val maxCode = LongArray(33)
        private val dictionary = ArrayList<ByteArray?>()
        private val dictFlag = ArrayList<Boolean>()

        init {
            val first = be32(r0, 0x70)
            val n = be32(r0, 0x74)
            val huff = record(first)
            val off1 = be32(huff, 8)
            val off2 = be32(huff, 12)
            for (i in 0 until 256) {
                val v = be32(huff, off1 + i * 4).toLong() and 0xFFFFFFFFL
                val codelen = (v and 0x1F).toInt()
                val term = v and 0x80
                var max = v ushr 8
                if (codelen in 1..32) max = ((max + 1) shl (32 - codelen)) - 1
                dict1[i * 3] = codelen.toLong(); dict1[i * 3 + 1] = term; dict1[i * 3 + 2] = max
            }
            minCode[0] = 0; maxCode[0] = 0
            for (codelen in 1..32) {
                val mn = be32(huff, off2 + (codelen - 1) * 8).toLong() and 0xFFFFFFFFL
                val mx = be32(huff, off2 + (codelen - 1) * 8 + 4).toLong() and 0xFFFFFFFFL
                minCode[codelen] = (mn shl (32 - codelen)) and 0xFFFFFFFFL
                maxCode[codelen] = (((mx + 1) shl (32 - codelen)) - 1) and 0xFFFFFFFFL
            }
            for (k in 1 until n) {
                val cdic = record(first + k)
                val phrases = be32(cdic, 8)
                val bits = be32(cdic, 12)
                val cnt = minOf(1 shl bits.coerceIn(0, 30), phrases - dictionary.size)
                for (j in 0 until cnt) {
                    val off = be16(cdic, 16 + j * 2)
                    val blen = be16(cdic, 16 + off)
                    val start = 18 + off
                    val len = blen and 0x7FFF
                    dictionary += if (start + len <= cdic.size) cdic.copyOfRange(start, start + len) else ByteArray(0)
                    dictFlag += blen and 0x8000 != 0
                }
            }
        }

        fun unpack(input: ByteArray, depth: Int = 0): ByteArray {
            val out = ByteArrayOutputStream(input.size * 3)
            val data = input.copyOf(input.size + 8)
            var bitsLeft = input.size.toLong() * 8
            var pos = 0
            fun q(p: Int): Long {
                var x = 0L
                for (k in 0 until 8) x = (x shl 8) or (data.getOrElse(p + k) { 0 }.toLong() and 0xFF)
                return x
            }
            var x = q(pos)
            var n = 32
            while (true) {
                if (n <= 0) { pos += 4; x = q(pos); n += 32 }
                val code = (x ushr n) and 0xFFFFFFFFL
                val top = (code ushr 24).toInt()
                var codelen = dict1[top * 3].toInt()
                val term = dict1[top * 3 + 1]
                var max = dict1[top * 3 + 2]
                if (term == 0L) {
                    while (codelen < 32 && code < minCode[codelen]) codelen++
                    max = maxCode[codelen]
                }
                if (codelen <= 0) break
                n -= codelen
                bitsLeft -= codelen
                if (bitsLeft < 0) break
                val r = ((max - code) ushr (32 - codelen)).toInt()
                if (r !in dictionary.indices) break
                var slice = dictionary[r] ?: ByteArray(0)
                if (!dictFlag[r] && depth < 20) {
                    dictionary[r] = null
                    slice = unpack(slice, depth + 1)
                    dictionary[r] = slice
                    dictFlag[r] = true
                }
                out.write(slice)
            }
            return out.toByteArray()
        }
    }
}
