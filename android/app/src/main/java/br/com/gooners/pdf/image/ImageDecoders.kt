package br.com.gooners.pdf.image

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import br.com.gooners.pdf.util.FileUtil
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.filter.FilterFactory
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.zip.Inflater
import kotlin.math.ceil
import kotlin.math.max

/** Decodificadores próprios para imagens que o Android não abre sozinho. */
object ImageDecoders {
    enum class Fmt { TIFF, PSD, TGA, PNM, RAW, EPS, PLATFORM }

    private val rawExt = setOf("cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "raf", "pef", "srw", "x3f", "erf", "kdc", "mrw", "3fr", "mef", "iiq", "rwl", "dng")

    fun detect(head: ByteArray, name: String): Fmt {
        fun at(o: Int, vararg v: Int) = head.size >= o + v.size && v.indices.all { (head[o + it].toInt() and 0xFF) == v[it] }
        val ext = FileUtil.extension(name)
        return when {
            ext in rawExt -> Fmt.RAW
            at(0, 0xC5, 0xD0, 0xD3, 0xC6) -> Fmt.EPS
            at(0, 0x49, 0x49, 0x2A, 0x00) || at(0, 0x4D, 0x4D, 0x00, 0x2A) -> Fmt.TIFF
            at(0, 0x38, 0x42, 0x50, 0x53) -> Fmt.PSD
            head.size > 1 && head[0].toInt() == 'P'.code && head[1].toInt() in '1'.code..'7'.code && ext in setOf("pbm", "pgm", "ppm", "pnm", "pam") -> Fmt.PNM
            ext in setOf("tga", "icb", "vda", "vst") -> Fmt.TGA
            ext in setOf("eps", "epsf", "epsi") -> Fmt.EPS
            else -> Fmt.PLATFORM
        }
    }

    fun pageCount(file: File, fmt: Fmt): Int = if (fmt == Fmt.TIFF) runCatching { TiffFile(file).use { it.pages } }.getOrDefault(1) else 1

    fun decode(file: File, fmt: Fmt, page: Int, maxDim: Int): Bitmap? = when (fmt) {
        Fmt.TIFF -> TiffFile(file).use { it.decode(page, maxDim) }
        Fmt.PSD -> Psd.decode(file, maxDim)
        Fmt.TGA -> Tga.decode(file.readBytes(), maxDim)
        Fmt.PNM -> Pnm.decode(file.readBytes(), maxDim)
        Fmt.RAW -> RawPreview.decode(file, maxDim)
        Fmt.EPS -> EpsPreview.decode(file, maxDim)
        Fmt.PLATFORM -> {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, o)
            BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample(o.outWidth, o.outHeight, maxDim) })
        }
    }

    fun sample(w: Int, h: Int, maxDim: Int): Int {
        var s = 1
        while (max(w, h) / (s * 2) >= maxDim) s *= 2
        return s
    }

    fun step(w: Int, h: Int, maxDim: Int) = max(1, ceil(max(w, h).toDouble() / maxDim).toInt())

    fun packBits(src: ByteArray, expected: Int): ByteArray {
        val out = ByteArrayOutputStream(max(16, expected))
        var i = 0
        while (i < src.size && out.size() < expected) {
            val n = src[i++].toInt()
            when {
                n >= 0 -> { val c = minOf(n + 1, src.size - i); out.write(src, i, c); i += c }
                n != -128 -> { if (i < src.size) { val b = src[i++].toInt(); repeat(1 - n) { out.write(b) } } }
            }
        }
        return out.toByteArray()
    }
}

/** TIFF (inclusive multipágina): sem compressão, LZW, Deflate, PackBits, CCITT G3/G4 (fax) e JPEG. */
class TiffFile(file: File) : Closeable {
    private val raf = RandomAccessFile(file, "r")
    private val le: Boolean
    val ifds = ArrayList<Long>()
    val pages get() = ifds.size

    private class Tag(val type: Int, val count: Long, val valueField: Long, val pos: Long)

    init {
        val h = ByteArray(8); raf.readFully(h)
        le = h[0].toInt() == 'I'.code
        val magic = u16(2, h)
        require(magic == 42) { if (magic == 43) "BigTIFF não é suportado" else "TIFF inválido" }
        var off = u32(4, h)
        val seen = HashSet<Long>()
        while (off in 8 until raf.length() && seen.add(off) && ifds.size < 5000) {
            ifds += off
            raf.seek(off)
            val n = readU16()
            raf.seek(off + 2 + n * 12L)
            off = readU32()
        }
    }

    private fun u16(o: Int, b: ByteArray) = if (le) (b[o].toInt() and 0xFF) or ((b[o + 1].toInt() and 0xFF) shl 8) else ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF)
    private fun u32(o: Int, b: ByteArray): Long = if (le) ((b[o].toLong() and 0xFF) or ((b[o + 1].toLong() and 0xFF) shl 8) or ((b[o + 2].toLong() and 0xFF) shl 16) or ((b[o + 3].toLong() and 0xFF) shl 24))
        else (((b[o].toLong() and 0xFF) shl 24) or ((b[o + 1].toLong() and 0xFF) shl 16) or ((b[o + 2].toLong() and 0xFF) shl 8) or (b[o + 3].toLong() and 0xFF))
    private fun readU16(): Int { val b = ByteArray(2); raf.readFully(b); return u16(0, b) }
    private fun readU32(): Long { val b = ByteArray(4); raf.readFully(b); return u32(0, b) }

    private fun tags(ifd: Long): Map<Int, Tag> {
        raf.seek(ifd)
        val n = readU16()
        val b = ByteArray(n * 12); raf.readFully(b)
        val m = HashMap<Int, Tag>()
        for (i in 0 until n) {
            val o = i * 12
            m[u16(o, b)] = Tag(u16(o + 2, b), u32(o + 4, b), u32(o + 8, b), ifd + 2 + o + 8)
        }
        return m
    }

    private fun typeSize(t: Int) = when (t) { 1, 2, 6, 7 -> 1; 3, 8 -> 2; 4, 9, 11 -> 4; 5, 10, 12 -> 8; else -> 1 }

    private fun ints(t: Tag?): LongArray {
        t ?: return LongArray(0)
        val size = typeSize(t.type)
        val total = t.count * size
        if (t.count > 10_000_000) return LongArray(0)
        val b = ByteArray(total.toInt())
        if (total <= 4) { raf.seek(t.pos); raf.readFully(b) } else { raf.seek(t.valueField); raf.readFully(b) }
        return LongArray(t.count.toInt()) { i ->
            when (size) {
                1 -> b[i].toLong() and 0xFF
                2 -> u16(i * 2, b).toLong()
                else -> u32(i * 4, b)
            }
        }
    }

    private fun bytes(t: Tag?): ByteArray? {
        t ?: return null
        val total = t.count * typeSize(t.type)
        if (total > 4_000_000) return null
        val b = ByteArray(total.toInt())
        if (total <= 4) raf.seek(t.pos) else raf.seek(t.valueField)
        raf.readFully(b)
        return b
    }

    private fun one(m: Map<Int, Tag>, id: Int, def: Long): Long = ints(m[id]).firstOrNull() ?: def

    fun decode(page: Int, maxDim: Int): Bitmap {
        val m = tags(ifds.getOrNull(page) ?: throw IllegalArgumentException("Página inexistente"))
        val w = one(m, 256, 0).toInt(); val h = one(m, 257, 0).toInt()
        require(w in 1..200_000 && h in 1..200_000) { "Dimensões inválidas" }
        val bpsArr = ints(m[258]); val bps = (bpsArr.firstOrNull() ?: 1L).toInt()
        val spp = one(m, 277, 1).toInt()
        val comp = one(m, 259, 1).toInt()
        val photo = one(m, 262, if (comp in 2..4) 0 else if (spp >= 3) 2 else 1).toInt()
        // Photometric 0/1 só faz sentido em tons de cinza e preto e branco
        val planar = one(m, 284, 1).toInt()
        val predictor = one(m, 317, 1).toInt()
        val fillOrder = one(m, 266, 1).toInt()
        val t4 = one(m, 292, 0)
        val colorMap = ints(m[320])
        val jpegTables = bytes(m[347])
        if (planar == 2 && spp > 1) throw UnsupportedOperationException("TIFF com planos separados não é suportado")
        val tiled = m.containsKey(322)
        val cw = if (tiled) one(m, 322, w.toLong()).toInt() else w
        val chh = if (tiled) one(m, 323, h.toLong()).toInt() else one(m, 278, h.toLong()).toInt().coerceIn(1, h)
        val offsets = ints(m[if (tiled) 324 else 273])
        val counts = ints(m[if (tiled) 325 else 279])
        val s = ImageDecoders.step(w, h, maxDim)
        val ow = (w + s - 1) / s; val oh = (h + s - 1) / s
        val px = IntArray(ow * oh) { -1 }
        val across = if (tiled) (w + cw - 1) / cw else 1
        for (k in offsets.indices) {
            val x0 = if (tiled) (k % across) * cw else 0
            val y0 = if (tiled) (k / across) * chh else k * chh
            if (y0 >= h) break
            val rows = if (tiled) chh else minOf(chh, h - y0)
            val len = counts.getOrNull(k)?.toInt() ?: continue
            if (len <= 0 || offsets[k] + len > raf.length()) continue
            val enc = ByteArray(len); raf.seek(offsets[k]); raf.readFully(enc)
            if (fillOrder == 2) for (i in enc.indices) enc[i] = (Integer.reverse(enc[i].toInt() and 0xFF) ushr 24).toByte()
            if (comp == 7) {
                val jpeg = if (jpegTables != null && jpegTables.size > 4) jpegTables.copyOf(jpegTables.size - 2) + enc.copyOfRange(2, enc.size) else enc
                val bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: continue
                for (yy in 0 until minOf(rows, bmp.height)) {
                    val y = y0 + yy
                    if (y >= h || y % s != 0) continue
                    for (xx in 0 until minOf(cw, bmp.width)) {
                        val x = x0 + xx
                        if (x >= w || x % s != 0) continue
                        px[(y / s) * ow + x / s] = bmp.getPixel(xx, yy)
                    }
                }
                bmp.recycle()
                continue
            }
            val ccitt = comp in 2..4
            val effBps = if (ccitt) 1 else bps
            val effSpp = if (ccitt) 1 else spp
            val rowBytes = (cw * effSpp * effBps + 7) / 8
            var raw = decompress(enc, comp, cw, rows, rowBytes * rows, t4)
            if (predictor == 2 && !ccitt) raw = undoPredictor(raw, cw, effSpp, effBps, rowBytes)
            for (yy in 0 until rows) {
                val y = y0 + yy
                if (y >= h || y % s != 0) continue
                val rowOff = yy * rowBytes
                if (rowOff >= raw.size) break
                var xx = 0
                while (xx < cw) {
                    val x = x0 + xx
                    if (x >= w) break
                    if (x % s == 0) px[(y / s) * ow + x / s] = pixel(raw, rowOff, xx, effSpp, effBps, photo, colorMap, ccitt)
                    xx++
                }
            }
        }
        return Bitmap.createBitmap(px, ow, oh, Bitmap.Config.ARGB_8888)
    }

    private fun sampleAt(raw: ByteArray, rowOff: Int, index: Int, bps: Int): Int {
        return when (bps) {
            8 -> raw.getOrElse(rowOff + index) { 0 }.toInt() and 0xFF
            16 -> {
                val o = rowOff + index * 2
                // 16 bits: usa o byte mais significativo
                if (le) raw.getOrElse(o + 1) { 0 }.toInt() and 0xFF else raw.getOrElse(o) { 0 }.toInt() and 0xFF
            }
            else -> {
                val bit = index * bps
                val b = raw.getOrElse(rowOff + bit / 8) { 0 }.toInt() and 0xFF
                val v = (b shr (8 - bps - bit % 8)) and ((1 shl bps) - 1)
                v * 255 / ((1 shl bps) - 1)
            }
        }
    }

    private fun pixel(raw: ByteArray, rowOff: Int, x: Int, spp: Int, bps: Int, photo: Int, cmap: LongArray, ccitt: Boolean): Int {
        if (ccitt) {
            // o decodificador grava 1 nas "corridas pretas"; a interpretação final vem do tag Photometric
            val b = raw.getOrElse(rowOff + x / 8) { 0 }.toInt()
            val one = (b shr (7 - x % 8)) and 1 == 1
            val black = if (photo == 1) !one else one
            return if (black) 0xFF000000.toInt() else -1
        }
        return when (photo) {
            0, 1 -> {
                var v = sampleAt(raw, rowOff, x * spp, bps)
                if (photo == 0) v = 255 - v
                val a = if (spp >= 2) sampleAt(raw, rowOff, x * spp + 1, bps) else 255
                (a shl 24) or (v shl 16) or (v shl 8) or v
            }
            3 -> {
                val idx = if (bps == 8) raw.getOrElse(rowOff + x) { 0 }.toInt() and 0xFF else {
                    val bit = x * bps; ((raw.getOrElse(rowOff + bit / 8) { 0 }.toInt() and 0xFF) shr (8 - bps - bit % 8)) and ((1 shl bps) - 1)
                }
                val n = 1 shl bps
                if (cmap.size >= 3 * n) {
                    val r = (cmap[idx] shr 8).toInt(); val g = (cmap[n + idx] shr 8).toInt(); val b = (cmap[2 * n + idx] shr 8).toInt()
                    0xFF000000.toInt() or (r shl 16) or (g shl 8) or b
                } else { val v = idx * 255 / (n - 1).coerceAtLeast(1); 0xFF000000.toInt() or (v shl 16) or (v shl 8) or v }
            }
            5 -> {
                val c = sampleAt(raw, rowOff, x * spp, bps); val mm = sampleAt(raw, rowOff, x * spp + 1, bps)
                val y = sampleAt(raw, rowOff, x * spp + 2, bps); val k = sampleAt(raw, rowOff, x * spp + 3, bps)
                val r = (255 - c) * (255 - k) / 255; val g = (255 - mm) * (255 - k) / 255; val b = (255 - y) * (255 - k) / 255
                0xFF000000.toInt() or (r shl 16) or (g shl 8) or b
            }
            else -> {
                val r = sampleAt(raw, rowOff, x * spp, bps)
                val g = if (spp > 1) sampleAt(raw, rowOff, x * spp + 1, bps) else r
                val b = if (spp > 2) sampleAt(raw, rowOff, x * spp + 2, bps) else r
                val a = if (spp > 3) sampleAt(raw, rowOff, x * spp + 3, bps) else 255
                (a shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
    }

    private fun undoPredictor(raw: ByteArray, w: Int, spp: Int, bps: Int, rowBytes: Int): ByteArray {
        if (bps != 8 && bps != 16) return raw
        val bpp = spp * bps / 8
        var o = 0
        while (o + rowBytes <= raw.size) {
            if (bps == 8) for (i in bpp until w * bpp) raw[o + i] = (raw[o + i] + raw[o + i - bpp]).toByte()
            else {
                var i = spp
                while (i < w * spp) {
                    val p = o + i * 2; val q = o + (i - spp) * 2
                    val cur = if (le) (raw[p].toInt() and 0xFF) or ((raw[p + 1].toInt() and 0xFF) shl 8) else ((raw[p].toInt() and 0xFF) shl 8) or (raw[p + 1].toInt() and 0xFF)
                    val prev = if (le) (raw[q].toInt() and 0xFF) or ((raw[q + 1].toInt() and 0xFF) shl 8) else ((raw[q].toInt() and 0xFF) shl 8) or (raw[q + 1].toInt() and 0xFF)
                    val v = (cur + prev) and 0xFFFF
                    if (le) { raw[p] = v.toByte(); raw[p + 1] = (v shr 8).toByte() } else { raw[p] = (v shr 8).toByte(); raw[p + 1] = v.toByte() }
                    i++
                }
            }
            o += rowBytes
        }
        return raw
    }

    private fun decompress(enc: ByteArray, comp: Int, cols: Int, rows: Int, expected: Int, t4: Long): ByteArray = when (comp) {
        1 -> enc
        32773 -> ImageDecoders.packBits(enc, expected)
        8, 32946 -> {
            val inf = Inflater()
            inf.setInput(enc)
            val out = ByteArray(expected)
            var n = 0
            try { while (n < expected && !inf.finished()) { val r = inf.inflate(out, n, expected - n); if (r == 0 && (inf.needsInput() || inf.needsDictionary())) break; n += r } } finally { inf.end() }
            out
        }
        5 -> pdfFilter(COSName.LZW_DECODE, enc, COSDictionary().apply { setInt(COSName.EARLY_CHANGE, 1) })
        2, 3, 4 -> pdfFilter(COSName.CCITTFAX_DECODE, enc, COSDictionary().apply {
            setInt(COSName.K, when (comp) { 4 -> -1; 3 -> if (t4 and 1L != 0L) 1 else 0; else -> 0 })
            setInt(COSName.COLUMNS, cols)
            setInt(COSName.ROWS, rows)
            setBoolean(COSName.BLACK_IS_1, true)
            setBoolean(COSName.ENCODED_BYTE_ALIGN, comp == 2 || (t4 and 4L != 0L))
        })
        else -> throw UnsupportedOperationException("Compressão TIFF $comp não suportada")
    }

    private fun pdfFilter(name: COSName, data: ByteArray, parms: COSDictionary): ByteArray {
        val dict = COSDictionary()
        dict.setItem(COSName.FILTER, name)
        dict.setItem(COSName.DECODE_PARMS, parms)
        val out = ByteArrayOutputStream(data.size * 4)
        FilterFactory.INSTANCE.getFilter(name).decode(ByteArrayInputStream(data), out, dict, 0)
        return out.toByteArray()
    }

    override fun close() = raf.close()
}

/** Photoshop (.psd/.psb): usa a imagem composta salva no fim do arquivo. */
object Psd {
    fun decode(file: File, maxDim: Int): Bitmap {
        val b = file.readBytes()
        fun be16(o: Int) = ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF)
        fun be32(o: Int) = (be16(o).toLong() shl 16) or be16(o + 2).toLong()
        require(String(b, 0, 4, Charsets.ISO_8859_1) == "8BPS") { "PSD inválido" }
        val psb = be16(4) == 2
        val channels = be16(12); val h = be32(14).toInt(); val w = be32(18).toInt(); val depth = be16(22); val mode = be16(24)
        require(depth == 8 || depth == 16) { "Profundidade de cor $depth não suportada" }
        var p = 26
        val cmLen = be32(p).toInt(); val palette = if (mode == 2 && cmLen >= 768) b.copyOfRange(p + 4, p + 4 + 768) else null
        p += 4 + cmLen
        p += 4 + be32(p).toInt()
        p += if (psb) 8 + ((be32(p) shl 32) or be32(p + 4)).toInt() else 4 + be32(p).toInt()
        val compression = be16(p); p += 2
        val bpc = depth / 8
        val planeSize = w * h * bpc
        val nch = minOf(channels, if (mode == 4) 5 else 4)
        val planes = Array(nch) { ByteArray(planeSize) }
        if (compression == 0) {
            for (c in 0 until nch) { System.arraycopy(b, p, planes[c], 0, minOf(planeSize, b.size - p).coerceAtLeast(0)); p += planeSize }
        } else if (compression == 1) {
            val countSize = if (psb) 4 else 2
            val counts = IntArray(channels * h) { i -> if (psb) be32(p + i * 4).toInt() else be16(p + i * 2) }
            p += channels * h * countSize
            for (c in 0 until channels) for (row in 0 until h) {
                val n = counts[c * h + row]
                if (c < nch) {
                    val dec = ImageDecoders.packBits(b.copyOfRange(p, minOf(b.size, p + n)), w * bpc)
                    System.arraycopy(dec, 0, planes[c], row * w * bpc, minOf(dec.size, w * bpc))
                }
                p += n
            }
        } else throw UnsupportedOperationException("Compressão PSD $compression não suportada")
        val s = ImageDecoders.step(w, h, maxDim)
        val ow = (w + s - 1) / s; val oh = (h + s - 1) / s
        val px = IntArray(ow * oh)
        fun v(c: Int, i: Int) = planes[c][i * bpc].toInt() and 0xFF
        for (y in 0 until oh) for (x in 0 until ow) {
            val i = (y * s) * w + x * s
            px[y * ow + x] = when (mode) {
                3 -> { val a = if (nch > 3) v(3, i) else 255; (a shl 24) or (v(0, i) shl 16) or (v(1, i) shl 8) or v(2, i) }
                4 -> {
                    val c = 255 - v(0, i); val m = 255 - v(1, i); val yy = 255 - v(2, i); val k = 255 - v(3, i)
                    0xFF000000.toInt() or (((255 - c) * (255 - k) / 255) shl 16) or (((255 - m) * (255 - k) / 255) shl 8) or ((255 - yy) * (255 - k) / 255)
                }
                2 -> { val idx = v(0, i); val pl = palette; if (pl != null) 0xFF000000.toInt() or ((pl[idx].toInt() and 0xFF) shl 16) or ((pl[256 + idx].toInt() and 0xFF) shl 8) or (pl[512 + idx].toInt() and 0xFF) else 0xFF000000.toInt() or (idx * 0x010101) }
                else -> { val g = v(0, i); 0xFF000000.toInt() or (g shl 16) or (g shl 8) or g }
            }
        }
        return Bitmap.createBitmap(px, ow, oh, Bitmap.Config.ARGB_8888)
    }
}

/** Targa (.tga): truecolor, tons de cinza e paleta, com ou sem RLE. */
object Tga {
    fun decode(b: ByteArray, maxDim: Int): Bitmap {
        fun le16(o: Int) = (b[o].toInt() and 0xFF) or ((b[o + 1].toInt() and 0xFF) shl 8)
        val idLen = b[0].toInt() and 0xFF
        val cmType = b[1].toInt() and 0xFF
        val type = b[2].toInt() and 0xFF
        val cmFirst = le16(3); val cmLen = le16(5); val cmDepth = b[7].toInt() and 0xFF
        val w = le16(12); val h = le16(14); val depth = b[16].toInt() and 0xFF; val desc = b[17].toInt() and 0xFF
        require(w in 1..30000 && h in 1..30000 && type in setOf(1, 2, 3, 9, 10, 11)) { "TGA inválido ou não suportado" }
        var p = 18 + idLen
        val cmap = IntArray(if (cmType == 1) cmLen else 0)
        val cmBytes = (cmDepth + 7) / 8
        for (i in cmap.indices) { cmap[i] = color(b, p, cmDepth); p += cmBytes }
        val bpp = (depth + 7) / 8
        val n = w * h
        val pixels = IntArray(n)
        fun read(at: Int): Int = when {
            type == 1 || type == 9 -> cmap.getOrElse((if (bpp == 2) le16(at) else b[at].toInt() and 0xFF) - cmFirst) { 0xFF000000.toInt() }
            type == 3 || type == 11 -> { val g = b[at].toInt() and 0xFF; 0xFF000000.toInt() or (g * 0x010101) }
            else -> color(b, at, depth)
        }
        if (type < 9) {
            for (i in 0 until n) { if (p + bpp > b.size) break; pixels[i] = read(p); p += bpp }
        } else {
            var i = 0
            while (i < n && p < b.size) {
                val hdr = b[p++].toInt() and 0xFF
                val count = (hdr and 0x7F) + 1
                if (hdr and 0x80 != 0) { val c = read(p); p += bpp; repeat(count) { if (i < n) pixels[i++] = c } }
                else repeat(count) { if (i < n && p + bpp <= b.size) { pixels[i++] = read(p); p += bpp } }
            }
        }
        val topDown = desc and 0x20 != 0
        val rightToLeft = desc and 0x10 != 0
        val s = ImageDecoders.step(w, h, maxDim)
        val ow = (w + s - 1) / s; val oh = (h + s - 1) / s
        val out = IntArray(ow * oh)
        for (y in 0 until oh) for (x in 0 until ow) {
            val sy = if (topDown) y * s else h - 1 - y * s
            val sx = if (rightToLeft) w - 1 - x * s else x * s
            out[y * ow + x] = pixels[sy * w + sx]
        }
        return Bitmap.createBitmap(out, ow, oh, Bitmap.Config.ARGB_8888)
    }

    private fun color(b: ByteArray, p: Int, depth: Int): Int = when (depth) {
        32 -> ((b[p + 3].toInt() and 0xFF) shl 24) or ((b[p + 2].toInt() and 0xFF) shl 16) or ((b[p + 1].toInt() and 0xFF) shl 8) or (b[p].toInt() and 0xFF)
        24 -> 0xFF000000.toInt() or ((b[p + 2].toInt() and 0xFF) shl 16) or ((b[p + 1].toInt() and 0xFF) shl 8) or (b[p].toInt() and 0xFF)
        15, 16 -> {
            val v = (b[p].toInt() and 0xFF) or ((b[p + 1].toInt() and 0xFF) shl 8)
            val r = (v shr 10) and 31; val g = (v shr 5) and 31; val bl = v and 31
            0xFF000000.toInt() or ((r * 255 / 31) shl 16) or ((g * 255 / 31) shl 8) or (bl * 255 / 31)
        }
        else -> { val g = b[p].toInt() and 0xFF; 0xFF000000.toInt() or (g * 0x010101) }
    }
}

/** Netpbm (.pbm, .pgm, .ppm, .pam), em texto ou binário. */
object Pnm {
    fun decode(b: ByteArray, maxDim: Int): Bitmap {
        var p = 2
        val kind = b[1].toInt().toChar()
        fun skipWs() {
            while (p < b.size) {
                val c = b[p].toInt().toChar()
                if (c == '#') { while (p < b.size && b[p].toInt() != '\n'.code) p++ } else if (c.isWhitespace()) p++ else break
            }
        }
        fun token(): String { skipWs(); val st = p; while (p < b.size && !b[p].toInt().toChar().isWhitespace()) p++; return String(b, st, p - st, Charsets.US_ASCII) }
        var w: Int; var h: Int; var maxv = 1; var depth: Int
        if (kind == '7') {
            w = 0; h = 0; depth = 1; maxv = 255
            while (p < b.size) {
                val t = token()
                when (t) {
                    "WIDTH" -> w = token().toInt(); "HEIGHT" -> h = token().toInt(); "DEPTH" -> depth = token().toInt(); "MAXVAL" -> maxv = token().toInt()
                    "TUPLTYPE" -> token()
                    "ENDHDR" -> { p++; break }
                }
            }
        } else {
            w = token().toInt(); h = token().toInt()
            if (kind != '1' && kind != '4') maxv = token().toInt()
            depth = if (kind == '3' || kind == '6') 3 else 1
            if (kind in '4'..'6') p++
        }
        require(w in 1..50000 && h in 1..50000) { "Netpbm inválido" }
        val ascii = kind in '1'..'3'
        val wide = maxv > 255
        val px = IntArray(w * h)
        fun next(): Int = if (ascii) token().toIntOrNull() ?: 0 else if (wide) { val v = ((b[p].toInt() and 0xFF) shl 8) or (b[p + 1].toInt() and 0xFF); p += 2; v } else b[p++].toInt() and 0xFF
        fun scale(v: Int) = if (maxv == 255) v else (v * 255 / maxv.coerceAtLeast(1)).coerceIn(0, 255)
        if (kind == '4') {
            val rowBytes = (w + 7) / 8
            for (y in 0 until h) for (x in 0 until w) {
                val bit = (b.getOrElse(p + y * rowBytes + x / 8) { 0 }.toInt() shr (7 - x % 8)) and 1
                px[y * w + x] = if (bit == 1) 0xFF000000.toInt() else -1
            }
        } else {
            for (i in 0 until w * h) {
                if (!ascii && p >= b.size) break
                px[i] = when {
                    kind == '1' -> if (next() == 1) 0xFF000000.toInt() else -1
                    depth >= 3 -> { val r = scale(next()); val g = scale(next()); val bl = scale(next()); val a = if (depth == 4) scale(next()) else 255; (a shl 24) or (r shl 16) or (g shl 8) or bl }
                    depth == 2 -> { val g = scale(next()); val a = scale(next()); (a shl 24) or (g * 0x010101) }
                    else -> { val g = scale(next()); 0xFF000000.toInt() or (g * 0x010101) }
                }
            }
        }
        val bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
        val s = ImageDecoders.step(w, h, maxDim)
        return if (s > 1) Bitmap.createScaledBitmap(bmp, w / s, h / s, true) else bmp
    }
}

/** RAW de câmeras: mostra a maior pré-visualização JPEG embutida no arquivo. */
object RawPreview {
    fun decode(file: File, maxDim: Int): Bitmap? {
        val len = file.length()
        val candidates = ArrayList<Long>()
        FileInputStream(file).use { s ->
            val buf = ByteArray(256 * 1024)
            var base = 0L
            var a = -1; var b = -1
            while (candidates.size < 40) {
                val n = s.read(buf)
                if (n <= 0) break
                for (i in 0 until n) {
                    val c = buf[i].toInt() and 0xFF
                    if (a == 0xFF && b == 0xD8 && c == 0xFF) candidates += base + i - 2
                    a = b; b = c
                }
                base += n
            }
        }
        var best: Pair<Long, Long>? = null
        for (off in candidates) {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            bounded(file, off, len).use { BitmapFactory.decodeStream(it, null, o) }
            val area = o.outWidth.toLong() * o.outHeight
            if (o.outWidth > 0 && (best == null || area > best.second)) best = off to area
        }
        val off = best?.first ?: return null
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        bounded(file, off, len).use { BitmapFactory.decodeStream(it, null, o) }
        return bounded(file, off, len).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = ImageDecoders.sample(o.outWidth, o.outHeight, maxDim) }) }
    }

    private fun bounded(file: File, off: Long, len: Long): InputStream {
        val s = FileInputStream(file)
        var skipped = 0L
        while (skipped < off) { val n = s.skip(off - skipped); if (n <= 0) break; skipped += n }
        return s.buffered(64 * 1024).let { b -> object : java.io.FilterInputStream(b) { private var left = len - off
            override fun read(): Int = if (left <= 0) -1 else super.read().also { if (it >= 0) left-- }
            override fun read(buf: ByteArray, o: Int, l: Int): Int { if (left <= 0) return -1; val n = super.read(buf, o, minOf(l.toLong(), left).toInt()); if (n > 0) left -= n; return n }
        } }
    }
}

/** EPS com cabeçalho binário do DOS: usa a pré-visualização TIFF embutida. */
object EpsPreview {
    fun decode(file: File, maxDim: Int): Bitmap? {
        val h = ByteArray(30)
        FileInputStream(file).use { it.read(h) }
        if ((h[0].toInt() and 0xFF) != 0xC5) return null
        fun le32(o: Int) = (h[o].toLong() and 0xFF) or ((h[o + 1].toLong() and 0xFF) shl 8) or ((h[o + 2].toLong() and 0xFF) shl 16) or ((h[o + 3].toLong() and 0xFF) shl 24)
        val tOff = le32(20); val tLen = le32(24)
        if (tOff <= 0 || tLen <= 0 || tOff + tLen > file.length()) return null
        val tmp = File(file.parentFile, file.name + ".preview.tif")
        RandomAccessFile(file, "r").use { r -> val b = ByteArray(tLen.toInt()); r.seek(tOff); r.readFully(b); tmp.writeBytes(b) }
        return try { TiffFile(tmp).use { it.decode(0, maxDim) } } finally { tmp.delete() }
    }
}
