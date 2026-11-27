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

/**
 * Documento convertido para HTML, com acesso aos recursos do pacote original (imagens do ZIP)
 * e a arquivos virtuais (anexos de e-mail, imagens de e-books, fontes).
 */
class HtmlDoc(
    val title: String,
    val body: String,
    val zip: ZipRes?,
    val epub: EpubBook?,
    val raw: Boolean,
    val files: Map<String, VFile> = emptyMap(),
    /** quando o formato tem uma versão PDF pronta (ex.: pré-visualização do iWork), abre o leitor de PDF */
    val redirectPdf: File? = null
) : Closeable {
    fun virtual(url: String): VFile? {
        if (!url.startsWith(DocumentConverter.BASE)) return null
        val path = Uri.decode(url.removePrefix(DocumentConverter.BASE).substringBefore('#').substringBefore('?'))
        return when {
            path.startsWith("v/") -> files[path.removePrefix("v/")]
            path.startsWith("open/") -> files[path.removePrefix("open/")]
            else -> null
        }
    }

    fun resource(url: String): ByteArray? {
        virtual(url)?.let { return it.bytes }
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
        .slide-n{font-size:.75em;color:#9ca3af;margin:10px 0 6px}
        .sheet{margin-top:22px;color:#059669}
        .tabs{position:sticky;top:0;background:inherit;padding:6px 0;overflow-x:auto;white-space:nowrap;z-index:2}
        .tabs a{display:inline-block;padding:4px 10px;margin-right:6px;border-radius:14px;background:${if (night) "#22242b" else "#eef2ff"};text-decoration:none}
        .note{font-size:.85em;padding:8px 12px;border-radius:8px;background:${if (night) "#2a2410" else "#fef3c7"};margin-bottom:14px}
        .poem{margin:8px 24px;font-style:italic}
        .mailhead{border-bottom:1px solid ${if (night) "#3a3d45" else "#e5e7eb"};margin-bottom:14px;padding-bottom:6px}
        .mailhead h2{margin:0 0 8px}
        table.meta{display:table;border:0;font-size:.9em} table.meta th,table.meta td{border:0;background:none;padding:2px 10px 2px 0;text-align:left}
        table.meta th{color:#6b7280;font-weight:500;white-space:nowrap}
        .plain{white-space:pre-wrap;font-family:inherit}
        .atts{display:flex;flex-wrap:wrap;gap:8px}
        a.att{display:inline-block;padding:8px 12px;border-radius:10px;background:${if (night) "#22242b" else "#eef2ff"};text-decoration:none;margin:4px 6px 4px 0}
        .card{display:flex;gap:12px;align-items:flex-start;border:1px solid ${if (night) "#3a3d45" else "#e5e7eb"};border-radius:12px;padding:12px;margin:0 0 10px}
        .card ul{margin:6px 0 0;padding-left:18px} .card li{margin:2px 0}
        .avatar{flex:0 0 52px;width:52px;height:52px;border-radius:26px;background:${if (night) "#2e2a6b" else "#e0e7ff"};display:flex;align-items:center;justify-content:center;font-size:24px;overflow:hidden}
        .avatar img{width:100%;height:100%;object-fit:cover}
        .cell{margin:10px 0} .cell .in{font-size:.75em;color:#6366f1;font-family:monospace}
        pre.out{background:none;border-left:3px solid #9ca3af;border-radius:0} pre.err{border-color:#dc2626;color:#dc2626}
        svg.xps{display:block;width:100%;height:auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);margin:0 0 14px}
        details summary{cursor:pointer;color:#6b7280;font-size:.85em}
    """.trimIndent()

    fun wrap(body: String, title: String, night: Boolean): String =
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<title>${X.esc(title)}</title><style>${css(night)}</style></head><body>$body</body></html>"

    private fun mail(title: String, r: MailResult) = HtmlDoc(r.title?.takeIf { it.isNotBlank() } ?: title, r.body, null, null, false, r.files)

    fun load(ctx: Context, file: File, kind: DocKind, name: String): HtmlDoc {
        val title = FileUtil.baseName(name)
        fun zip() = ZipRes(file)
        return when (kind) {
            DocKind.DOCX -> zip().let { z -> HtmlDoc(title, DocxParser.toHtml(z, BASE), z, null, false) }
            DocKind.ODT, DocKind.ODS, DocKind.ODP -> zip().let { z -> HtmlDoc(title, OdfParser.toHtml(z, BASE), z, null, false) }
            DocKind.XLSX -> zip().let { z -> HtmlDoc(title, XlsxParser.toHtml(z), z, null, false) }
            DocKind.PPTX -> zip().let { z -> HtmlDoc(title, PptxParser.toHtml(z, BASE), z, null, false) }
            DocKind.EPUB -> zip().let { z -> val b = EpubBook(z); HtmlDoc(b.title.ifBlank { title }, "", z, b, false) }
            DocKind.XPS -> zip().let { z -> HtmlDoc(title, XpsParser.toHtml(z), z, null, false) }
            DocKind.IWORK -> zip().let { z ->
                val p = IWork.preview(z)
                when {
                    p.pdfPath != null -> {
                        val out = FileUtil.newOutFile(ctx, "$title.pdf")
                        z.stream(p.pdfPath)?.use { i -> out.outputStream().use { i.copyTo(it) } }
                        HtmlDoc(title, "", z, null, false, redirectPdf = out)
                    }
                    else -> HtmlDoc(title, "<div class=\"note\">Arquivos do iWork guardam o conteúdo num formato fechado da Apple. " +
                        "Exibindo a pré-visualização salva junto com o arquivo.</div>" +
                        (p.imagePath?.let { "<p><img src=\"$BASE${X.esc(it)}\"></p>" } ?: "") +
                        (p.text?.let { t -> t.split('\n').joinToString("") { "<p>" + X.esc(it) + "</p>" } } ?: ""), z, null, false)
                }
            }
            DocKind.RTF -> HtmlDoc(title, RtfParser.toHtml(readText(file)), null, null, false)
            DocKind.FB2 -> HtmlDoc(title, Fb2Parser.toHtml(readText(file)), null, null, false)
            DocKind.MARKDOWN -> HtmlDoc(title, Markdown.toHtml(readText(file)), null, null, false)
            DocKind.CSV -> HtmlDoc(title, CsvParser.toHtml(readText(file)), null, null, false)
            DocKind.HTML -> HtmlDoc(title, readText(file), null, null, true)
            DocKind.SVG -> HtmlDoc(title, "<div style=\"text-align:center\"><img style=\"width:100%\" src=\"data:image/svg+xml;base64," +
                Base64.encodeToString(file.readBytes(), Base64.NO_WRAP) + "\"></div>", null, null, false)
            DocKind.DOC, DocKind.XLS, DocKind.PPT -> HtmlDoc(title, LegacyOffice.toHtml(file), null, null, false)
            DocKind.MSG -> Cfb(file).use { mail(title, MsgParser.toHtml(it)) }
            DocKind.EML -> mail(title, EmlParser.toHtml(file.readBytes(), name))
            DocKind.MOBI -> mail(title, MobiParser.toHtml(file.readBytes()))
            DocKind.IPYNB -> HtmlDoc(title, Notebook.toHtml(readText(file)), null, null, false)
            DocKind.VCARD -> HtmlDoc(title, VCard.toHtml(readText(file)), null, null, false)
            DocKind.ICAL -> HtmlDoc(title, ICal.toHtml(readText(file)), null, null, false)
            DocKind.TORRENT -> HtmlDoc(title, Torrent.toHtml(file.readBytes()), null, null, false)
            DocKind.SQLITE -> HtmlDoc(title, SqliteViewer.toHtml(file), null, null, false)
            DocKind.FONT -> mail(title, FontInfo.toHtml(file.readBytes(), name))
            DocKind.APK -> HtmlDoc(title, ApkInfo.toHtml(ctx, file), null, null, false)
            DocKind.DJVU -> HtmlDoc(title, "<div class=\"note\">O formato DjVu precisa de um decodificador nativo que não acompanha este app. " +
                "Use \"Abrir com outro app\" no menu, ou converta o arquivo para PDF.</div><p><a class=\"att\" href=\"${BASE}action/other\">Abrir com outro app</a></p>", null, null, false)
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
        progress("Lendo o documento…", null)
        when (kind) {
            DocKind.PDF -> file.copyTo(out, true)
            DocKind.IMAGE -> PdfTools.imagesToPdf(ctx, listOf(Uri.fromFile(file)), out, sizeIndex, 24f, 0.9f, progress)
            DocKind.TEXT, DocKind.CODE, DocKind.UNKNOWN -> {
                progress("Gerando PDF…", null)
                HtmlPdfWriter.write(HtmlPdfWriter.plain(readText(file), kind == DocKind.CODE), out, page, if (kind == DocKind.CODE) textSize * 0.85f else textSize)
            }
            else -> load(ctx, file, kind, name).use { doc ->
                if (doc.redirectPdf != null) { doc.redirectPdf.copyTo(out, true); return }
                val html = when {
                    doc.epub != null -> doc.epub.combinedHtml(BASE)
                    else -> doc.body
                }
                progress("Gerando PDF…", null)
                val spanned = HtmlPdfWriter.fromHtml(html, w - 96, h - 140) { src -> doc.resource(src) }
                HtmlPdfWriter.write(spanned, out, page, textSize, if (kind == DocKind.EPUB || kind == DocKind.MOBI) doc.title else null)
            }
        }
    }
}
