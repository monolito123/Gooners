package br.com.gooners.pdf.edit

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import br.com.gooners.pdf.viewer.PdfCore
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDFont
import com.tom_roush.pdfbox.pdmodel.graphics.blend.BlendMode
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import java.io.File
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/** Grava as anotações no PDF como conteúdo real da página (visível em qualquer leitor). */
object PdfSaver {

    private const val K = 0.5523f

    fun save(src: File, out: File, annots: List<Annot>, images: (String) -> Bitmap?, password: String?, keepPassword: Boolean) {
        val redactPages = annots.filter { it is ShapeAnnot && it.type == ShapeType.REDACT }.map { it.page }.toSet()
        val stage = if (redactPages.isEmpty()) out else File(out.parentFile, "stage_" + out.name)
        PdfBoxUtil.load(src, password).use { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val font by lazy { PdfBoxUtil.unicodeFont(doc) }
            val imageCache = HashMap<String, PDImageXObject>()
            annots.groupBy { it.page }.forEach { (pi, list) ->
                if (pi !in 0 until doc.numberOfPages) return@forEach
                val page = doc.getPage(pi)
                val geo = PageGeo(page)
                geo.begin(doc, page).use { cs ->
                    for (a in list) draw(doc, cs, geo, a, { font }, images, imageCache)
                }
            }
            if (redactPages.isEmpty() && keepPassword && !password.isNullOrEmpty()) PdfBoxUtil.encrypt(doc, password)
            doc.save(stage)
        }
        if (redactPages.isNotEmpty()) {
            rasterizePages(stage, out, redactPages, if (keepPassword) password else null)
            stage.delete()
        }
    }

    /**
     * Tarja definitiva: a página vira imagem com as tarjas, então o texto por baixo deixa de existir.
     */
    fun rasterizePages(src: File, out: File, pages: Set<Int>, password: String?, dpi: Int = 150) {
        val bitmaps = HashMap<Int, File>()
        PdfCore.open(src).use { core ->
            for (p in pages) {
                val w = (core.widths[p] / 72f * dpi).toInt().coerceAtMost(3000)
                val bmp = core.renderForPrint(p, w) ?: continue
                val f = File(out.parentFile, "r_$p.jpg")
                f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
                bmp.recycle()
                bitmaps[p] = f
            }
        }
        PdfBoxUtil.load(src).use { doc ->
            for ((p, f) in bitmaps) {
                val old = doc.getPage(p)
                val geo = PageGeo(old)
                val np = PDPage(PDRectangle(geo.width, geo.height))
                val img = PDImageXObject.createFromFileByExtension(f, doc)
                PDPageContentStream(doc, np).use { it.drawImage(img, 0f, 0f, geo.width, geo.height) }
                doc.pages.insertBefore(np, old)
                doc.pages.remove(old)
            }
            if (!password.isNullOrEmpty()) PdfBoxUtil.encrypt(doc, password)
            doc.save(out)
        }
        bitmaps.values.forEach { it.delete() }
    }

    private fun rgb(cs: PDPageContentStream, color: Int, stroke: Boolean) {
        val r = Color.red(color) / 255f; val g = Color.green(color) / 255f; val b = Color.blue(color) / 255f
        if (stroke) cs.setStrokingColor(r, g, b) else cs.setNonStrokingColor(r, g, b)
    }

    private fun alpha(cs: PDPageContentStream, a: Float, multiply: Boolean = false) {
        val gs = PDExtendedGraphicsState()
        gs.strokingAlphaConstant = a
        gs.nonStrokingAlphaConstant = a
        if (multiply) gs.blendMode = BlendMode.MULTIPLY
        cs.setGraphicsStateParameters(gs)
    }

    private fun draw(
        doc: PDDocument, cs: PDPageContentStream, geo: PageGeo, a: Annot, font: () -> PDFont,
        images: (String) -> Bitmap?, cache: HashMap<String, PDImageXObject>
    ) {
        cs.saveGraphicsState()
        try {
            when (a) {
                is InkAnnot -> {
                    if (a.alpha < 1f) alpha(cs, a.alpha, true)
                    rgb(cs, a.color, true)
                    cs.setLineWidth(a.width)
                    cs.setLineCapStyle(1); cs.setLineJoinStyle(1)
                    val p = a.points
                    if (p.size >= 2) {
                        cs.moveTo(p[0], geo.y(p[1]))
                        if (p.size == 2) cs.lineTo(p[0] + 0.1f, geo.y(p[1]))
                        var i = 2
                        while (i < p.size - 1) {
                            val mx = (p[i - 2] + p[i]) / 2; val my = (p[i - 1] + p[i + 1]) / 2
                            // quadrática -> cúbica
                            val x0 = p[i - 2]; val y0 = p[i - 1]
                            cs.curveTo(x0, geo.y(y0), x0, geo.y(y0), mx, geo.y(my))
                            i += 2
                        }
                        cs.lineTo(p[p.size - 2], geo.y(p[p.size - 1]))
                        cs.stroke()
                    }
                }
                is ShapeAnnot -> drawShape(cs, geo, a)
                is TextAnnot -> {
                    val f = font()
                    rgb(cs, a.color, false)
                    a.text.lines().forEachIndexed { i, line ->
                        if (line.isEmpty()) return@forEachIndexed
                        cs.beginText()
                        cs.setFont(f, a.size)
                        cs.newLineAtOffset(a.x, geo.y(a.y + a.size * 0.9f + i * a.lineHeight))
                        cs.showText(PdfBoxUtil.safeText(f, line))
                        cs.endText()
                    }
                }
                is ImageAnnot -> {
                    val img = cache.getOrPut(a.imageKey) {
                        val b = images(a.imageKey) ?: return
                        if (b.hasAlpha()) LosslessFactory.createFromImage(doc, b) else JPEGFactory.createFromImage(doc, b, 0.9f)
                    }
                    cs.drawImage(img, a.left, geo.y(a.bottom), a.right - a.left, a.bottom - a.top)
                }
            }
        } finally {
            cs.restoreGraphicsState()
        }
    }

    private fun drawShape(cs: PDPageContentStream, geo: PageGeo, a: ShapeAnnot) {
        val r = a.rect()
        val l = r.left; val t = geo.y(r.top); val rr = r.right; val b = geo.y(r.bottom)
        cs.setLineWidth(a.width)
        cs.setLineCapStyle(1); cs.setLineJoinStyle(1)
        rgb(cs, a.color, true); rgb(cs, a.color, false)
        when (a.type) {
            ShapeType.RECT -> { cs.addRect(l, b, rr - l, t - b); if (a.fill) cs.fill() else cs.stroke() }
            ShapeType.OVAL -> { oval(cs, l, b, rr, t); if (a.fill) cs.fill() else cs.stroke() }
            ShapeType.LINE -> { cs.moveTo(a.x1, geo.y(a.y1)); cs.lineTo(a.x2, geo.y(a.y2)); cs.stroke() }
            ShapeType.ARROW -> {
                cs.moveTo(a.x1, geo.y(a.y1)); cs.lineTo(a.x2, geo.y(a.y2))
                val ang = atan2((a.y2 - a.y1).toDouble(), (a.x2 - a.x1).toDouble())
                val len = 6f + a.width * 3f
                for (d in doubleArrayOf(Math.PI * 0.82, -Math.PI * 0.82)) {
                    cs.moveTo(a.x2, geo.y(a.y2))
                    cs.lineTo(a.x2 + (len * cos(ang + d)).toFloat(), geo.y(a.y2 + (len * sin(ang + d)).toFloat()))
                }
                cs.stroke()
            }
            ShapeType.HIGHLIGHT -> { alpha(cs, 0.4f, true); cs.addRect(l, b, rr - l, t - b); cs.fill() }
            ShapeType.UNDERLINE -> { cs.moveTo(l, b); cs.lineTo(rr, b); cs.stroke() }
            ShapeType.STRIKE -> { val m = (t + b) / 2; cs.moveTo(l, m); cs.lineTo(rr, m); cs.stroke() }
            ShapeType.WHITEOUT -> { cs.setNonStrokingColor(1f, 1f, 1f); cs.addRect(l, b, rr - l, t - b); cs.fill() }
            ShapeType.REDACT -> { cs.setNonStrokingColor(0f, 0f, 0f); cs.addRect(l, b, rr - l, t - b); cs.fill() }
        }
    }

    private fun oval(cs: PDPageContentStream, l: Float, b: Float, r: Float, t: Float) {
        val cx = (l + r) / 2; val cy = (b + t) / 2; val rx = (r - l) / 2; val ry = (t - b) / 2
        cs.moveTo(cx + rx, cy)
        cs.curveTo(cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry)
        cs.curveTo(cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy)
        cs.curveTo(cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry)
        cs.curveTo(cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy)
        cs.closePath()
    }

    /** Cria um carimbo (ex.: APROVADO) como imagem com borda arredondada. */
    fun stampBitmap(text: String, color: Int): Bitmap {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color; textSize = 96f; isFakeBoldText = true; letterSpacing = 0.06f
        }
        val tw = p.measureText(text)
        val w = (tw + 80).toInt(); val h = 170
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val st = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.STROKE; strokeWidth = 10f }
        c.drawRoundRect(android.graphics.RectF(6f, 6f, w - 6f, h - 6f), 24f, 24f, st)
        c.drawText(text, 40f, h / 2f + 34f, p)
        return bmp
    }
}
