package br.com.gooners.pdf

import android.graphics.Bitmap
import android.graphics.Color
import br.com.gooners.pdf.convert.ZipRes
import br.com.gooners.pdf.edit.FormFiller
import br.com.gooners.pdf.edit.ImageAnnot
import br.com.gooners.pdf.edit.InkAnnot
import br.com.gooners.pdf.edit.PdfBoxUtil
import br.com.gooners.pdf.edit.PdfSaver
import br.com.gooners.pdf.edit.ShapeAnnot
import br.com.gooners.pdf.edit.ShapeType
import br.com.gooners.pdf.edit.TextAnnot
import br.com.gooners.pdf.tools.PdfTools
import br.com.gooners.pdf.viewer.PdfText
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.text.PDFTextStripper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.math.abs

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PdfToolsTest {
    private val noop: (String, Float?) -> Unit = { _, _ -> }
    private fun text(f: File, pw: String? = null) = PdfBoxUtil.load(f, pw).use { PDFTextStripper().getText(it) }
    private fun pages(f: File) = PdfTools.pageCount(f)

    @Test fun ranges() {
        assertEquals(listOf(0..2, 4..4, 7..9), PdfTools.parseRanges("1-3, 5, 8-", 10))
        assertEquals(listOf(0..9), PdfTools.parseRanges("", 10))
    }

    @Test fun mergeSplitExtractDelete() {
        val a = Fixtures.file("sample.pdf")
        val merged = Fixtures.tmp("m.pdf")
        PdfTools.merge(listOf(a, a), merged, noop)
        assertEquals(6, pages(merged))
        val parts = PdfTools.split(merged, null, (0 until 6 step 2).map { it..it + 1 }, merged.parentFile!!, "p", noop)
        assertEquals(3, parts.size); assertEquals(2, pages(parts[0]))
        val ex = Fixtures.tmp("e.pdf"); PdfTools.extract(a, null, listOf(1, 2), ex)
        assertEquals(2, pages(ex)); assertTrue(text(ex).contains("Pagina 2"))
        val del = Fixtures.tmp("d.pdf"); PdfTools.deletePages(a, null, setOf(0), del)
        assertFalse(text(del).contains("Pagina 1"))
    }

    @Test fun protectUnlock() {
        val a = Fixtures.file("sample.pdf")
        val enc = Fixtures.tmp("enc.pdf")
        PdfTools.protect(a, enc, "1234", "dono")
        assertTrue(PdfBoxUtil.needsPassword(enc))
        assertTrue(text(enc, "1234").contains("Segunda linha"))
        val dec = Fixtures.tmp("dec.pdf"); PdfTools.unlock(enc, "1234", dec)
        assertFalse(PdfBoxUtil.needsPassword(dec))
    }

    @Test fun stamps() {
        val a = Fixtures.file("sample.pdf")
        val w = Fixtures.tmp("w.pdf"); PdfTools.watermark(a, null, w, "CONFIDENCIAL", 60f, 0.2f, Color.GRAY, false)
        assertTrue(text(w).contains("CONFIDENCIAL"))
        val wd = Fixtures.tmp("wd.pdf"); PdfTools.watermark(a, null, wd, "RASCUNHO", 60f, 0.2f, Color.GRAY, true)
        assertEquals(3, pages(wd))
        val n = Fixtures.tmp("n.pdf"); PdfTools.pageNumbers(a, null, n, PdfTools.Pos.BOTTOM_CENTER, "Página {n} de {total}", 1, 10f, false)
        assertTrue(text(n).contains("Página 3 de 3"))
        val h = Fixtures.tmp("h.pdf"); PdfTools.headerFooter(a, null, h, "Cabeçalho {n}", "Rodapé {total}", 9f)
        val t = text(h); assertTrue(t.contains("Cabeçalho 2")); assertTrue(t.contains("Rodapé 3"))
    }

    @Test fun convertAndMeta() {
        val a = Fixtures.file("sample.pdf")
        val txt = Fixtures.tmp("t.txt"); PdfTools.toText(a, null, txt, noop)
        assertTrue(txt.readText().contains("Segunda linha de texto"))
        val docx = Fixtures.tmp("t.docx"); PdfTools.toDocx(a, null, docx, "t", noop)
        assertTrue(ZipRes(docx).use { it.text("word/document.xml")!! }.contains("Pagina 2"))
        val html = Fixtures.tmp("t.html"); PdfTools.toHtml(a, null, html, "t", noop)
        assertTrue(html.readText().contains("Página 3"))
        val r = Fixtures.tmp("r.pdf"); PdfTools.rotate(a, null, 90, setOf(1), r)
        PdfBoxUtil.load(r).use { assertEquals(0, it.getPage(0).rotation); assertEquals(90, it.getPage(1).rotation) }
        val m = Fixtures.tmp("meta.pdf"); PdfTools.writeMeta(a, null, m, "Título X", "Autor Y", "", "")
        assertEquals("Título X", PdfTools.readMeta(m, null)["title"])
        val c = Fixtures.tmp("c.pdf"); PdfTools.compress(a, null, c, 1200, 0.6f, 0, noop)
        assertEquals(3, pages(c))
        val blank = Fixtures.tmp("b.pdf"); PdfTools.blank(blank, 4, 0, false, 2)
        assertEquals(4, pages(blank))
    }

    @Test fun forms() {
        val f = Fixtures.file("form.pdf")
        val fields = FormFiller.read(f, null)
        assertTrue(fields.map { it.name }.toString(), fields.any { it.name == "nome" })
        val out = Fixtures.tmp("f.pdf")
        FormFiller.write(f, out, null, mapOf("nome" to "João da Silva", "aceito" to "1"), false)
        val back = FormFiller.read(out, null)
        assertEquals("João da Silva", back.first { it.name == "nome" }.value)
        assertEquals("1", back.first { it.name == "aceito" }.value)
    }

    @Test fun annotationsAndSearch() {
        val a = Fixtures.file("sample.pdf")
        val out = Fixtures.tmp("ann.pdf")
        val sig = Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLUE) }
        val annots = listOf(
            TextAnnot(0, "Olá anotação ç", 100f, 300f, 14f, Color.RED),
            ShapeAnnot(0, ShapeType.HIGHLIGHT, 70f, 70f, 300f, 90f, Color.YELLOW, 2f),
            ShapeAnnot(1, ShapeType.ARROW, 10f, 10f, 200f, 200f, Color.BLACK, 2f),
            ShapeAnnot(1, ShapeType.OVAL, 10f, 10f, 200f, 100f, Color.BLACK, 2f),
            InkAnnot(2, floatArrayOf(10f, 10f, 20f, 30f, 40f, 35f), Color.BLUE, 2f),
            ImageAnnot(2, "sig", 100f, 100f, 180f, 140f)
        )
        PdfSaver.save(a, out, annots, { if (it == "sig") sig else null }, null, false)
        assertTrue(text(out).contains("Olá anotação ç"))
        // a busca acha o texto original na posição esperada (A4: 842 pt de altura; linha em y=760 a partir de baixo)
        PdfText(out, null).use { t ->
            val hits = t.page(0).find("busca")
            assertEquals(1, hits.size)
            assertTrue("x=${hits[0].left}", hits[0].left > 72 && hits[0].left < 400)
            assertTrue("y=${hits[0].bottom}", abs(hits[0].bottom - (842 - 760)) < 8)
            val line = t.page(0).lineAt(150f, 300f + 7f)
            assertTrue(line?.text, line?.text?.contains("anotação") == true)
        }
    }

    /** Texto anotado numa página girada 90° deve aparecer onde o usuário tocou (coordenadas da tela). */
    @Test fun rotatedPageGeometry() {
        val src = Fixtures.tmp("rot.pdf")
        PDDocument().use { d -> d.addPage(PDPage(PDRectangle.A4).apply { rotation = 90 }); d.save(src) }
        val out = Fixtures.tmp("rot_out.pdf")
        PdfSaver.save(src, out, listOf(TextAnnot(0, "Girado", 50f, 60f, 12f, Color.BLACK)), { null }, null, false)
        PdfText(out, null).use { t ->
            val r = t.page(0).find("girado").single()
            // página exibida: 842 x 595; texto no canto superior esquerdo
            assertTrue("rect=$r", abs(r.left - 50f) < 3 && abs(r.bottom - (60f + 12 * 0.9f)) < 6)
        }
    }

    @Test fun redactionRemovesText() {
        // a tarja usa o renderizador nativo, indisponível no Robolectric: só verifica que o PdfBox grava a caixa preta
        val a = Fixtures.file("sample.pdf")
        val out = Fixtures.tmp("white.pdf")
        PdfSaver.save(a, out, listOf(ShapeAnnot(0, ShapeType.WHITEOUT, 60f, 60f, 400f, 120f, 0, 0f)), { null }, null, true)
        assertEquals(3, pages(out))
    }
}
