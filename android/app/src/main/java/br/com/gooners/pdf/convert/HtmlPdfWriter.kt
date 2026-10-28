package br.com.gooners.pdf.convert

import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.text.Html
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.TypefaceSpan
import androidx.core.text.HtmlCompat
import br.com.gooners.pdf.App
import java.io.File
import kotlin.math.min

/**
 * Gera PDF vetorial (texto selecionável) a partir de texto formatado, paginando com StaticLayout
 * sobre o PdfDocument nativo do Android. Sem bibliotecas extras.
 */
object HtmlPdfWriter {
    class Page(val w: Int, val h: Int, val margin: Int)

    /** Prepara HTML para o Html.fromHtml (que não entende tabelas e listas em versões antigas). */
    fun simplify(html: String): String {
        var h = html
        h = h.replace(Regex("<(script|style|head)[^>]*>.*?</\\1>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)), "")
        h = h.replace(Regex("<hr class=\"pb\">", RegexOption.IGNORE_CASE), "<p>\u000C</p>")
        h = h.replace(Regex("</t[dh]>", RegexOption.IGNORE_CASE), " &nbsp;│&nbsp; ")
        h = h.replace(Regex("</tr>", RegexOption.IGNORE_CASE), "<br>")
        h = h.replace(Regex("<table[^>]*>", RegexOption.IGNORE_CASE), "<p>")
        h = h.replace(Regex("</table>", RegexOption.IGNORE_CASE), "</p>")
        h = h.replace(Regex("<li[^>]*>", RegexOption.IGNORE_CASE), "<br>•&nbsp;")
        h = h.replace(Regex("</?(ul|ol|li)[^>]*>", RegexOption.IGNORE_CASE), "")
        h = h.replace(Regex("<div class=\"slide-n\">(.*?)</div>", RegexOption.IGNORE_CASE), "<p><small>$1</small></p>")
        return h
    }

    fun fromHtml(html: String, contentWidth: Int, maxImageHeight: Int, images: (String) -> ByteArray?): Spanned {
        val getter = Html.ImageGetter { src ->
            try {
                val bytes = if (src.startsWith("data:")) android.util.Base64.decode(src.substringAfter(","), android.util.Base64.DEFAULT) else images(src)
                bytes ?: return@ImageGetter null
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
                var sample = 1
                while (o.outWidth / (sample * 2) > contentWidth * 2) sample *= 2
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return@ImageGetter null
                val d: Drawable = BitmapDrawable(App.instance.resources, bmp)
                var w = bmp.width.toFloat() * 0.6f
                var h = bmp.height.toFloat() * 0.6f
                val s = min(1f, min(contentWidth / w, maxImageHeight / h))
                w *= s; h *= s
                d.setBounds(0, 0, w.toInt().coerceAtLeast(1), h.toInt().coerceAtLeast(1))
                d
            } catch (e: Throwable) { null }
        }
        return HtmlCompat.fromHtml(simplify(html), HtmlCompat.FROM_HTML_MODE_COMPACT, getter, null)
    }

    fun plain(text: String, mono: Boolean): Spanned {
        val sb = SpannableStringBuilder(text.replace("\r\n", "\n"))
        if (mono) sb.setSpan(TypefaceSpan("monospace"), 0, sb.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        return sb
    }

    @Suppress("DEPRECATION")
    private fun layout(text: CharSequence, paint: TextPaint, width: Int): StaticLayout =
        if (Build.VERSION.SDK_INT >= 23)
            StaticLayout.Builder.obtain(text, 0, text.length, paint, width).setLineSpacing(0f, 1.18f).setIncludePad(true).build()
        else StaticLayout(text, paint, width, Layout.Alignment.ALIGN_NORMAL, 1.18f, 0f, true)

    fun write(text: CharSequence, out: File, page: Page, textSize: Float, title: String? = null, pageNumbers: Boolean = true) {
        val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { this.textSize = textSize; color = Color.BLACK; typeface = Typeface.SANS_SERIF }
        val full = SpannableStringBuilder()
        if (!title.isNullOrBlank()) {
            full.append(title)
            full.setSpan(android.text.style.StyleSpan(Typeface.BOLD), 0, full.length, 0)
            full.setSpan(android.text.style.RelativeSizeSpan(1.6f), 0, full.length, 0)
            full.append("\n\n")
        }
        full.append(text)
        val cw = page.w - page.margin * 2
        val ch = page.h - page.margin * 2 - if (pageNumbers) 14 else 0
        val lay = layout(full, paint, cw)
        val doc = PdfDocument()
        val numPaint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { this.textSize = 8f; color = Color.GRAY; textAlign = android.graphics.Paint.Align.CENTER }
        var line = 0
        var pageNo = 0
        val count = lay.lineCount
        while (line < count) {
            val top = lay.getLineTop(line)
            var end = line
            while (end < count && lay.getLineBottom(end) - top <= ch) {
                // quebra de página manual (caractere \f no início da linha)
                if (end > line && full.getOrNull(lay.getLineStart(end)) == '\u000C') break
                end++
            }
            if (end == line) end = line + 1
            val pg = doc.startPage(PdfDocument.PageInfo.Builder(page.w, page.h, ++pageNo).create())
            val c = pg.canvas
            c.save()
            c.translate(page.margin.toFloat(), (page.margin - top).toFloat())
            c.clipRect(0, top, cw, lay.getLineBottom(end - 1))
            lay.draw(c)
            c.restore()
            if (pageNumbers) c.drawText("$pageNo", page.w / 2f, page.h - page.margin / 2f, numPaint)
            doc.finishPage(pg)
            line = end
            if (pageNo > 5000) break
        }
        if (pageNo == 0) doc.finishPage(doc.startPage(PdfDocument.PageInfo.Builder(page.w, page.h, 1).create()))
        out.outputStream().use { doc.writeTo(it) }
        doc.close()
    }
}
