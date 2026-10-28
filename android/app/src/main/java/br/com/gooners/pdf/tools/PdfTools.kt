package br.com.gooners.pdf.tools

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import br.com.gooners.pdf.convert.DocxPara
import br.com.gooners.pdf.convert.DocxRun
import br.com.gooners.pdf.convert.DocxWriter
import br.com.gooners.pdf.edit.PageGeo
import br.com.gooners.pdf.edit.PdfBoxUtil
import br.com.gooners.pdf.ocr.OcrHelper
import br.com.gooners.pdf.util.BitmapUtil
import br.com.gooners.pdf.viewer.PdfCore
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.multipdf.PDFMergerUtility
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.PDResources
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDFont
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import com.tom_roush.pdfbox.pdmodel.graphics.state.RenderingMode
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.util.Matrix
import java.io.File
import java.text.DateFormat
import java.util.Calendar
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

typealias Progress = (String, Float?) -> Unit

class OutlineItem(val title: String, val page: Int, val level: Int)

object PdfTools {

    // ------------------------------------------------------------ intervalo de páginas
    /** "1-3, 5, 8-" -> lista de intervalos (base 0). Vazio = todas. */
    fun parseRanges(spec: String, total: Int): List<IntRange> {
        val s = spec.trim()
        if (s.isEmpty()) return listOf(0 until total)
        val out = ArrayList<IntRange>()
        for (part in s.split(',', ';')) {
            val p = part.trim()
            if (p.isEmpty()) continue
            val r = if (p.contains('-')) {
                val a = p.substringBefore('-').trim().toIntOrNull() ?: 1
                val b = p.substringAfter('-').trim().toIntOrNull() ?: total
                (a - 1)..(b - 1)
            } else {
                val n = p.toIntOrNull() ?: throw IllegalArgumentException("Intervalo inválido: \"$p\"")
                (n - 1)..(n - 1)
            }
            val clamped = max(0, r.first)..min(total - 1, r.last)
            if (clamped.first <= clamped.last) out += clamped
        }
        if (out.isEmpty()) throw IllegalArgumentException("Nenhuma página válida em \"$spec\" (o documento tem $total páginas)")
        return out
    }

    fun pageCount(f: File, pw: String? = null): Int = PdfBoxUtil.load(f, pw).use { it.numberOfPages }

    private fun open(f: File, pw: String?): PDDocument = PdfBoxUtil.load(f, pw).also { if (it.isEncrypted) it.isAllSecurityToBeRemoved = true }

    // ------------------------------------------------------------ mesclar / dividir / extrair
    fun merge(inputs: List<File>, out: File, progress: Progress) {
        val m = PDFMergerUtility()
        inputs.forEach { m.addSource(it) }
        m.destinationFileName = out.path
        progress("Mesclando ${inputs.size} arquivos…", null)
        m.mergeDocuments(MemoryUsageSetting.setupMixed(32L * 1024 * 1024))
    }

    fun extract(src: File, pw: String?, pages: List<Int>, out: File) {
        open(src, pw).use { doc ->
            PDDocument().use { dst ->
                for (p in pages) if (p in 0 until doc.numberOfPages) dst.importPage(doc.getPage(p)).rotation = doc.getPage(p).rotation
                dst.save(out)
            }
        }
    }

    fun split(src: File, pw: String?, ranges: List<IntRange>, outDir: File, base: String, progress: Progress): List<File> {
        val outs = ArrayList<File>()
        open(src, pw).use { doc ->
            ranges.forEachIndexed { i, r ->
                progress("Criando parte ${i + 1} de ${ranges.size}…", i / ranges.size.toFloat())
                PDDocument().use { dst ->
                    for (p in r) dst.importPage(doc.getPage(p)).rotation = doc.getPage(p).rotation
                    val name = if (r.first == r.last) "${base}_p${r.first + 1}.pdf" else "${base}_p${r.first + 1}-${r.last + 1}.pdf"
                    val f = File(outDir, name)
                    dst.save(f)
                    outs += f
                }
            }
        }
        return outs
    }

    fun deletePages(src: File, pw: String?, remove: Set<Int>, out: File) {
        open(src, pw).use { doc ->
            for (p in remove.sortedDescending()) if (p in 0 until doc.numberOfPages) doc.removePage(p)
            if (doc.numberOfPages == 0) throw IllegalArgumentException("Não é possível remover todas as páginas")
            doc.save(out)
        }
    }

    fun rotate(src: File, pw: String?, degrees: Int, pages: Set<Int>?, out: File) {
        open(src, pw).use { doc ->
            doc.pages.forEachIndexed { i, page ->
                if (pages == null || i in pages) page.rotation = ((page.rotation + degrees) % 360 + 360) % 360
            }
            doc.save(out)
        }
    }

    // ------------------------------------------------------------ segurança
    fun protect(src: File, out: File, user: String, owner: String, print: Boolean = true, copy: Boolean = true, modify: Boolean = true, pw: String? = null) {
        open(src, pw).use { doc ->
            PdfBoxUtil.encrypt(doc, user, owner.ifEmpty { user }, print, copy, modify)
            doc.save(out)
        }
    }

    fun unlock(src: File, pw: String, out: File) = PdfBoxUtil.decrypt(src, pw, out)

    // ------------------------------------------------------------ compressão
    /**
     * Recomprime as imagens do PDF (reduzindo resolução) mantendo texto e vetores intactos.
     * [rasterDpi] > 0 transforma cada página em imagem (máxima redução, ideal para digitalizações).
     */
    fun compress(src: File, pw: String?, out: File, maxDim: Int, quality: Float, rasterDpi: Int, progress: Progress) {
        if (rasterDpi > 0) { rasterize(src, pw, out, rasterDpi, quality, false, progress); return }
        open(src, pw).use { doc ->
            val done = HashSet<Any>()
            val n = doc.numberOfPages
            doc.pages.forEachIndexed { i, page ->
                progress("Comprimindo página ${i + 1} de $n…", i / n.toFloat())
                compressResources(doc, page.resources, maxDim, quality, done, 0)
            }
            doc.documentInformation.producer = "Gooners PDF"
            doc.save(out)
        }
        // se não ganhou nada, mantém o original
        if (out.length() >= src.length() && pw == null) src.copyTo(out, true)
    }

    private fun compressResources(doc: PDDocument, res: PDResources?, maxDim: Int, q: Float, done: HashSet<Any>, depth: Int) {
        if (res == null || depth > 6) return
        for (name in res.xObjectNames.toList()) {
            val xo = try { res.getXObject(name) } catch (e: Exception) { null } ?: continue
            if (!done.add(xo.cosObject)) continue
            when (xo) {
                is PDFormXObject -> compressResources(doc, xo.resources, maxDim, q, done, depth + 1)
                is PDImageXObject -> try {
                    if (xo.isStencil || xo.softMask != null || xo.cosObject.containsKey(COSName.MASK)) continue
                    val w = xo.width; val h = xo.height
                    if (w < 64 || h < 64) continue
                    val oldLen = xo.stream.length
                    val sub = max(1, max(w, h) / (maxDim * 2))
                    var bmp: Bitmap = xo.getImage(Rect(0, 0, w, h), sub) ?: continue
                    val m = max(bmp.width, bmp.height)
                    if (m > maxDim) {
                        val s = maxDim.toFloat() / m
                        bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt().coerceAtLeast(1), (bmp.height * s).toInt().coerceAtLeast(1), true)
                    }
                    if (bmp.hasAlpha()) bmp = flatten(bmp)
                    val img = JPEGFactory.createFromImage(doc, bmp, q)
                    if (img.stream.length < oldLen * 0.9) res.put(name, img)
                    bmp.recycle()
                } catch (e: OutOfMemoryError) {
                    System.gc()
                } catch (e: Exception) {
                }
            }
        }
    }

    private fun flatten(b: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(b.width, b.height, Bitmap.Config.ARGB_8888)
        Canvas(out).apply { drawColor(Color.WHITE); drawBitmap(b, 0f, 0f, null) }
        return out
    }

    /** Cada página vira uma imagem JPEG (opcionalmente em tons de cinza). */
    fun rasterize(src: File, pw: String?, out: File, dpi: Int, quality: Float, gray: Boolean, progress: Progress) {
        val plain = plainCopy(src, pw, out)
        PdfCore.open(plain).use { core ->
            PDDocument().use { doc ->
                for (i in 0 until core.pageCount) {
                    progress("Processando página ${i + 1} de ${core.pageCount}…", i / core.pageCount.toFloat())
                    val wPt = core.widths[i]; val hPt = core.heights[i]
                    val px = (wPt / 72f * dpi).toInt().coerceIn(100, 3500)
                    var bmp = core.renderForPrint(i, px) ?: continue
                    if (gray) bmp = toGray(bmp)
                    val img = JPEGFactory.createFromImage(doc, bmp, quality)
                    bmp.recycle()
                    val page = PDPage(PDRectangle(wPt, hPt))
                    doc.addPage(page)
                    PDPageContentStream(doc, page).use { it.drawImage(img, 0f, 0f, wPt, hPt) }
                }
                doc.save(out)
            }
        }
        if (plain != src) plain.delete()
    }

    private fun toGray(b: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(b.width, b.height, Bitmap.Config.ARGB_8888)
        val p = Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) }) }
        Canvas(out).drawBitmap(b, 0f, 0f, p)
        b.recycle()
        return out
    }

    /** O renderizador nativo não abre PDFs com senha: gera uma cópia sem senha quando preciso. */
    private fun plainCopy(src: File, pw: String?, near: File): File {
        if (pw.isNullOrEmpty()) return src
        val f = File(near.parentFile, "plain_${System.nanoTime()}.pdf")
        PdfBoxUtil.decrypt(src, pw, f)
        return f
    }

    // ------------------------------------------------------------ carimbos de texto
    enum class Pos(val label: String) { TOP_LEFT("Topo à esquerda"), TOP_CENTER("Topo ao centro"), TOP_RIGHT("Topo à direita"),
        BOTTOM_LEFT("Rodapé à esquerda"), BOTTOM_CENTER("Rodapé ao centro"), BOTTOM_RIGHT("Rodapé à direita") }

    private fun drawAt(cs: PDPageContentStream, font: PDFont, text: String, size: Float, geo: PageGeo, pos: Pos, margin: Float) {
        val t = PdfBoxUtil.safeText(font, text)
        val w = PdfBoxUtil.textWidth(font, t, size)
        val x = when (pos) {
            Pos.TOP_LEFT, Pos.BOTTOM_LEFT -> margin
            Pos.TOP_CENTER, Pos.BOTTOM_CENTER -> (geo.width - w) / 2
            else -> geo.width - margin - w
        }
        val y = if (pos.name.startsWith("TOP")) geo.height - margin - size else margin
        cs.beginText(); cs.setFont(font, size); cs.newLineAtOffset(x, y); cs.showText(t); cs.endText()
    }

    fun pageNumbers(src: File, pw: String?, out: File, pos: Pos, format: String, start: Int, size: Float, skipFirst: Boolean) {
        open(src, pw).use { doc ->
            val font = PdfBoxUtil.unicodeFont(doc)
            val total = doc.numberOfPages
            doc.pages.forEachIndexed { i, page ->
                if (skipFirst && i == 0) return@forEachIndexed
                val geo = PageGeo(page)
                geo.begin(doc, page).use { cs ->
                    cs.setNonStrokingColor(0.2f, 0.2f, 0.2f)
                    val n = i + start
                    val label = format.replace("{n}", n.toString()).replace("{total}", (total + start - 1).toString())
                    drawAt(cs, font, label, size, geo, pos, 28f)
                }
            }
            doc.save(out)
        }
    }

    fun headerFooter(src: File, pw: String?, out: File, header: String, footer: String, size: Float) {
        val today = DateFormat.getDateInstance(DateFormat.SHORT, Locale("pt", "BR")).format(Calendar.getInstance().time)
        open(src, pw).use { doc ->
            val font = PdfBoxUtil.unicodeFont(doc)
            val total = doc.numberOfPages
            doc.pages.forEachIndexed { i, page ->
                val geo = PageGeo(page)
                fun fmt(s: String) = s.replace("{n}", "${i + 1}").replace("{total}", "$total").replace("{data}", today)
                geo.begin(doc, page).use { cs ->
                    cs.setNonStrokingColor(0.25f, 0.25f, 0.25f)
                    if (header.isNotBlank()) drawAt(cs, font, fmt(header), size, geo, Pos.TOP_CENTER, 24f)
                    if (footer.isNotBlank()) drawAt(cs, font, fmt(footer), size, geo, Pos.BOTTOM_CENTER, 24f)
                }
            }
            doc.save(out)
        }
    }

    fun watermark(src: File, pw: String?, out: File, text: String, size: Float, opacity: Float, color: Int, diagonal: Boolean) {
        open(src, pw).use { doc ->
            val font = PdfBoxUtil.unicodeFont(doc)
            val t = PdfBoxUtil.safeText(font, text)
            for (page in doc.pages) {
                val geo = PageGeo(page)
                geo.begin(doc, page).use { cs ->
                    val gs = PDExtendedGraphicsState().apply { nonStrokingAlphaConstant = opacity; strokingAlphaConstant = opacity }
                    cs.setGraphicsStateParameters(gs)
                    cs.setNonStrokingColor(Color.red(color) / 255f, Color.green(color) / 255f, Color.blue(color) / 255f)
                    val lines = t.split('\n')
                    val lh = size * 1.2f
                    val angle = if (diagonal) Math.toRadians(Math.toDegrees(kotlin.math.atan2(geo.height.toDouble(), geo.width.toDouble()))) else 0.0
                    lines.forEachIndexed { i, line ->
                        val w = PdfBoxUtil.textWidth(font, line, size)
                        val m = Matrix.getRotateInstance(angle, geo.width / 2, geo.height / 2)
                        val dy = (lines.size / 2f - i - 0.7f) * lh
                        m.concatenate(Matrix.getTranslateInstance(-w / 2, dy))
                        cs.beginText(); cs.setFont(font, size); cs.setTextMatrix(m); cs.showText(line); cs.endText()
                    }
                }
            }
            doc.save(out)
        }
    }

    // ------------------------------------------------------------ metadados / informações
    fun info(f: File): List<Pair<String, String>> = PdfBoxUtil.load(f).use { doc ->
        val i = doc.documentInformation
        val df = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, Locale("pt", "BR"))
        listOfNotNull(
            i.title?.let { "Título" to it }, i.author?.let { "Autor" to it }, i.subject?.let { "Assunto" to it },
            i.keywords?.let { "Palavras-chave" to it }, i.creator?.let { "Criado com" to it }, i.producer?.let { "Produtor" to it },
            i.creationDate?.let { "Criado em" to df.format(it.time) }, i.modificationDate?.let { "Modificado em" to df.format(it.time) },
            "Versão PDF" to doc.version.toString(),
            "Formulário" to if (doc.documentCatalog.acroForm?.fields?.isNotEmpty() == true) "sim" else "não"
        )
    }

    fun readMeta(f: File, pw: String?): Map<String, String> = open(f, pw).use { doc ->
        val i = doc.documentInformation
        mapOf("title" to (i.title ?: ""), "author" to (i.author ?: ""), "subject" to (i.subject ?: ""), "keywords" to (i.keywords ?: ""))
    }

    fun writeMeta(src: File, pw: String?, out: File, title: String, author: String, subject: String, keywords: String) {
        open(src, pw).use { doc ->
            val i = doc.documentInformation
            i.title = title.ifBlank { null }; i.author = author.ifBlank { null }
            i.subject = subject.ifBlank { null }; i.keywords = keywords.ifBlank { null }
            i.modificationDate = Calendar.getInstance()
            doc.save(out)
        }
    }

    fun flatten(src: File, pw: String?, out: File) {
        open(src, pw).use { doc ->
            doc.documentCatalog.acroForm?.let { try { it.flatten() } catch (_: Exception) {} }
            doc.save(out)
        }
    }

    fun outline(f: File): List<OutlineItem> = PdfBoxUtil.load(f).use { doc ->
        val out = ArrayList<OutlineItem>()
        val root = doc.documentCatalog.documentOutline ?: return@use out
        fun walk(node: PDOutlineNode, level: Int) {
            for (item in node.children()) {
                if (out.size > 3000) return
                val p = try { item.findDestinationPage(doc)?.let { doc.pages.indexOf(it) } ?: -1 } catch (e: Exception) { -1 }
                out += OutlineItem(item.title ?: "", max(0, p), level)
                walk(item, level + 1)
            }
        }
        walk(root, 0)
        out
    }

    // ------------------------------------------------------------ conversões a partir do PDF
    fun toImages(src: File, pw: String?, outDir: File, base: String, dpi: Int, png: Boolean, pages: List<Int>?, progress: Progress): List<File> {
        val plain = plainCopy(src, pw, File(outDir, "x"))
        val outs = ArrayList<File>()
        PdfCore.open(plain).use { core ->
            val list = pages ?: (0 until core.pageCount).toList()
            list.forEachIndexed { k, i ->
                progress("Página ${i + 1} (${k + 1} de ${list.size})…", k / list.size.toFloat())
                val px = (core.widths[i] / 72f * dpi).toInt().coerceIn(100, 4096)
                val bmp = core.renderForPrint(i, px) ?: return@forEachIndexed
                val f = File(outDir, "%s_p%03d.%s".format(base, i + 1, if (png) "png" else "jpg"))
                f.outputStream().use { bmp.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 92, it) }
                bmp.recycle()
                outs += f
            }
        }
        if (plain != src) plain.delete()
        return outs
    }

    fun toText(src: File, pw: String?, out: File, progress: Progress) {
        open(src, pw).use { doc ->
            val sb = StringBuilder()
            val st = PDFTextStripper().apply { sortByPosition = true }
            val n = doc.numberOfPages
            for (i in 1..n) {
                progress("Extraindo texto da página $i de $n…", i / n.toFloat())
                st.startPage = i; st.endPage = i
                if (n > 1) sb.append("\n——— Página $i ———\n\n")
                sb.append(st.getText(doc).trimEnd()).append('\n')
            }
            out.writeText(sb.toString().trim() + "\n")
        }
    }

    /** Parágrafos por página (o PdfBox marca início de parágrafo com um caractere de controle). */
    private fun paragraphs(doc: PDDocument, page: Int): List<String> {
        val st = PDFTextStripper().apply {
            sortByPosition = true; startPage = page; endPage = page
            paragraphStart = "\u0002"
        }
        return st.getText(doc).split('\u0002')
            .map { it.replace(Regex("-\\r?\\n(?=\\p{Ll})"), "").replace(Regex("\\s*\\r?\\n\\s*"), " ").trim() }
            .filter { it.isNotEmpty() }
    }

    fun toDocx(src: File, pw: String?, out: File, title: String, progress: Progress) {
        open(src, pw).use { doc ->
            val paras = ArrayList<DocxPara>()
            val n = doc.numberOfPages
            for (i in 1..n) {
                progress("Convertendo página $i de $n…", i / n.toFloat())
                paragraphs(doc, i).forEachIndexed { k, p ->
                    val heading = p.length < 70 && !p.endsWith('.') && p == p.uppercase() && p.any { it.isLetter() }
                    paras += DocxPara(listOf(DocxRun(p, bold = heading)), heading = if (heading) 2 else 0, pageBreakBefore = k == 0 && i > 1)
                }
            }
            if (paras.isEmpty()) paras += DocxPara(listOf(DocxRun("(O PDF não contém texto selecionável. Use a ferramenta OCR antes de converter.)")))
            DocxWriter.write(out, paras, title)
        }
    }

    fun toHtml(src: File, pw: String?, out: File, title: String, progress: Progress) {
        fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        open(src, pw).use { doc ->
            val sb = StringBuilder("<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>")
            sb.append(esc(title)).append("</title><style>body{font-family:sans-serif;max-width:820px;margin:auto;padding:16px;line-height:1.55}section{border-bottom:1px solid #ddd;padding:8px 0 16px}h6{color:#888}</style></head><body>")
            val n = doc.numberOfPages
            for (i in 1..n) {
                progress("Convertendo página $i de $n…", i / n.toFloat())
                sb.append("<section><h6>Página $i</h6>")
                paragraphs(doc, i).forEach { sb.append("<p>").append(esc(it)).append("</p>") }
                sb.append("</section>")
            }
            sb.append("</body></html>")
            out.writeText(sb.toString())
        }
    }

    fun extractImages(src: File, pw: String?, outDir: File, base: String, progress: Progress): List<File> {
        val outs = ArrayList<File>()
        open(src, pw).use { doc ->
            val seen = HashSet<Any>()
            val n = doc.numberOfPages
            doc.pages.forEachIndexed { i, page ->
                progress("Procurando imagens na página ${i + 1} de $n…", i / n.toFloat())
                fun walk(res: PDResources?, depth: Int) {
                    if (res == null || depth > 6) return
                    for (name in res.xObjectNames) {
                        val xo = try { res.getXObject(name) } catch (e: Exception) { null } ?: continue
                        if (!seen.add(xo.cosObject)) continue
                        when (xo) {
                            is PDFormXObject -> walk(xo.resources, depth + 1)
                            is PDImageXObject -> try {
                                if (xo.width < 16 || xo.height < 16) continue
                                val sub = max(1, max(xo.width, xo.height) / 4096)
                                val bmp = xo.getImage(Rect(0, 0, xo.width, xo.height), sub) ?: continue
                                val jpg = xo.suffix == "jpg" && !bmp.hasAlpha()
                                val f = File(outDir, "%s_p%03d_%02d.%s".format(base, i + 1, outs.size + 1, if (jpg) "jpg" else "png"))
                                f.outputStream().use { bmp.compress(if (jpg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, 95, it) }
                                bmp.recycle()
                                outs += f
                            } catch (e: Throwable) {
                            }
                        }
                    }
                }
                walk(page.resources, 0)
            }
        }
        return outs
    }

    // ------------------------------------------------------------ OCR: PDF pesquisável
    /** Adiciona uma camada de texto invisível sobre cada página digitalizada (permite buscar e copiar). */
    fun ocrPdf(src: File, pw: String?, out: File, onlyEmpty: Boolean, progress: Progress): Int {
        val plain = plainCopy(src, pw, out)
        var recognized = 0
        PdfCore.open(plain).use { core ->
            PdfBoxUtil.load(plain).use { doc ->
                val font = PdfBoxUtil.unicodeFont(doc)
                val stripper = PDFTextStripper()
                for (i in 0 until core.pageCount) {
                    progress("Reconhecendo texto da página ${i + 1} de ${core.pageCount}…", i / core.pageCount.toFloat())
                    if (onlyEmpty) {
                        stripper.startPage = i + 1; stripper.endPage = i + 1
                        if (stripper.getText(doc).trim().length > 20) continue
                    }
                    val px = (core.widths[i] * 2.6f).toInt().coerceIn(800, 2600)
                    val bmp = core.renderForPrint(i, px) ?: continue
                    val s = px / core.widths[i]
                    val res = OcrHelper.recognize(bmp)
                    bmp.recycle()
                    if (res.lines.isEmpty()) continue
                    recognized++
                    val page = doc.getPage(i)
                    val geo = PageGeo(page)
                    geo.begin(doc, page).use { cs ->
                        cs.beginText()
                        cs.setRenderingMode(RenderingMode.NEITHER)
                        for (l in res.lines) {
                            val text = PdfBoxUtil.safeText(font, l.text)
                            if (text.isBlank()) continue
                            val h = l.box.height() / s
                            val size = (h * 0.85f).coerceIn(3f, 120f)
                            val target = l.box.width() / s
                            val tw = PdfBoxUtil.textWidth(font, text, size)
                            cs.setFont(font, size)
                            cs.setHorizontalScaling(if (tw > 0) (target / tw * 100f).coerceIn(10f, 500f) else 100f)
                            cs.setTextMatrix(Matrix.getTranslateInstance(l.box.left / s, geo.y(l.box.top / s + h * 0.8f)))
                            cs.showText(text)
                        }
                        cs.endText()
                    }
                }
                doc.save(out)
            }
        }
        if (plain != src) plain.delete()
        return recognized
    }

    // ------------------------------------------------------------ criação
    class PageSize(val label: String, val w: Float, val h: Float)

    val pageSizes = listOf(
        PageSize("A4 (210 × 297 mm)", 595.28f, 841.89f), PageSize("Carta (8,5 × 11\")", 612f, 792f),
        PageSize("Ofício (8,5 × 14\")", 612f, 1008f), PageSize("A5 (148 × 210 mm)", 419.53f, 595.28f),
        PageSize("A3 (297 × 420 mm)", 841.89f, 1190.55f)
    )

    /** Imagens -> PDF. sizeIndex -1 = página do tamanho da imagem. */
    fun imagesToPdf(ctx: Context, uris: List<Uri>, out: File, sizeIndex: Int, marginPt: Float, quality: Float, progress: Progress) {
        PDDocument().use { doc ->
            uris.forEachIndexed { i, uri ->
                progress("Adicionando imagem ${i + 1} de ${uris.size}…", i / uris.size.toFloat())
                var bmp = BitmapUtil.decode(ctx, uri, 2600) ?: return@forEachIndexed
                if (bmp.hasAlpha()) bmp = flatten(bmp)
                val img = JPEGFactory.createFromImage(doc, bmp, quality)
                val iw = bmp.width.toFloat(); val ih = bmp.height.toFloat()
                bmp.recycle()
                val page: PDPage
                val (pw, ph) = if (sizeIndex < 0) {
                    // ~150 ppp: tamanho físico razoável
                    val w = iw * 72f / 150f; val h = ih * 72f / 150f
                    (w + marginPt * 2) to (h + marginPt * 2)
                } else {
                    val ps = pageSizes[sizeIndex]
                    if (iw > ih) ps.h to ps.w else ps.w to ps.h
                }
                page = PDPage(PDRectangle(pw, ph))
                doc.addPage(page)
                val aw = pw - marginPt * 2; val ah = ph - marginPt * 2
                val s = min(aw / iw, ah / ih)
                val dw = iw * s; val dh = ih * s
                PDPageContentStream(doc, page).use { it.drawImage(img, (pw - dw) / 2, (ph - dh) / 2, dw, dh) }
            }
            if (doc.numberOfPages == 0) throw IllegalArgumentException("Nenhuma imagem pôde ser lida")
            doc.save(out)
        }
    }

    /** PDF em branco: liso, pautado, quadriculado ou pontilhado. */
    fun blank(out: File, pages: Int, sizeIndex: Int, landscape: Boolean, style: Int) {
        val ps = pageSizes[sizeIndex]
        val w = if (landscape) ps.h else ps.w
        val h = if (landscape) ps.w else ps.h
        PDDocument().use { doc ->
            repeat(pages.coerceIn(1, 500)) {
                val page = PDPage(PDRectangle(w, h))
                doc.addPage(page)
                if (style > 0) PDPageContentStream(doc, page).use { cs ->
                    cs.setStrokingColor(0.75f, 0.8f, 0.9f)
                    cs.setNonStrokingColor(0.7f, 0.75f, 0.85f)
                    cs.setLineWidth(0.5f)
                    val step = if (style == 1) 24f else 18f
                    when (style) {
                        1 -> { var y = h - 72f; while (y > 36f) { cs.moveTo(36f, y); cs.lineTo(w - 36f, y); y -= step }; cs.stroke() }
                        2 -> {
                            var x = 36f; while (x <= w - 36f) { cs.moveTo(x, 36f); cs.lineTo(x, h - 36f); x += step }
                            var y = 36f; while (y <= h - 36f) { cs.moveTo(36f, y); cs.lineTo(w - 36f, y); y += step }
                            cs.stroke()
                        }
                        3 -> {
                            var x = 36f
                            while (x <= w - 36f) { var y = 36f; while (y <= h - 36f) { cs.addRect(x - 0.6f, y - 0.6f, 1.2f, 1.2f); y += step }; x += step }
                            cs.fill()
                        }
                    }
                }
            }
            doc.documentInformation.creator = "Gooners PDF"
            doc.save(out)
        }
    }
}
