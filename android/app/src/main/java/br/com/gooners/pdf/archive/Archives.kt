package br.com.gooners.pdf.archive

import android.os.Build
import br.com.gooners.pdf.util.FileUtil
import com.github.junrar.Archive
import com.github.junrar.rarfile.FileHeader
import org.apache.commons.compress.archivers.ArchiveInputStream
import org.apache.commons.compress.archivers.ar.ArArchiveInputStream
import org.apache.commons.compress.archivers.arj.ArjArchiveInputStream
import org.apache.commons.compress.archivers.cpio.CpioArchiveInputStream
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.apache.commons.compress.compressors.lzma.LZMACompressorInputStream
import org.apache.commons.compress.compressors.xz.XZCompressorInputStream
import org.apache.commons.compress.compressors.z.ZCompressorInputStream
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.nio.charset.Charset
import java.util.zip.ZipFile

class ArchiveEntry(val path: String, val size: Long, val index: Int) {
    val name get() = path.substringAfterLast('/')
}

/** Leitura uniforme de qualquer arquivo compactado suportado. */
interface ArchiveReader : Closeable {
    val format: String
    val entries: List<ArchiveEntry>
    fun open(e: ArchiveEntry): InputStream

    fun bytes(e: ArchiveEntry, limit: Long = 96L * 1024 * 1024): ByteArray? {
        if (e.size > limit) return null
        return open(e).use { s ->
            val out = ByteArrayOutputStream(if (e.size in 1..limit) e.size.toInt() else 64 * 1024)
            val buf = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = s.read(buf)
                if (n < 0) break
                total += n
                if (total > limit) return null
                out.write(buf, 0, n)
            }
            out.toByteArray()
        }
    }

    /** Extrai para [dir] protegendo contra caminhos que saem da pasta ("zip slip"). */
    fun extract(e: ArchiveEntry, dir: File): File {
        val out = File(dir, e.path.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." && it != ".." }.joinToString("/").ifEmpty { "arquivo" })
        if (!out.canonicalPath.startsWith(dir.canonicalPath)) throw SecurityException("Caminho inválido dentro do arquivo")
        out.parentFile?.mkdirs()
        if (!out.exists() || out.length() != e.size || e.size <= 0) open(e).use { i -> out.outputStream().use { i.copyTo(it, 64 * 1024) } }
        return out
    }
}

object Archives {
    private fun head(f: File, n: Int = 600): ByteArray = FileInputStream(f).use { s ->
        val b = ByteArray(n); var t = 0
        while (t < n) { val r = s.read(b, t, n - t); if (r <= 0) break; t += r }
        b.copyOf(t)
    }

    private fun ByteArray.at(off: Int, vararg v: Int) = size >= off + v.size && v.indices.all { (this[off + it].toInt() and 0xFF) == v[it] }
    private fun ByteArray.str(off: Int, s: String) = size >= off + s.length && s.indices.all { this[off + it].toInt().toChar() == s[it] }

    /** Descompactador de fluxo (gz, bz2, xz, lzma, Z) ou null se o arquivo não for compactado assim. */
    fun decompressor(h: ByteArray): ((InputStream) -> InputStream)? = when {
        h.at(0, 0x1F, 0x8B) -> { s -> GzipCompressorInputStream(BufferedInputStream(s), true) }
        h.str(0, "BZh") -> { s -> BZip2CompressorInputStream(BufferedInputStream(s), true) }
        h.at(0, 0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00) -> { s -> XZCompressorInputStream(BufferedInputStream(s), true) }
        h.at(0, 0x1F, 0x9D) -> { s -> ZCompressorInputStream(BufferedInputStream(s)) }
        h.at(0, 0x5D, 0x00, 0x00) -> { s -> LZMACompressorInputStream(BufferedInputStream(s)) }
        else -> null
    }

    fun open(file: File, name: String): ArchiveReader {
        val h = head(file)
        return when {
            h.at(0, 0x50, 0x4B) -> ZipReader(file)
            h.str(0, "7z") && h.at(2, 0xBC, 0xAF, 0x27, 0x1C) -> SevenZReader(file)
            h.str(0, "Rar!") -> RarReader(file)
            h.str(257, "ustar") -> StreamReader(file, "TAR", null) { TarArchiveInputStream(it) }
            h.str(0, "!<arch>") -> StreamReader(file, if (FileUtil.extension(name) == "deb") "DEB" else "AR", null) { ArArchiveInputStream(it) }
            h.str(0, "070707") || h.str(0, "070701") || h.str(0, "070702") || h.at(0, 0xC7, 0x71) || h.at(0, 0x71, 0xC7) ->
                StreamReader(file, "CPIO", null) { CpioArchiveInputStream(it) }
            h.at(0, 0x60, 0xEA) -> StreamReader(file, "ARJ", null) { ArjArchiveInputStream(it) }
            h.str(0, "MSCF") -> throw UnsupportedOperationException("Arquivos CAB da Microsoft ainda não são suportados.")
            else -> {
                val dec = decompressor(h) ?: throw UnsupportedOperationException("Formato compactado não reconhecido.")
                // .tar.gz, .tgz etc.: confere se há um TAR dentro
                val inner = try { FileInputStream(file).use { s -> dec(s).use { d -> val b = ByteArray(512); var t = 0; while (t < 512) { val r = d.read(b, t, 512 - t); if (r <= 0) break; t += r }; b } } } catch (e: Exception) { ByteArray(0) }
                val fmt = when { h.at(0, 0x1F, 0x8B) -> "GZIP"; h.str(0, "BZh") -> "BZIP2"; h.at(0, 0xFD, 0x37) -> "XZ"; h.at(0, 0x1F, 0x9D) -> "Z"; else -> "LZMA" }
                if (inner.str(257, "ustar")) StreamReader(file, "TAR.$fmt", dec) { TarArchiveInputStream(it) }
                else SingleReader(file, fmt, dec, stripCompressionExt(name))
            }
        }
    }

    fun stripCompressionExt(name: String): String {
        val lower = name.lowercase()
        for (ext in listOf(".gz", ".gzip", ".bz2", ".xz", ".lzma", ".z")) if (lower.endsWith(ext)) return name.dropLast(ext.length).ifEmpty { "arquivo" }
        return when {
            lower.endsWith(".tgz") -> name.dropLast(4) + ".tar"
            lower.endsWith(".tbz2") || lower.endsWith(".tbz") -> name.substringBeforeLast('.') + ".tar"
            else -> FileUtil.baseName(name)
        }
    }
}

private class ZipReader(file: File) : ArchiveReader {
    override val format = "ZIP"
    private val zip: ZipFile = try {
        ZipFile(file).also { z -> z.entries().toList() }
    } catch (e: IllegalArgumentException) {
        // nomes em CP437 (ZIPs antigos do Windows)
        if (Build.VERSION.SDK_INT >= 24) ZipFile(file, Charset.forName("IBM437")) else throw e
    }
    override val entries: List<ArchiveEntry> = zip.entries().toList().filter { !it.isDirectory }.mapIndexed { i, e -> ArchiveEntry(e.name, e.size, i) }
    override fun open(e: ArchiveEntry): InputStream = zip.getInputStream(zip.getEntry(e.path) ?: throw IllegalStateException("Item não encontrado"))
    override fun close() = zip.close()
}

private class SevenZReader(file: File) : ArchiveReader {
    override val format = "7z"
    private val fis = FileInputStream(file)
    private val z: SevenZFile
    private val raw: List<SevenZArchiveEntry>

    init {
        if (Build.VERSION.SDK_INT < 24) { fis.close(); throw UnsupportedOperationException("Arquivos 7z precisam do Android 7.0 ou mais recente.") }
        z = SevenZFile.builder().setSeekableByteChannel(fis.channel).get()
        raw = z.entries.filter { !it.isDirectory && !it.isAntiItem }
    }

    override val entries: List<ArchiveEntry> = raw.mapIndexed { i, e -> ArchiveEntry(e.name ?: "item_$i", e.size, i) }
    override fun open(e: ArchiveEntry): InputStream = z.getInputStream(raw[e.index])
    override fun close() { z.close(); fis.close() }
}

private class RarReader(file: File) : ArchiveReader {
    override val format = "RAR"
    private val archive: Archive = try {
        Archive(file)
    } catch (e: Throwable) {
        if (e.javaClass.simpleName.contains("V5")) throw UnsupportedOperationException("Arquivos RAR 5 ainda não são suportados. Use RAR 4, ZIP ou 7z.")
        throw IllegalStateException("Não foi possível ler o RAR: ${e.message ?: e.javaClass.simpleName}")
    }
    private val headers: List<FileHeader>

    init {
        if (archive.isEncrypted) throw IllegalStateException("Este arquivo RAR é protegido por senha.")
        headers = archive.fileHeaders.filter { !it.isDirectory }
    }

    @Suppress("DEPRECATION")
    override val entries: List<ArchiveEntry> = headers.mapIndexed { i, h ->
        ArchiveEntry((h.fileName ?: "item_$i").replace('\\', '/'), h.fullUnpackSize, i)
    }

    override fun open(e: ArchiveEntry): InputStream = archive.getInputStream(headers[e.index])
    override fun close() = archive.close()
}

/** Formatos lidos sequencialmente (TAR, AR, CPIO, ARJ), opcionalmente dentro de gz/bz2/xz. */
private class StreamReader(
    private val file: File,
    override val format: String,
    private val dec: ((InputStream) -> InputStream)?,
    private val make: (InputStream) -> ArchiveInputStream<*>
) : ArchiveReader {
    private fun stream(): ArchiveInputStream<*> {
        val base: InputStream = BufferedInputStream(FileInputStream(file), 64 * 1024)
        return make(dec?.invoke(base) ?: base)
    }

    override val entries: List<ArchiveEntry> = stream().use { s ->
        val out = ArrayList<ArchiveEntry>()
        var i = 0
        while (out.size < 100_000) {
            val e = s.nextEntry ?: break
            if (!e.isDirectory) out += ArchiveEntry(e.name, e.size, i)
            i++
        }
        out
    }

    override fun open(e: ArchiveEntry): InputStream {
        val s = stream()
        var i = 0
        while (true) {
            val x = s.nextEntry ?: break
            if (i == e.index) return s
            i++
        }
        s.close()
        throw IllegalStateException("Item não encontrado")
    }

    override fun close() {}
}

/** Um único arquivo comprimido (ex.: relatorio.pdf.gz). */
private class SingleReader(private val file: File, override val format: String, private val dec: (InputStream) -> InputStream, name: String) : ArchiveReader {
    override val entries = listOf(ArchiveEntry(name, -1, 0))
    override fun open(e: ArchiveEntry): InputStream = dec(FileInputStream(file))
    override fun close() {}
}
