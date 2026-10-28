package br.com.gooners.pdf.util

import android.content.Context
import android.net.Uri
import br.com.gooners.pdf.R
import java.util.zip.ZipInputStream

enum class DocKind(val label: String, val icon: Int, val color: Int) {
    PDF("PDF", R.drawable.ic_pdf, R.color.pdf_red),
    IMAGE("Imagem", R.drawable.ic_image, R.color.image_purple),
    SVG("SVG", R.drawable.ic_image, R.color.image_purple),
    TEXT("Texto", R.drawable.ic_doc, R.color.text_gray),
    CODE("Código", R.drawable.ic_code, R.color.text_gray),
    MARKDOWN("Markdown", R.drawable.ic_doc, R.color.text_gray),
    HTML("HTML", R.drawable.ic_code, R.color.ppt_orange),
    CSV("CSV", R.drawable.ic_table, R.color.excel_green),
    DOCX("Word", R.drawable.ic_doc, R.color.word_blue),
    DOC("Word 97-2003", R.drawable.ic_doc, R.color.word_blue),
    ODT("OpenDocument Texto", R.drawable.ic_doc, R.color.word_blue),
    RTF("RTF", R.drawable.ic_doc, R.color.word_blue),
    XLSX("Excel", R.drawable.ic_table, R.color.excel_green),
    XLS("Excel 97-2003", R.drawable.ic_table, R.color.excel_green),
    ODS("OpenDocument Planilha", R.drawable.ic_table, R.color.excel_green),
    PPTX("PowerPoint", R.drawable.ic_slides, R.color.ppt_orange),
    PPT("PowerPoint 97-2003", R.drawable.ic_slides, R.color.ppt_orange),
    ODP("OpenDocument Apresentação", R.drawable.ic_slides, R.color.ppt_orange),
    EPUB("EPUB", R.drawable.ic_book, R.color.ebook_brown),
    FB2("FictionBook", R.drawable.ic_book, R.color.ebook_brown),
    CBZ("Quadrinhos", R.drawable.ic_book, R.color.image_purple),
    ZIP("ZIP", R.drawable.ic_zip, R.color.text_gray),
    UNKNOWN("Arquivo", R.drawable.ic_doc, R.color.text_gray);

    val isOffice get() = this in setOf(DOCX, DOC, ODT, RTF, XLSX, XLS, ODS, PPTX, PPT, ODP)

    companion object {
        private val codeExt = setOf(
            "kt", "java", "js", "ts", "jsx", "tsx", "py", "c", "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php",
            "swift", "sh", "bat", "ps1", "sql", "css", "scss", "json", "xml", "yaml", "yml", "toml", "ini", "cfg",
            "conf", "gradle", "kts", "properties", "dart", "lua", "pl", "r", "m", "vue", "svelte", "env"
        )
        private val textExt = setOf("txt", "log", "nfo", "srt", "vtt", "tex", "bib", "text", "me", "1st", "diz", "asc")
        private val imageExt = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "ico", "wbmp", "jfif", "dng")

        fun fromName(name: String, mime: String? = null): DocKind {
            when (FileUtil.extension(name)) {
                "pdf" -> return PDF
                in imageExt -> return IMAGE
                "svg" -> return SVG
                "md", "markdown", "mdown" -> return MARKDOWN
                "html", "htm", "xhtml", "mht", "mhtml" -> return HTML
                "csv", "tsv" -> return CSV
                "docx", "docm", "dotx" -> return DOCX
                "doc", "dot", "wps" -> return DOC
                "odt", "ott" -> return ODT
                "rtf" -> return RTF
                "xlsx", "xlsm", "xltx" -> return XLSX
                "xls" -> return XLS
                "ods" -> return ODS
                "pptx", "ppsx", "potx" -> return PPTX
                "ppt", "pps" -> return PPT
                "odp" -> return ODP
                "epub" -> return EPUB
                "fb2" -> return FB2
                "cbz" -> return CBZ
                "zip", "jar", "apk" -> return ZIP
                in codeExt -> return CODE
                in textExt -> return TEXT
            }
            val m = mime ?: return UNKNOWN
            return when {
                m == "application/pdf" || m == "application/x-pdf" -> PDF
                m == "image/svg+xml" -> SVG
                m.startsWith("image/") -> IMAGE
                m == "text/html" -> HTML
                m == "text/markdown" -> MARKDOWN
                m == "text/csv" || m == "text/comma-separated-values" -> CSV
                m.contains("wordprocessingml") -> DOCX
                m == "application/msword" -> DOC
                m.contains("spreadsheetml") -> XLSX
                m == "application/vnd.ms-excel" -> XLS
                m.contains("presentationml") -> PPTX
                m == "application/vnd.ms-powerpoint" -> PPT
                m.contains("opendocument.text") -> ODT
                m.contains("opendocument.spreadsheet") -> ODS
                m.contains("opendocument.presentation") -> ODP
                m.contains("rtf") -> RTF
                m == "application/epub+zip" -> EPUB
                m.contains("fictionbook") -> FB2
                m.contains("cbz") || m.contains("comicbook") -> CBZ
                m == "application/zip" -> ZIP
                m == "application/json" || m.contains("xml") || m.contains("javascript") -> CODE
                m.startsWith("text/") -> TEXT
                else -> UNKNOWN
            }
        }

        /** Detecta pelo nome/MIME e, se não der, pelo conteúdo (assinatura do arquivo). */
        fun detect(ctx: Context, uri: Uri, name: String): DocKind {
            val mime = try { ctx.contentResolver.getType(uri) } catch (_: Exception) { null }
            val byName = fromName(name, mime)
            if (byName != UNKNOWN && byName != ZIP) return byName
            return try { sniff(ctx, uri) ?: byName } catch (_: Exception) { byName }
        }

        private fun sniff(ctx: Context, uri: Uri): DocKind? {
            val head = ByteArray(4096)
            val n = FileUtil.open(ctx, uri).use { s -> s.read(head) }
            if (n <= 0) return null
            fun startsWith(vararg b: Int) = n >= b.size && b.indices.all { (head[it].toInt() and 0xFF) == b[it] }
            val ascii = String(head, 0, minOf(n, 512), Charsets.ISO_8859_1)
            return when {
                ascii.contains("%PDF") -> PDF
                startsWith(0x89, 0x50, 0x4E, 0x47) || startsWith(0xFF, 0xD8, 0xFF) || ascii.startsWith("GIF8") ||
                    ascii.startsWith("BM") || (ascii.startsWith("RIFF") && ascii.substring(8, 12) == "WEBP") -> IMAGE
                startsWith(0x50, 0x4B, 0x03, 0x04) -> sniffZip(ctx, uri)
                startsWith(0xD0, 0xCF, 0x11, 0xE0) -> DOC
                ascii.startsWith("{\\rtf") -> RTF
                ascii.contains("<FictionBook") -> FB2
                ascii.contains("<svg") -> SVG
                ascii.contains("<html", true) || ascii.contains("<!doctype html", true) -> HTML
                (0 until n).none { head[it].toInt() == 0 } -> TEXT
                else -> null
            }
        }

        private fun sniffZip(ctx: Context, uri: Uri): DocKind {
            ZipInputStream(FileUtil.open(ctx, uri)).use { z ->
                var count = 0
                var images = 0
                while (count < 400) {
                    val e = z.nextEntry ?: break
                    count++
                    val n = e.name
                    when {
                        n == "word/document.xml" -> return DOCX
                        n == "xl/workbook.xml" -> return XLSX
                        n == "ppt/presentation.xml" -> return PPTX
                        n == "mimetype" -> {
                            val t = z.readBytes().toString(Charsets.US_ASCII)
                            return when {
                                t.contains("epub") -> EPUB
                                t.contains("opendocument.text") -> ODT
                                t.contains("opendocument.spreadsheet") -> ODS
                                t.contains("opendocument.presentation") -> ODP
                                else -> ZIP
                            }
                        }
                        fromName(n) == IMAGE -> images++
                    }
                }
                return if (images > 0 && images >= count - 2) CBZ else ZIP
            }
        }
    }
}
