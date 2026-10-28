package br.com.gooners.pdf.convert

import java.io.Closeable
import java.io.File
import java.util.zip.ZipFile

/** Acesso aleatório às partes de um pacote ZIP (DOCX, XLSX, PPTX, ODF, EPUB, CBZ). */
class ZipRes(file: File) : Closeable {
    private val zip = ZipFile(file)
    private val names: Map<String, String> by lazy {
        val m = HashMap<String, String>()
        for (e in zip.entries()) m[e.name.lowercase()] = e.name
        m
    }

    fun has(path: String) = entry(path) != null

    private fun entry(path: String) = zip.getEntry(norm(path)) ?: names[norm(path).lowercase()]?.let { zip.getEntry(it) }

    fun bytes(path: String, limit: Long = 64L * 1024 * 1024): ByteArray? {
        val e = entry(path) ?: return null
        if (e.size > limit) return null
        return zip.getInputStream(e).use { it.readBytes() }
    }

    fun text(path: String): String? = bytes(path)?.let { decode(it) }

    fun stream(path: String) = entry(path)?.let { zip.getInputStream(it) }

    fun entries(): List<String> = zip.entries().toList().filter { !it.isDirectory }.map { it.name }

    override fun close() = zip.close()

    companion object {
        fun norm(p: String): String {
            val parts = ArrayList<String>()
            for (s in p.replace('\\', '/').split('/')) {
                when (s) {
                    "", "." -> {}
                    ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.size - 1)
                    else -> parts += s
                }
            }
            return parts.joinToString("/")
        }

        /** Resolve [target] relativo à pasta do arquivo [from]. */
        fun resolve(from: String, target: String): String {
            if (target.startsWith("/")) return norm(target)
            val dir = from.substringBeforeLast('/', "")
            return norm(if (dir.isEmpty()) target else "$dir/$target")
        }

        fun decode(b: ByteArray): String {
            if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte()) return String(b, 3, b.size - 3, Charsets.UTF_8)
            if (b.size >= 2 && b[0] == 0xFF.toByte() && b[1] == 0xFE.toByte()) return String(b, 2, b.size - 2, Charsets.UTF_16LE)
            if (b.size >= 2 && b[0] == 0xFE.toByte() && b[1] == 0xFF.toByte()) return String(b, 2, b.size - 2, Charsets.UTF_16BE)
            val head = String(b, 0, minOf(b.size, 300), Charsets.ISO_8859_1)
            val enc = Regex("encoding=[\"']([A-Za-z0-9_-]+)").find(head)?.groupValues?.get(1)
                ?: Regex("charset=[\"']?([A-Za-z0-9_-]+)", RegexOption.IGNORE_CASE).find(String(b, 0, minOf(b.size, 2048), Charsets.ISO_8859_1))?.groupValues?.get(1)
            if (enc != null) runCatching { return String(b, charset(enc)) }
            return TextDecode.decode(b)
        }
    }
}

object TextDecode {
    /** UTF-8 se for válido; senão Windows-1252 (arquivos antigos em português). */
    fun decode(b: ByteArray): String {
        if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte()) return String(b, 3, b.size - 3, Charsets.UTF_8)
        if (b.size >= 2 && b[0] == 0xFF.toByte() && b[1] == 0xFE.toByte()) return String(b, 2, b.size - 2, Charsets.UTF_16LE)
        if (b.size >= 2 && b[0] == 0xFE.toByte() && b[1] == 0xFF.toByte()) return String(b, 2, b.size - 2, Charsets.UTF_16BE)
        val dec = Charsets.UTF_8.newDecoder()
        return try {
            dec.decode(java.nio.ByteBuffer.wrap(b)).toString()
        } catch (e: java.nio.charset.CharacterCodingException) {
            String(b, charset("windows-1252"))
        }
    }
}
