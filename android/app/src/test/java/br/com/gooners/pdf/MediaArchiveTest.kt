package br.com.gooners.pdf

import android.net.Uri
import br.com.gooners.pdf.archive.Archives
import br.com.gooners.pdf.image.ImageDecoders
import br.com.gooners.pdf.player.Playlists
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MediaArchiveTest {
    private fun list(name: String) = Archives.open(Fixtures.file(name), name).use { r -> r.format to r.entries.map { it.path to String(r.bytes(it) ?: ByteArray(0), Charsets.UTF_8) } }

    @Test fun archives() {
        val tgz = list("arq.tar.gz")
        assertEquals("TAR.GZIP", tgz.first)
        assertTrue(tgz.second.toString(), tgz.second.contains("pasta/leia.txt" to "Olá do TAR"))
        assertEquals("abc", list("arq.tar.bz2").second.single().second)
        assertEquals("xz", list("arq.tar.xz").second.single().second)
        assertEquals("texto compactado gzip", list("nota.txt.gz").second.single().second)
        assertEquals("nota.txt", list("nota.txt.gz").second.single().first)
        assertEquals("texto bz2", list("nota.txt.bz2").second.single().second)
        assertEquals("texto xz", list("nota.txt.xz").second.single().second)
        val sz = list("arq.7z")
        assertEquals("7z", sz.first)
        assertTrue(sz.second.toString(), sz.second.contains("docs/info.txt" to "Conteúdo do 7z"))
        val rar = list("junrar_rar4.rar")
        assertEquals("RAR", rar.first)
        assertTrue(rar.second.toString(), rar.second.isNotEmpty())
        println("RAR: ${rar.second}")
        val cbz = list("hq.cbz")
        assertEquals(3, cbz.second.size)
        assertEquals(2, list("hq.cb7").second.size)
    }

    @Test fun images() {
        for (n in listOf("img_lzw.tif", "img_deflate.tif", "img_packbits.tif", "img_jpeg.tif", "img_g4.tif", "img_g3.tif", "img_raw.psd", "img_rle.psd",
            "img.tga", "img_rle.tga", "img.ppm", "img.pgm", "img_ascii.pbm", "img_fake.cr2")) {
            val f = Fixtures.file(n)
            val fmt = ImageDecoders.detect(f.readBytes().copyOf(64), n)
            assertTrue("$n detectado como $fmt", fmt != ImageDecoders.Fmt.PLATFORM)
            val bmp = ImageDecoders.decode(f, fmt, 0, 2048)
            assertTrue("$n não decodificou", bmp != null && bmp.width > 0)
            println("$n -> $fmt ${bmp!!.width}x${bmp.height} centro=${Integer.toHexString(bmp.getPixel(bmp.width / 2, bmp.height / 2))}")
            if (n.endsWith(".tif") && !n.contains("g3") && !n.contains("g4")) {
                // quadrado vermelho em (10..60, 10..50) e círculo azul à direita
                val red = bmp.getPixel(30, 30)
                assertTrue("$n: esperado vermelho em (30,30), veio ${Integer.toHexString(red)}", (red shr 16 and 0xFF) > 150 && (red and 0xFF) < 90)
                val white = bmp.getPixel(5, 5)
                assertTrue("$n: esperado branco no canto, veio ${Integer.toHexString(white)}", (white and 0xFF) > 200 && (white shr 8 and 0xFF) > 200)
            }
            if (n.contains("g4") || n.contains("g3")) {
                val black = bmp.getPixel(30, 30); val white = bmp.getPixel(5, 5)
                assertTrue("$n: preto esperado, veio ${Integer.toHexString(black)}", (black and 0xFFFFFF) < 0x404040)
                assertTrue("$n: branco esperado, veio ${Integer.toHexString(white)}", (white and 0xFFFFFF) > 0xC0C0C0)
            }
            if (n.endsWith(".psd")) assertEquals(0xFFFF0000.toInt(), bmp.getPixel(0, 0))
        }
        assertEquals(3, ImageDecoders.pageCount(Fixtures.file("img_multi.tif"), ImageDecoders.Fmt.TIFF))
        val p2 = ImageDecoders.decode(Fixtures.file("img_multi.tif"), ImageDecoders.Fmt.TIFF, 1, 2048)!!
        assertEquals(120, p2.width)
    }

    @Test fun playlists() {
        val m3u = Playlists.parse(Fixtures.file("lista.m3u").readText(), null)
        assertEquals(2, m3u.size)
        assertEquals("Canal Um", m3u[0].title)
        assertEquals("Notícias", m3u[0].group)
        assertEquals(Uri.parse("https://exemplo.com/musica.mp3"), m3u[1].uri)
        val pls = Playlists.parse(Fixtures.file("lista.pls").readText(), null)
        assertEquals("Rádio Teste", pls.single().title)
        val xspf = Playlists.parse(Fixtures.file("lista.xspf").readText(), null)
        assertEquals("Faixa A", xspf.single().title)
        assertTrue(Playlists.isHls(Fixtures.file("hls.m3u8").readText()))
        assertEquals(Uri.parse("http://h.com/v/seg.ts"), Playlists.resolve(Uri.parse("http://h.com/v/lista.m3u8"), "seg.ts"))
    }
}
