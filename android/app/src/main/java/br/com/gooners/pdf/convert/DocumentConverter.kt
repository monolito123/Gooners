package br.com.gooners.pdf.convert

import android.content.Context
import android.net.Uri
import android.util.Base64
import br.com.gooners.pdf.tools.PdfTools
import br.com.gooners.pdf.tools.Progress
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import java.io.Closeable
import java.io.File

/** Documento convertido para HTML, com acesso aos recursos (imagens) do pacote original. */
class HtmlDoc(val title: String, val body: String, val zip: ZipRes?, val epub: EpubBook?, val raw: Boolean) : Closeable {
    fun resource(url: String): ByteArray? {
        val z = zip ?: return null
        if (!url.startsWith(DocumentConverter.BASE)) return null
        return z.bytes(Uri.decode(url.removePrefix(DocumentConverter.BASE).substringBefore('#').substringBefore('?')))
    }

    override fun close() { try { zip?.close() } catch (_: Exception) {} }
}

object DocumentConverter {
    const val BASE = "https://doc.local/"
    private const val MAX_TEXT = 12L * 1024 * 1024

    fun css(night: Boolean) = """
        :root{color-scheme:${if (night) "dark" else "light"}}
        body{font-family:sans-serif;line-height:1.55;margin:0 auto;padding:16px 14px 48px;max-width:960px;word-wrap:break-word;overflow-wrap:anywhere;
             color:${if (night) "#e5e7eb" else "#111318"};background:${if (night) "#111214" else "#ffffff"}}
        img,svg,video{max-width:100%;height:auto}
        table{border-collapse:collapse;margin:8px 0;font-size:.92em;max-width:100%;display:block;overflow-x:auto}
        td,th{border:1px solid ${if (night) "#3a3d45" else "#d1d5db"};padding:4px 8px;vertical-align:top}
        th{background:${if (night) "#1f2128" else "#f3f4f6"};font-weight:600}
        table.grid{display:table;white-space:nowrap} table.grid th{position:sticky;top:0} td.n{text-align:right}
        pre,code{font-family:monospace;background:${if (night) "#1c1d22" else "#f4f4f5"};border-radius:4px}
        pre{padding:10px;overflow-x:auto} code{padding:1px 4px}
        blockquote{margin:8px 0;padding:4px 12px;border-left:3px solid #6366f1;color:${if (night) "#c7c9d1" else "#4b5563"}}
        a{color:#4f46e5}
        hr.pb{border:0;border-top:1px dashed #9ca3af;margin:24px 0}
        .slide{border:1px solid ${if (night) "#3a3d45" else "#d1d5db"};border-radius:10px;padding:14px 18px;margin:0 0 18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
        .slide-n{font-size:.75em;color:#9ca3af;margin-bottom:6px}
        .sheet{margin-top:22px;color:#059669}
        .tabs{position:sticky;top:0;background:inherit;padding:6px 0;overflow-x:auto;white-space:nowrap;z-index:2}
        .tabs a{display:inline-block;padding:4px 10px;margin-right:6px;border-radius:14px;background:${if (night) "#22242b" else "#eef2ff"};text-decoration:none}
        .note{font-size:.85em;padding:8px 12px;border-radius:8px;background:${if (night) "#2a2410" else "#fef3c7"};margin-bottom:14px}
        .poem{margin:8px 24px;font-style:italic}
    """.trimIndent()

    fun wrap(body: String, title: String, night: Boolean): String =
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<title>${X.esc(title)}</title><style>${css(night)}</style></head><body>$body</body></html>"

    fun load(ctx: Context, file: File, kind: DocKind, name: String): HtmlDoc {
        val title = FileUtil.baseName(name)
        fun zip() = ZipRes(file)
        return when (kind) {
            DocKind.DOCX -> zip().let { z -> HtmlDoc(title, DocxParser.toHtml(z, BASE), z, null, false) }
            DocKind.ODT, DocKind.ODS, DocKind.ODP -> zip().let { z -> HtmlDoc(title, OdfParser.toHtml(z, BASE), z, null, false) }
            DocKind.XLSX -> zip().let { z -> HtmlDoc(title, XlsxParser.toHtml(z), z, null, false) }
            DocKind.PPTX -> zip().let { z -> HtmlDoc(title, PptxParser.toHtml(z, BASE), z, null, false) }
            DocKind.EPUB -> zip().let { z -> val b = EpubBook(z); HtmlDoc(b.title.ifBlank { title }, "", z, b, false) }
            DocKind.RTF -> HtmlDoc(title, RtfParser.toHtml(readText(file)), null, null, false)
            DocKind.FB2 -> HtmlDoc(title, Fb2Parser.toHtml(readText(file)), null, null, false)
            DocKind.MARKDOWN -> HtmlDoc(title, Markdown.toHtml(readText(file)), null, null, false)
            DocKind.CSV -> HtmlDoc(title, CsvParser.toHtml(readText(file)), null, null, false)
            DocKind.HTML -> HtmlDoc(title, readText(file), null, null, true)
            DocKind.SVG -> HtmlDoc(title, "<div style=\"text-align:center\"><img style=\"width:100%\" src=\"data:image/svg+xml;base64," +
                Base64.encodeToString(file.readBytes(), Base64.NO_WRAP) + "\"></div>", null, null, false)
            DocKind.DOC, DocKind.XLS, DocKind.PPT -> HtmlDoc(title, LegacyOffice.toHtml(file.readBytes()), null, null, false)
            else -> HtmlDoc(title, "<pre>" + X.esc(readText(file)) + "</pre>", null, null, false)
        }
    }

    fun readText(file: File): String {
        val bytes = if (file.length() > MAX_TEXT) file.inputStream().use { s -> ByteArray(MAX_TEXT.toInt()).also { s.read(it) } } else file.readBytes()
        return ZipRes.decode(bytes)
    }

    /** Converte qualquer documento suportado em PDF. */
    fun toPdf(ctx: Context, file: File, kind: DocKind, name: String, out: File, sizeIndex: Int, landscape: Boolean, textSize: Float, progress: Progress) {
        val ps = PdfTools.pageSizes[sizeIndex]
        val w = (if (landscape) ps.h else ps.w).toInt()
        val h = (if (landscape) ps.w else ps.h).toInt()
        val page = HtmlPdfWriter.Page(w, h, 48)
        val title = FileUtil.baseName(name)
        progress("Lendo o documento…", null)
        when (kind) {
            DocKind.PDF -> file.copyTo(out, true)
            DocKind.IMAGE -> PdfTools.imagesToPdf(ctx, listOf(Uri.fromFile(file)), out, sizeIndex, 24f, 0.9f, progress)
            DocKind.TEXT, DocKind.CODE, DocKind.UNKNOWN -> {
                progress("Gerando PDF…", null)
                HtmlPdfWriter.write(HtmlPdfWriter.plain(readText(file), kind == DocKind.CODE), out, page, if (kind == DocKind.CODE) textSize * 0.85f else textSize)
            }
            else -> load(ctx, file, kind, name).use { doc ->
                val html = when {
                    doc.epub != null -> doc.epub.combinedHtml(BASE)
                    else -> doc.body
                }
                progress("Gerando PDF…", null)
                val spanned = HtmlPdfWriter.fromHtml(html, w - 96, h - 140) { src -> doc.resource(src) }
                HtmlPdfWriter.write(spanned, out, page, textSize, if (kind == DocKind.EPUB) doc.title else null)
            }
        }
    }
}
