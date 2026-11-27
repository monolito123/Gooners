package br.com.gooners.pdf.convert

import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile

/**
 * Leitor de Compound File Binary (OLE2), o "sistema de arquivos" dentro de .doc, .xls, .ppt e .msg.
 * Implementa FAT, DIFAT, mini-stream e a árvore de diretórios conforme [MS-CFB].
 */
class Cfb(file: File) : Closeable {
    class Entry(val name: String, val type: Int, val start: Int, val size: Long, val left: Int, val right: Int, val child: Int) {
        var path = ""
        val isStream get() = type == 2
        val isStorage get() = type == 1 || type == 5
    }

    private val raf = RandomAccessFile(file, "r")
    private val sectorSize: Int
    private val miniCutoff: Long
    private val fat: IntArray
    private val miniFat: IntArray
    private val all: List<Entry>
    val entries: List<Entry>
    private var miniStream: ByteArray? = null

    init {
        val h = ByteArray(512)
        raf.seek(0); raf.readFully(h)
        val sig = longArrayOf(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)
        require(sig.indices.all { (h[it].toInt() and 0xFF).toLong() == sig[it] }) { "Não é um arquivo OLE2" }
        val major = u16(h, 26)
        sectorSize = 1 shl u16(h, 30).coerceIn(7, 16)
        val numFat = i32(h, 44)
        val firstDir = i32(h, 48)
        miniCutoff = i32(h, 56).toLong().takeIf { it > 0 } ?: 4096
        val firstMiniFat = i32(h, 60)
        val numMiniFat = i32(h, 64)
        var difatSector = i32(h, 68)
        val numDifat = i32(h, 72)

        // DIFAT: 109 entradas no cabeçalho + cadeia de setores extras
        val fatSectors = ArrayList<Int>()
        for (i in 0 until 109) { val s = i32(h, 76 + i * 4); if (s >= 0) fatSectors += s }
        var guard = 0
        while (difatSector >= 0 && guard++ < numDifat + 2 && guard < 100_000) {
            val b = sector(difatSector)
            val per = sectorSize / 4 - 1
            for (i in 0 until per) { val s = i32(b, i * 4); if (s >= 0) fatSectors += s }
            difatSector = i32(b, per * 4)
        }
        if (numFat > 0 && fatSectors.size > numFat) while (fatSectors.size > numFat) fatSectors.removeAt(fatSectors.size - 1)
        val fatList = IntArray(fatSectors.size * (sectorSize / 4))
        var k = 0
        for (s in fatSectors) {
            val b = sector(s)
            for (i in 0 until sectorSize / 4) if (k < fatList.size) fatList[k++] = i32(b, i * 4)
        }
        fat = fatList

        val dirBytes = readChain(firstDir, Long.MAX_VALUE)
        val list = ArrayList<Entry>()
        var off = 0
        while (off + 128 <= dirBytes.size) {
            val nameLen = u16(dirBytes, off + 64).coerceIn(0, 64)
            val name = String(dirBytes, off, maxOf(0, nameLen - 2), Charsets.UTF_16LE)
            val type = dirBytes[off + 66].toInt() and 0xFF
            var size = i64(dirBytes, off + 120)
            if (major == 3) size = size and 0xFFFFFFFFL
            list += Entry(name, type, i32(dirBytes, off + 116), size, i32(dirBytes, off + 68), i32(dirBytes, off + 72), i32(dirBytes, off + 76))
            off += 128
        }
        all = list
        miniFat = if (firstMiniFat >= 0 && numMiniFat > 0) readChain(firstMiniFat, Long.MAX_VALUE).let { b -> IntArray(b.size / 4) { i32(b, it * 4) } } else IntArray(0)

        // caminhos completos percorrendo a árvore vermelho-preta de cada pasta
        val out = ArrayList<Entry>()
        val seen = HashSet<Int>()
        fun walk(start: Int, parent: String) {
            val stack = ArrayDeque<Int>()
            if (start >= 0) stack.addLast(start)
            while (stack.isNotEmpty()) {
                val idx = stack.removeLast()
                if (idx !in all.indices || !seen.add(idx)) continue
                val e = all[idx]
                e.path = if (parent.isEmpty()) e.name else "$parent/${e.name}"
                out += e
                if (e.left >= 0) stack.addLast(e.left)
                if (e.right >= 0) stack.addLast(e.right)
                if (e.isStorage && e.child >= 0) walk(e.child, e.path)
            }
        }
        all.firstOrNull()?.let { root -> seen += 0; walk(root.child, "") }
        entries = out
    }

    private fun sector(n: Int): ByteArray {
        val b = ByteArray(sectorSize)
        val pos = (n.toLong() + 1) * sectorSize
        if (pos + sectorSize > raf.length()) { // setor truncado: completa com zeros
            if (pos < raf.length()) { raf.seek(pos); raf.read(b, 0, (raf.length() - pos).toInt()) }
            return b
        }
        raf.seek(pos); raf.readFully(b)
        return b
    }

    private fun readChain(start: Int, limit: Long): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        var s = start
        var guard = 0
        val max = fat.size + 2
        while (s >= 0 && guard++ <= max && out.size() < limit) {
            out.write(sector(s))
            s = if (s < fat.size) fat[s] else -2
        }
        return out.toByteArray()
    }

    private fun mini(): ByteArray = miniStream ?: (all.firstOrNull()?.let { root -> readChain(root.start, root.size) } ?: ByteArray(0)).also { miniStream = it }

    fun read(e: Entry, max: Long = 256L * 1024 * 1024): ByteArray {
        val size = minOf(e.size, max).toInt().coerceAtLeast(0)
        if (size == 0) return ByteArray(0)
        if (e.size < miniCutoff) {
            val ms = mini()
            val out = ByteArray(size)
            var s = e.start
            var pos = 0
            var guard = 0
            while (s >= 0 && pos < size && guard++ <= miniFat.size + 1) {
                val off = s * 64
                val n = minOf(64, size - pos)
                if (off + n <= ms.size) System.arraycopy(ms, off, out, pos, n)
                pos += n
                s = if (s < miniFat.size) miniFat[s] else -2
            }
            return out
        }
        val b = readChain(e.start, size.toLong())
        return if (b.size <= size) b else b.copyOf(size)
    }

    fun find(path: String): Entry? = entries.firstOrNull { it.path.equals(path, true) && it.isStream }
    fun findByName(name: String): Entry? = entries.firstOrNull { it.name.equals(name, true) && it.isStream }
    fun children(storage: String): List<Entry> = entries.filter { it.path.substringBeforeLast('/', "").equals(storage, true) }
    fun bytes(path: String): ByteArray? = find(path)?.let { read(it) }

    override fun close() = raf.close()

    companion object {
        fun u16(b: ByteArray, o: Int) = if (o + 1 < b.size) (b[o].toInt() and 0xFF) or ((b[o + 1].toInt() and 0xFF) shl 8) else 0
        fun i32(b: ByteArray, o: Int) = if (o + 3 < b.size) (b[o].toInt() and 0xFF) or ((b[o + 1].toInt() and 0xFF) shl 8) or
            ((b[o + 2].toInt() and 0xFF) shl 16) or ((b[o + 3].toInt() and 0xFF) shl 24) else 0
        fun i64(b: ByteArray, o: Int) = (i32(b, o).toLong() and 0xFFFFFFFFL) or (i32(b, o + 4).toLong() shl 32)
        fun f64(b: ByteArray, o: Int) = java.lang.Double.longBitsToDouble(i64(b, o))

        fun isCfb(f: File): Boolean = try {
            f.inputStream().use { s -> val h = ByteArray(8); s.read(h) == 8 && (h[0].toInt() and 0xFF) == 0xD0 && (h[1].toInt() and 0xFF) == 0xCF && (h[2].toInt() and 0xFF) == 0x11 && (h[3].toInt() and 0xFF) == 0xE0 }
        } catch (e: Exception) { false }
    }
}
