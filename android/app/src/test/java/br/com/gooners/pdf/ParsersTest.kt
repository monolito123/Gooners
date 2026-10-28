package br.com.gooners.pdf

import br.com.gooners.pdf.convert.CsvParser
import br.com.gooners.pdf.convert.DocxPara
import br.com.gooners.pdf.convert.DocxParser
import br.com.gooners.pdf.convert.DocxRun
import br.com.gooners.pdf.convert.DocxWriter
import br.com.gooners.pdf.convert.EpubBook
import br.com.gooners.pdf.convert.Fb2Parser
import br.com.gooners.pdf.convert.LegacyOffice
import br.com.gooners.pdf.convert.Markdown
import br.com.gooners.pdf.convert.OdfParser
import br.com.gooners.pdf.convert.PptxParser
import br.com.gooners.pdf.convert.RtfParser
import br.com.gooners.pdf.convert.XlsxParser
import br.com.gooners.pdf.convert.ZipRes
import br.com.gooners.pdf.util.DocKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ParsersTest {
    private fun has(html: String, vararg parts: String) = parts.forEach { assertTrue("faltou \"$it\" em: ${html.take(3000)}", html.contains(it)) }

    @Test fun docx() {
        val html = ZipRes(Fixtures.file("sample.docx")).use { DocxParser.toHtml(it, "https://doc.local/") }
        has(html, "Relatório Anual", "<h1", "Introdução", "<b>negrito</b>", "itálico vermelho", "color:#C00000", "<ul>", "Primeiro item", "<ol>", "Passo um", "<table>", "R$ 1.234,56", "Coração")
    }

    @Test fun xlsx() {
        val html = ZipRes(Fixtures.file("sample.xlsx")).use { XlsxParser.toHtml(it) }
        has(html, "Vendas", "Resumo", "Caneta", "15,75", "15/03/2024", "01/12/2024", "longe", "<th>F</th>")
    }

    @Test fun pptx() {
        val html = ZipRes(Fixtures.file("sample.pptx")).use { PptxParser.toHtml(it, "https://doc.local/") }
        has(html, "Slide 1", "Slide 2", "<h2>Apresentação Gooners</h2>", "Tópico A", "Tópico B", "Segundo slide")
    }

    @Test fun odt() {
        val html = ZipRes(Fixtures.file("sample.odt")).use { OdfParser.toHtml(it, "https://doc.local/") }
        has(html, "<h1", "Título ODT", "font-weight:bold", "negrito")
    }

    @Test fun epub() {
        ZipRes(Fixtures.file("sample.epub")).use { z ->
            val b = EpubBook(z)
            assertEquals("Livro de Teste", b.title)
            assertTrue(b.chapters.any { it.endsWith("c1.xhtml") } && b.chapters.any { it.endsWith("c2.xhtml") })
            assertTrue("toc=${b.toc.map { it.title }}", b.toc.any { it.title == "Capítulo 2" })
            has(b.combinedHtml("https://doc.local/"), "Era uma vez", "Fim.")
        }
    }

    @Test fun rtf() = has(RtfParser.toHtml(Fixtures.file("sample.rtf").readText()), "Olá", "<b>mundo</b>", "ç", "Segunda linha")

    @Test fun markdown() = has(Markdown.toHtml(Fixtures.file("sample.md").readText()), "<h1>Título</h1>", "<b>forte</b>", "<i>ênfase</i>", "<li>a</li>", "<table>", "<td>1</td>", "codigo &lt;x&gt;")

    @Test fun csv() {
        val rows = CsvParser.parse(Fixtures.file("sample.csv").readText())
        assertEquals(listOf("nome", "valor"), rows[0])
        assertEquals("Silva; João", rows[1][0])
        assertEquals("20,5", rows[2][1])
    }

    @Test fun fb2() = has(Fb2Parser.toHtml(Fixtures.file("sample.fb2").readText()), "Capítulo FB2", "<i>enfático</i>")

    @Test fun docxRoundTrip() {
        val f = Fixtures.tmp("rt.docx")
        DocxWriter.write(f, listOf(DocxPara(listOf(DocxRun("Título")), heading = 1), DocxPara(listOf(DocxRun("forte", bold = true), DocxRun(" & <normal>"))), DocxPara(listOf(DocxRun("item")), bullet = true)), "T")
        val html = ZipRes(f).use { DocxParser.toHtml(it, "") }
        has(html, "<h1>", "Título", "<b>forte</b>", "&amp; &lt;normal&gt;", "item")
    }

    @Test fun legacyText() {
        val text = "Contrato de prestação de serviços entre as partes"
        val bytes = ByteArray(64) + text.toByteArray(Charsets.UTF_16LE) + ByteArray(64)
        assertTrue(LegacyOffice.extractText(bytes).contains(text))
    }

    @Test fun kinds() {
        assertEquals(DocKind.PDF, DocKind.fromName("a.PDF"))
        assertEquals(DocKind.DOCX, DocKind.fromName("x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
        assertEquals(DocKind.CODE, DocKind.fromName("main.kt"))
        assertEquals(DocKind.EPUB, DocKind.fromName("livro.epub"))
        assertEquals("docs/img/a.png", ZipRes.resolve("docs/text/c1.xhtml", "../img/a.png"))
    }
}
