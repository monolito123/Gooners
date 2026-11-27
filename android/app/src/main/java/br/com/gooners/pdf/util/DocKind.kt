package br.com.gooners.pdf.util

import android.content.Context
import android.net.Uri
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.Cfb
import java.util.zip.ZipInputStream

enum class DocKind(val label: String, val icon: Int, val color: Int) {
    PDF("PDF", R.drawable.ic_pdf, R.color.pdf_red),
    IMAGE("Imagem", R.drawable.ic_image, R.color.image_purple),
    SVG("SVG", R.drawable.ic_image, R.color.image_purple),
    VIDEO("Vídeo", R.drawable.ic_video, R.color.video_pink),
    AUDIO("Áudio", R.drawable.ic_music, R.color.audio_teal),
    PLAYLIST("Playlist", R.drawable.ic_queue, R.color.audio_teal),
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
    MOBI("Kindle (MOBI/AZW)", R.drawable.ic_book, R.color.ebook_brown),
    CBZ("Quadrinhos", R.drawable.ic_book, R.color.image_purple),
    XPS("XPS", R.drawable.ic_doc, R.color.word_blue),
    DJVU("DjVu", R.drawable.ic_book, R.color.ebook_brown),
    IWORK("Apple iWork", R.drawable.ic_doc, R.color.data_slate),
    EML("E-mail", R.drawable.ic_mail, R.color.mail_sky),
    MSG("E-mail do Outlook", R.drawable.ic_mail, R.color.mail_sky),
    VCARD("Contatos (vCard)", R.drawable.ic_person, R.color.mail_sky),
    ICAL("Agenda (iCalendar)", R.drawable.ic_calendar, R.color.mail_sky),
    IPYNB("Notebook Jupyter", R.drawable.ic_code, R.color.ppt_orange),
    SQLITE("Banco de dados SQLite", R.drawable.ic_database, R.color.data_slate),
    FONT("Fonte", R.drawable.ic_font, R.color.data_slate),
    APK("Aplicativo Android", R.drawable.ic_android, R.color.excel_green),
    TORRENT("Torrent", R.drawable.ic_download, R.color.data_slate),
    ZIP("ZIP", R.drawable.ic_zip, R.color.archive_amber),
    ARCHIVE("Arquivo compactado", R.drawable.ic_zip, R.color.archive_amber),
    UNKNOWN("Arquivo", R.drawable.ic_doc, R.color.text_gray);

    val isOffice get() = this in setOf(DOCX, DOC, ODT, RTF, XLSX, XLS, ODS, PPTX, PPT, ODP)
    val isMedia get() = this == VIDEO || this == AUDIO || this == PLAYLIST
    val isEbook get() = this in setOf(EPUB, FB2, MOBI, CBZ, DJVU)
    val isArchive get() = this == ZIP || this == ARCHIVE

    companion object {
        private val codeExt = setOf(
            "kt", "kts", "java", "js", "mjs", "cjs", "ts", "jsx", "tsx", "py", "pyw", "c", "h", "cc", "cpp", "cxx", "hpp", "cs", "go", "rs",
            "rb", "php", "swift", "m", "mm", "sh", "bash", "zsh", "fish", "bat", "cmd", "ps1", "psm1", "sql", "css", "scss", "sass", "less",
            "json", "jsonc", "json5", "geojson", "xml", "xsd", "xsl", "xslt", "plist", "yaml", "yml", "toml", "ini", "cfg", "conf", "properties",
            "gradle", "dart", "lua", "pl", "pm", "r", "vue", "svelte", "env", "dockerfile", "makefile", "mk", "cmake", "groovy", "scala",
            "clj", "ex", "exs", "erl", "hs", "elm", "fs", "fsx", "vb", "vbs", "asm", "s", "pas", "f90", "jl", "nim", "zig", "sol", "tf",
            "graphql", "gql", "proto", "gpx", "kml", "rss", "atom", "wsdl", "csproj", "sln", "reg", "ps", "tex", "sty", "cls", "bib", "diff", "patch"
        )
        private val textExt = setOf(
            "txt", "log", "nfo", "srt", "vtt", "ass", "ssa", "sub", "lrc", "text", "me", "1st", "diz", "asc", "readme", "license",
            "url", "webloc", "desktop", "lst", "out", "err", "rst", "adoc", "org", "textile", "wiki", "todo", "tsv"
        )
        private val imageExt = setOf(
            "jpg", "jpeg", "jpe", "png", "gif", "webp", "bmp", "dib", "heic", "heif", "avif", "ico", "cur", "wbmp", "jfif", "jxl",
            // decodificados pelo próprio app
            "tif", "tiff", "psd", "psb", "tga", "icb", "vda", "vst", "pbm", "pgm", "ppm", "pnm", "pam", "eps", "epsf", "epsi",
            // RAW de câmeras (pré-visualização embutida)
            "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "raf", "pef", "srw", "x3f", "erf", "kdc", "mrw", "3fr", "mef", "iiq", "rwl"
        )
        private val videoExt = setOf(
            "mp4", "m4v", "mkv", "webm", "avi", "mov", "qt", "3gp", "3gpp", "3g2", "ts", "mts", "m2ts", "m2t", "tp", "trp", "flv", "f4v",
            "wmv", "asf", "mpg", "mpeg", "mpe", "m1v", "m2v", "vob", "ogv", "divx", "xvid", "rm", "rmvb", "mxf", "dv", "y4m", "h264", "264", "hevc", "265"
        )
        private val audioExt = setOf(
            "mp3", "m4a", "m4b", "m4p", "aac", "adts", "flac", "ogg", "oga", "opus", "spx", "wav", "wave", "wma", "amr", "awb", "mid", "midi",
            "kar", "rmi", "rtttl", "rtx", "ota", "imy", "xmf", "mxmf", "mka", "ac3", "eac3", "ec3", "dts", "mlp", "thd", "wv", "aif", "aiff",
            "aifc", "au", "snd", "caf", "mp2", "mpga", "mp1", "3ga", "weba", "alac", "ape", "tta", "w64", "voc", "gsm"
        )
        private val playlistExt = setOf("m3u", "m3u8", "pls", "xspf", "wpl")
        private val archiveExt = setOf(
            "7z", "rar", "tar", "gz", "tgz", "gzip", "bz2", "tbz", "tbz2", "xz", "txz", "lzma", "tlz", "z", "taz", "ar", "deb", "a", "cpio", "arj", "cab"
        )

        /** Extensões que o player trata melhor com o reprodutor do sistema (sintetizador MIDI do Android). */
        val systemPlayerExt = setOf("mid", "midi", "kar", "rmi", "rtttl", "rtx", "ota", "imy", "xmf", "mxmf")

        fun fromName(name: String, mime: String? = null): DocKind {
            when (FileUtil.extension(name)) {
                "pdf" -> return PDF
                in imageExt -> return IMAGE
                "svg", "svgz" -> return SVG
                in videoExt -> return VIDEO
                in audioExt -> return AUDIO
                in playlistExt -> return PLAYLIST
                "md", "markdown", "mdown", "mkd" -> return MARKDOWN
                "html", "htm", "xhtml", "shtml" -> return HTML
                "mht", "mhtml", "eml", "emlx", "mbox" -> return EML
                "msg" -> return MSG
                "csv" -> return CSV
                "docx", "docm", "dotx", "dotm" -> return DOCX
                "doc", "dot", "wps", "wpd" -> return DOC
                "odt", "ott", "fodt" -> return ODT
                "rtf" -> return RTF
                "xlsx", "xlsm", "xltx", "xltm" -> return XLSX
                "xls", "xlt", "xlw" -> return XLS
                "ods", "ots" -> return ODS
                "pptx", "ppsx", "potx", "pptm", "ppsm" -> return PPTX
                "ppt", "pps", "pot" -> return PPT
                "odp", "otp", "odg", "otg" -> return ODP
                "epub" -> return EPUB
                "fb2" -> return FB2
                "mobi", "azw", "azw3", "azw4", "kf8", "prc", "pdb", "tpz" -> return MOBI
                "cbz", "cbr", "cb7", "cbt" -> return CBZ
                "xps", "oxps" -> return XPS
                "djvu", "djv" -> return DJVU
                "pages", "numbers", "key" -> return IWORK
                "vcf", "vcard" -> return VCARD
                "ics", "ical", "icalendar", "ifb", "vcs" -> return ICAL
                "ipynb" -> return IPYNB
                "db", "sqlite", "sqlite3", "db3", "s3db", "sl3", "sqlitedb" -> return SQLITE
                "ttf", "otf", "ttc", "otc", "woff", "woff2" -> return FONT
                "apk", "apks", "xapk", "aab" -> return APK
                "torrent" -> return TORRENT
                "zip", "jar", "war", "ear", "aar", "xpi", "crx", "nupkg", "whl", "vsix", "zipx" -> return ZIP
                in archiveExt -> return ARCHIVE
                "fb2.zip" -> return ZIP
                in codeExt -> return CODE
                in textExt -> return TEXT
            }
            if (name.lowercase().let { it.endsWith(".tar.gz") || it.endsWith(".tar.bz2") || it.endsWith(".tar.xz") }) return ARCHIVE
            val m = mime?.lowercase() ?: return UNKNOWN
            return when {
                m == "application/pdf" || m == "application/x-pdf" -> PDF
                m == "image/svg+xml" -> SVG
                m == "image/vnd.djvu" || m == "image/x-djvu" -> DJVU
                m.startsWith("image/") -> IMAGE
                m.contains("mpegurl") || m == "audio/x-scpls" || m == "application/xspf+xml" -> PLAYLIST
                m == "application/dash+xml" || m == "application/vnd.ms-sstr+xml" -> VIDEO
                m.startsWith("video/") -> VIDEO
                m.startsWith("audio/") || m == "application/ogg" -> AUDIO
                m == "text/html" -> HTML
                m == "text/markdown" -> MARKDOWN
                m == "text/csv" || m == "text/comma-separated-values" -> CSV
                m == "message/rfc822" || m == "multipart/related" || m == "application/x-mimearchive" -> EML
                m == "application/vnd.ms-outlook" -> MSG
                m.contains("wordprocessingml") -> DOCX
                m == "application/msword" -> DOC
                m.contains("spreadsheetml") -> XLSX
                m == "application/vnd.ms-excel" -> XLS
                m.contains("presentationml") -> PPTX
                m == "application/vnd.ms-powerpoint" -> PPT
                m.contains("opendocument.text") -> ODT
                m.contains("opendocument.spreadsheet") -> ODS
                m.contains("opendocument.presentation") || m.contains("opendocument.graphics") -> ODP
                m.contains("rtf") -> RTF
                m == "application/epub+zip" -> EPUB
                m.contains("fictionbook") -> FB2
                m.contains("mobipocket") || m.contains("kindle") || m == "application/x-mobi8-ebook" -> MOBI
                m.contains("cbz") || m.contains("cbr") || m.contains("comicbook") -> CBZ
                m.contains("xpsdocument") || m == "application/oxps" -> XPS
                m.contains("vcard") -> VCARD
                m == "text/calendar" || m == "text/x-vcalendar" -> ICAL
                m.contains("sqlite") -> SQLITE
                m.startsWith("font/") || m.contains("font-ttf") || m.contains("font-otf") || m.contains("font-woff") -> FONT
                m == "application/vnd.android.package-archive" -> APK
                m == "application/x-bittorrent" -> TORRENT
                m == "application/zip" || m == "application/x-zip-compressed" || m == "application/java-archive" -> ZIP
                m.contains("7z") || m.contains("rar") || m.contains("tar") || m.contains("gzip") || m.contains("bzip") ||
                    m.contains("x-xz") || m.contains("lzma") || m == "application/x-compress" || m.contains("cpio") || m.contains("arj") ||
                    m == "application/vnd.debian.binary-package" -> ARCHIVE
                m == "application/json" || m.contains("xml") || m.contains("javascript") || m.contains("x-sh") || m.contains("x-python") -> CODE
                m.startsWith("text/") -> TEXT
                else -> UNKNOWN
            }
        }

        /** Detecta pelo nome/MIME e, se não der, pelo conteúdo (assinatura do arquivo). */
        fun detect(ctx: Context, uri: Uri, name: String): DocKind {
            val scheme = uri.scheme?.lowercase()
            if (scheme == "http" || scheme == "https" || scheme == "rtsp" || scheme == "rtmp") return fromName(Uri.decode(uri.path ?: "")).takeIf { it != UNKNOWN } ?: VIDEO
            val mime = try { ctx.contentResolver.getType(uri) } catch (_: Exception) { null }
            val byName = fromName(name, mime)
            // extensões genéricas ou que escondem outro formato: confirma pelo conteúdo
            val ambiguous = byName == UNKNOWN || byName == ZIP || byName == DOC || byName == XLS || byName == PPT ||
                FileUtil.extension(name) in setOf("db", "dat", "bin", "pdb", "prc", "tmp", "")
            if (!ambiguous) return byName
            return try { sniff(ctx, uri) ?: byName } catch (_: Exception) { byName }
        }

        fun sniffBytes(head: ByteArray, n: Int): DocKind? {
            if (n <= 0) return null
            fun at(off: Int, vararg b: Int) = n >= off + b.size && b.indices.all { (head[off + it].toInt() and 0xFF) == b[it] }
            fun str(off: Int, s: String) = n >= off + s.length && s.indices.all { head[off + it].toInt().toChar() == s[it] }
            val ascii = String(head, 0, minOf(n, 1024), Charsets.ISO_8859_1)
            val brand = if (str(4, "ftyp")) String(head, 8, 4, Charsets.ISO_8859_1) else ""
            return when {
                ascii.startsWith("%PDF") || ascii.indexOf("%PDF-").let { it in 0..512 } -> PDF
                at(0, 0x89, 0x50, 0x4E, 0x47) || at(0, 0xFF, 0xD8, 0xFF) || str(0, "GIF8") || str(0, "BM") ||
                    (str(0, "RIFF") && str(8, "WEBP")) || str(0, "II*\u0000") || str(0, "MM\u0000*") || str(0, "8BPS") ||
                    at(0, 0xC5, 0xD0, 0xD3, 0xC6) || str(0, "\u0000\u0000\u0001\u0000") -> IMAGE
                brand in setOf("heic", "heix", "mif1", "msf1", "avif", "avis", "hevc", "crx ") -> IMAGE
                brand.startsWith("M4A") || brand == "M4B " || brand == "M4P " || brand == "F4A " -> AUDIO
                brand.isNotEmpty() -> VIDEO
                str(0, "RIFF") && str(8, "WAVE") -> AUDIO
                str(0, "RIFF") && str(8, "AVI ") -> VIDEO
                at(0, 0x1A, 0x45, 0xDF, 0xA3) -> VIDEO
                str(0, "FLV") -> VIDEO
                at(0, 0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11) -> VIDEO
                at(0, 0x00, 0x00, 0x01, 0xBA) || at(0, 0x00, 0x00, 0x01, 0xB3) -> VIDEO
                n > 376 && head[0].toInt() == 0x47 && head[188].toInt() == 0x47 && head[376].toInt() == 0x47 -> VIDEO
                str(0, "OggS") || str(0, "fLaC") || str(0, "ID3") || str(0, "MThd") || str(0, "#!AMR") || str(0, "FORM") && str(8, "AIFF") ||
                    str(0, ".snd") || str(0, "MAC ") || str(0, "wvpk") || (at(0, 0xFF) && n > 1 && (head[1].toInt() and 0xE0) == 0xE0) ||
                    at(0, 0x0B, 0x77) -> AUDIO
                ascii.startsWith("#EXTM3U") || ascii.startsWith("[playlist]") || ascii.contains("<playlist") && ascii.contains("xspf") -> PLAYLIST
                at(0, 0x50, 0x4B, 0x03, 0x04) || at(0, 0x50, 0x4B, 0x05, 0x06) -> ZIP
                str(0, "7z") && at(2, 0xBC, 0xAF, 0x27, 0x1C) -> ARCHIVE
                str(0, "Rar!\u001A\u0007") -> ARCHIVE
                at(0, 0x1F, 0x8B) || str(0, "BZh") || at(0, 0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00) || at(0, 0x1F, 0x9D) || at(0, 0x5D, 0x00, 0x00) ||
                    str(0, "!<arch>") || str(257, "ustar") || str(0, "070707") || str(0, "070701") || at(0, 0x60, 0xEA) || str(0, "MSCF") -> ARCHIVE
                at(0, 0xD0, 0xCF, 0x11, 0xE0) -> DOC
                str(0, "SQLite format 3") -> SQLITE
                str(0, "AT&TFORM") -> DJVU
                str(60, "BOOKMOBI") || str(60, "TEXtREAd") -> MOBI
                str(0, "OTTO") || at(0, 0x00, 0x01, 0x00, 0x00, 0x00) || str(0, "ttcf") || str(0, "wOFF") || str(0, "wOF2") -> FONT
                str(0, "d8:announce") || str(0, "d4:info") || str(0, "d13:announce-list") || str(0, "d7:comment") -> TORRENT
                Regex("^(From |Return-Path:|Received:|MIME-Version:|Message-ID:|Delivered-To:|X-[A-Za-z-]+:|From:|Date:|Subject:)", RegexOption.IGNORE_CASE)
                    .containsMatchIn(ascii) && ascii.contains("\n") && ascii.contains(":") && (ascii.contains("Content-Type", true) || ascii.contains("Subject:", true)) -> EML
                ascii.startsWith("{\\rtf") -> RTF
                ascii.contains("BEGIN:VCARD", true) -> VCARD
                ascii.contains("BEGIN:VCALENDAR", true) -> ICAL
                ascii.contains("<FictionBook") -> FB2
                ascii.contains("<svg") -> SVG
                ascii.trimStart().startsWith("{") && ascii.contains("\"cells\"") && ascii.contains("nbformat") -> IPYNB
                ascii.contains("<html", true) || ascii.contains("<!doctype html", true) -> HTML
                ascii.startsWith("%!PS") -> CODE
                (0 until n).none { head[it].toInt() == 0 } -> TEXT
                else -> null
            }
        }

        private fun sniff(ctx: Context, uri: Uri): DocKind? {
            val head = ByteArray(4096)
            val n = FileUtil.open(ctx, uri).use { s -> var total = 0; while (total < head.size) { val r = s.read(head, total, head.size - total); if (r <= 0) break; total += r }; total }
            return when (val k = sniffBytes(head, n)) {
                ZIP -> sniffZip(ctx, uri)
                DOC -> sniffCfb(ctx, uri)
                else -> k
            }
        }

        /** Arquivo OLE (Office 97-2003/Outlook): identifica pelo nome dos fluxos internos. */
        private fun sniffCfb(ctx: Context, uri: Uri): DocKind {
            val f = FileUtil.copyToCache(ctx, uri, "tmp")
            return try { Cfb(f).use { kindOfCfb(it) } } catch (_: Exception) { DOC } finally { if (uri.scheme != "file") f.delete() }
        }

        fun kindOfCfb(c: Cfb): DocKind {
            val names = c.entries.map { it.name }
            return when {
                "WordDocument" in names -> DOC
                "Workbook" in names || "Book" in names -> XLS
                "PowerPoint Document" in names -> PPT
                names.any { it.startsWith("__substg1.0_") } -> MSG
                else -> DOC
            }
        }

        private fun sniffZip(ctx: Context, uri: Uri): DocKind {
            ZipInputStream(FileUtil.open(ctx, uri)).use { z ->
                var count = 0
                var images = 0
                var manifest = false
                var dex = false
                while (count < 600) {
                    val e = z.nextEntry ?: break
                    count++
                    val n = e.name
                    when {
                        n == "word/document.xml" -> return DOCX
                        n == "xl/workbook.xml" -> return XLSX
                        n == "ppt/presentation.xml" -> return PPTX
                        n.endsWith(".fdseq") || n.endsWith("FixedDocumentSequence.fdseq") || n.startsWith("Documents/") && n.endsWith(".fpage") -> return XPS
                        n == "Index/Document.iwa" || n == "QuickLook/Preview.pdf" || n == "index.apxl" || n == "index.xml" && count < 5 -> return IWORK
                        n == "AndroidManifest.xml" -> manifest = true
                        n == "classes.dex" -> dex = true
                        n == "mimetype" -> {
                            val t = z.readBytes().toString(Charsets.US_ASCII)
                            return when {
                                t.contains("epub") -> EPUB
                                t.contains("opendocument.text") -> ODT
                                t.contains("opendocument.spreadsheet") -> ODS
                                t.contains("opendocument.presentation") || t.contains("opendocument.graphics") -> ODP
                                t.contains("iwork") -> IWORK
                                else -> ZIP
                            }
                        }
                        fromName(n) == IMAGE -> images++
                    }
                    if (manifest && dex) return APK
                }
                return if (images > 0 && images >= count - 2) CBZ else ZIP
            }
        }
    }
}
