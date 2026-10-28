package br.com.gooners.pdf.viewer

import android.graphics.RectF
import br.com.gooners.pdf.edit.PdfBoxUtil
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import java.io.Closeable
import java.io.File
import java.text.Normalizer

class TextLine(val text: String, val rect: RectF, val fontSize: Float)

/** Texto de uma página com a caixa de cada caractere (coordenadas da página exibida, Y para baixo). */
class PageText(val text: String, val boxes: Array<RectF?>, val lines: List<TextLine>) {
    private val folded by lazy { fold(text) }

    fun find(query: String): List<RectF> {
        val q = fold(query)
        if (q.isBlank()) return emptyList()
        val out = ArrayList<RectF>()
        var idx = folded.indexOf(q)
        while (idx >= 0) {
            // junta as caixas da ocorrência, separando por linha
            var cur: RectF? = null
            for (i in idx until idx + q.length) {
                val b = boxes.getOrNull(i) ?: continue
                cur = if (cur == null) RectF(b) else if (kotlin.math.abs(b.centerY() - cur.centerY()) < b.height() / 2) cur.apply { union(b) } else {
                    out += cur; RectF(b)
                }
            }
            cur?.let { out += it }
            idx = folded.indexOf(q, idx + q.length)
        }
        return out
    }

    fun lineAt(x: Float, y: Float): TextLine? {
        val slop = 4f
        return lines.firstOrNull { RectF(it.rect).apply { inset(-slop, -slop) }.contains(x, y) }
            ?: lines.minByOrNull { l -> val dy = l.rect.centerY() - y; if (x in l.rect.left..l.rect.right) kotlin.math.abs(dy) else Float.MAX_VALUE }
                ?.takeIf { kotlin.math.abs(it.rect.centerY() - y) < it.fontSize * 1.5f && x in it.rect.left - 20..it.rect.right + 20 }
    }

    companion object {
        /** Minúsculas e sem acentos, mantendo o mesmo comprimento (1 caractere -> 1 caractere). */
        fun fold(s: String): String {
            val sb = StringBuilder(s.length)
            for (ch in s) {
                val d = Normalizer.normalize(ch.toString(), Normalizer.Form.NFD)
                sb.append(d.firstOrNull()?.lowercaseChar() ?: ch)
            }
            return sb.toString()
        }
    }
}

/** Extrai texto com posições via PdfBox; uma instância por documento, chamadas sincronizadas. */
class PdfText(private val file: File, private val password: String?) : Closeable {
    private var doc: PDDocument? = null
    private val cache = HashMap<Int, PageText>()

    @Synchronized
    private fun document(): PDDocument = doc ?: PdfBoxUtil.load(file, password).also { doc = it }

    @Synchronized
    fun page(index: Int): PageText {
        cache[index]?.let { return it }
        val d = document()
        val chars = StringBuilder()
        val boxes = ArrayList<RectF?>()
        val lines = ArrayList<TextLine>()
        var lineText = StringBuilder()
        var lineRect: RectF? = null
        var lineSize = 0f

        fun endLine() {
            val r = lineRect
            if (r != null && lineText.isNotBlank()) lines += TextLine(lineText.toString().trim(), r, lineSize)
            lineText = StringBuilder(); lineRect = null; lineSize = 0f
        }

        val stripper = object : PDFTextStripper() {
            override fun writeString(text: String, textPositions: MutableList<TextPosition>) {
                for (tp in textPositions) {
                    val u = tp.unicode ?: continue
                    val size = if (tp.fontSizeInPt > 0) tp.fontSizeInPt else tp.heightDir.coerceAtLeast(6f)
                    // x/y já vêm ajustados à rotação da página, com origem no canto superior esquerdo
                    val r = RectF(tp.x, tp.y - size * 0.85f, tp.x + tp.width, tp.y + size * 0.2f)
                    for (c in u) { chars.append(c); boxes.add(r) }
                    lineText.append(u)
                    lineRect = lineRect?.apply { union(r) } ?: RectF(r)
                    lineSize = maxOf(lineSize, size)
                }
            }

            override fun writeWordSeparator() {
                chars.append(' '); boxes.add(null); lineText.append(' ')
            }

            override fun writeLineSeparator() {
                chars.append('\n'); boxes.add(null); endLine()
            }
        }
        stripper.sortByPosition = true
        stripper.startPage = index + 1
        stripper.endPage = index + 1
        try {
            stripper.getText(d)
        } catch (_: Exception) {
        }
        endLine()
        val pt = PageText(chars.toString(), boxes.toTypedArray(), lines)
        if (cache.size > 300) cache.clear()
        cache[index] = pt
        return pt
    }

    @Synchronized
    fun invalidate() {
        cache.clear()
        try { doc?.close() } catch (_: Exception) {}
        doc = null
    }

    @Synchronized
    override fun close() = invalidate()
}
