package br.com.gooners.pdf

import br.com.gooners.pdf.convert.Cfb
import br.com.gooners.pdf.convert.EmlParser
import br.com.gooners.pdf.convert.FontInfo
import br.com.gooners.pdf.convert.ICal
import br.com.gooners.pdf.convert.LegacyOffice
import br.com.gooners.pdf.convert.Lzfu
import br.com.gooners.pdf.convert.MobiParser
import br.com.gooners.pdf.convert.MsgParser
import br.com.gooners.pdf.convert.Notebook
import br.com.gooners.pdf.convert.SqliteViewer
import br.com.gooners.pdf.convert.Torrent
import br.com.gooners.pdf.convert.VCard
import br.com.gooners.pdf.convert.XpsParser
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
class FormatsTest {
    private fun has(html: String, vararg parts: String) = parts.forEach { assertTrue("faltou \"$it\" em: ${html.take(4000)}", html.contains(it)) }

    @Test fun cfbListsStreams() {
        Cfb(Fixtures.file("poi_SampleDoc.doc")).use { c ->
            assertTrue(c.entries.map { it.name }.toString(), c.entries.any { it.name == "WordDocument" })
            assertEquals(DocKind.DOC, DocKind.kindOfCfb(c))
        }
        Cfb(Fixtures.file("poi_SampleSS.xls")).use { assertEquals(DocKind.XLS, DocKind.kindOfCfb(it)) }
        Cfb(Fixtures.file("poi_SampleShow.ppt")).use { assertEquals(DocKind.PPT, DocKind.kindOfCfb(it)) }
        Cfb(Fixtures.file("poi_quick.msg")).use { assertEquals(DocKind.MSG, DocKind.kindOfCfb(it)) }
    }

    @Test fun legacyWord() {
        val text = Cfb(Fixtures.file("poi_SampleDoc.doc")).use { LegacyOffice.docText(it) }
        println("DOC: " + text.take(500))
        assertTrue(text, text.contains("I am a test document"))
        has(LegacyOffice.toHtml(Fixtures.file("poi_SampleDoc.doc")), "I am a test document", "<p>")
    }

    @Test fun legacyExcel() {
        val sheets = Cfb(Fixtures.file("poi_SampleSS.xls")).use { LegacyOffice.xlsSheets(it) }
        println("XLS: " + sheets.map { it.name to it.rows.take(6) })
        assertTrue(sheets.isNotEmpty())
        assertTrue(sheets.flatMap { it.rows }.flatten().any { it.contains("Nick Burch") || it.isNotBlank() })
    }

    @Test fun legacyPowerPoint() {
        val slides = Cfb(Fixtures.file("poi_SampleShow.ppt")).use { LegacyOffice.pptSlides(it) }
        println("PPT: " + slides)
        assertTrue(slides.isNotEmpty())
        val html = LegacyOffice.toHtml(Fixtures.file("poi_SampleShow.ppt"))
        has(html, "Slide 1")
        assertTrue("textos de mestre não devem aparecer", !html.contains("Click to edit Master"))
    }

    @Test fun outlookMsg() {
        val r = Cfb(Fixtures.file("poi_attachment_test_msg.msg")).use { MsgParser.toHtml(it) }
        println("MSG: " + r.body.take(1500))
        has(r.body, "test pièce jointe 1", "Nicolas1 23456", "contenu", "test-unicode.doc", "pj1.txt")
        assertEquals(2, r.files.size)
        val q = Cfb(Fixtures.file("poi_quick.msg")).use { MsgParser.toHtml(it) }
        println("QUICK: " + q.body.take(800))
        assertTrue(q.body.length > 50)
    }

    @Test fun lzfuPrebuffer() = assertEquals(207, Lzfu.PREBUF.length)

    @Test fun email() {
        val r = EmlParser.toHtml(Fixtures.file("mail.eml").readBytes(), "mail.eml")
        println("EML: " + r.body)
        has(r.body, "Relatório mensal", "João Silva", "Olá Maria, segue o relatório.", "https://doc.local/v/", "dados.txt", "open/")
        val att = r.files.values.first { it.name == "dados.txt" }
        assertEquals("conteúdo do anexo", String(att.bytes, Charsets.UTF_8))
        val box = EmlParser.toHtml(Fixtures.file("caixa.mbox").readBytes(), "caixa.mbox")
        has(box.body, "Primeira", "Segunda", "Corpo dois")
        val mht = EmlParser.toHtml(Fixtures.file("pagina.mht").readBytes(), "pagina.mht")
        has(mht.body, "Pagina salva", "https://doc.local/v/")
    }

    @Test fun mobi() {
        val r = MobiParser.toHtml(Fixtures.file("livro.mobi").readBytes())
        println("MOBI: " + r.body)
        has(r.body, "Livro de Teste MOBI", "Era uma vez um livro Kindle.", "hr class=\"pb\"", "https://doc.local/v/img1")
        assertTrue(r.files.containsKey("img1"))
        // PalmDOC com referência para trás: "abc" + (distância 3, 6 bytes) = "abcabcabc"
        val v = (3 shl 3) or (6 - 3)
        val packed = byteArrayOf('a'.code.toByte(), 'b'.code.toByte(), 'c'.code.toByte(), (0x80 or (v shr 8)).toByte(), (v and 0xFF).toByte(), 0xE1.toByte())
        assertEquals("abcabcabc a", String(MobiParser.palmDoc(packed), Charsets.ISO_8859_1))
    }

    @Test fun xps() {
        val html = ZipRes(Fixtures.file("doc.xps")).use { XpsParser.toHtml(it) }
        has(html, "<svg", "Texto do XPS", "M 10,10 L 200,10", "rgba(255,0,0")
    }

    @Test fun smallFormats() {
        has(Notebook.toHtml(Fixtures.file("nb.ipynb").readText()), "<h1>Análise</h1>", "<b>forte</b>", "print(&#39;oi&#39;)".let { "print(" }, "oi", "42", "In [1]")
        has(VCard.toHtml(Fixtures.file("contatos.vcf").readText()), "2 contato(s)", "João Silva", "tel:+5561", "joao@exemplo.com", "Anaç")
        has(ICal.toHtml(Fixtures.file("agenda.ics").readText()), "Trabalho", "Reunião de equipe", "Sala 2, Brasília", "Orçamento", "dia inteiro")
        val t = Torrent.toHtml(Fixtures.file("arq.torrent").readBytes())
        has(t, "Filmes", "a/b.mkv", "udp://tracker.exemplo:80", Fixtures.file("arq.torrent.hash").readText().trim(), "magnet:?xt=urn:btih:")
        has(SqliteViewer.toHtml(Fixtures.file("banco.db")), "clientes", "v_ricos", "Ana", "10.5", "BLOB 2 bytes", "NULL")
        val font = FontInfo.toHtml(Fixtures.file("fonte.ttf").readBytes(), "fonte.ttf")
        has(font.body, "Liberation Sans", "@font-face", "Zebras caolhas")
    }

    @Test fun detection() {
        fun k(name: String) = DocKind.sniffBytes(Fixtures.file(name).readBytes().copyOf(4096), minOf(4096, Fixtures.file(name).length().toInt()))
        assertEquals(DocKind.ARCHIVE, k("arq.7z"))
        assertEquals(DocKind.ARCHIVE, k("arq.tar.gz"))
        assertEquals(DocKind.ARCHIVE, k("junrar_rar4.rar"))
        assertEquals(DocKind.IMAGE, k("img_lzw.tif"))
        assertEquals(DocKind.IMAGE, k("img_raw.psd"))
        assertEquals(DocKind.SQLITE, k("banco.db"))
        assertEquals(DocKind.MOBI, k("livro.mobi"))
        assertEquals(DocKind.TORRENT, k("arq.torrent"))
        assertEquals(DocKind.VCARD, k("contatos.vcf"))
        assertEquals(DocKind.ICAL, k("agenda.ics"))
        assertEquals(DocKind.PLAYLIST, k("lista.m3u"))
        assertEquals(DocKind.EML, k("mail.eml"))
        assertEquals(DocKind.FONT, k("fonte.ttf"))
        assertEquals(DocKind.VIDEO, DocKind.fromName("filme.mkv"))
        assertEquals(DocKind.AUDIO, DocKind.fromName("musica.flac"))
        assertEquals(DocKind.ARCHIVE, DocKind.fromName("backup.tar.gz"))
        assertEquals(DocKind.CBZ, DocKind.fromName("hq.cbr"))
        assertEquals(DocKind.MOBI, DocKind.fromName("livro.azw3"))
    }
}
