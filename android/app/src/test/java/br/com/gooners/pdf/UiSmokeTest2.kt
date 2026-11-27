package br.com.gooners.pdf

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import br.com.gooners.pdf.create.CodeEditorActivity
import br.com.gooners.pdf.create.EditorActivity
import br.com.gooners.pdf.create.SheetEditorActivity
import br.com.gooners.pdf.image.ImageEditorActivity
import br.com.gooners.pdf.player.PlayerActivity
import br.com.gooners.pdf.reader.ArchiveActivity
import br.com.gooners.pdf.reader.DocumentViewerActivity
import br.com.gooners.pdf.reader.ImageViewerActivity
import br.com.gooners.pdf.reader.TextViewerActivity
import br.com.gooners.pdf.tools.ToolActivity
import br.com.gooners.pdf.tools.ToolId
import br.com.gooners.pdf.ui.DeviceFilesActivity
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.util.DocKind
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Abre cada tela nova com arquivos reais e garante que nada quebra ao carregar. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UiSmokeTest2 {
    private fun idle() { repeat(6) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(40) } }

    private fun open(cls: Class<out Activity>, fixture: String, kind: DocKind?, extra: (Intent.() -> Unit)? = null) {
        val f = Fixtures.file(fixture)
        val i = Intent(ApplicationProvider.getApplicationContext(), cls).setData(Uri.fromFile(f)).putExtra(Router.EXTRA_NAME, fixture)
        if (kind != null) i.putExtra(Router.EXTRA_KIND, kind.name)
        extra?.invoke(i)
        val c = Robolectric.buildActivity(cls, i).setup()
        idle(); Thread.sleep(500); idle()
        c.pause().stop().destroy()
    }

    @Test fun documentViewers() {
        listOf("mail.eml" to DocKind.EML, "caixa.mbox" to DocKind.EML, "pagina.mht" to DocKind.EML, "poi_attachment_test_msg.msg" to DocKind.MSG,
            "livro.mobi" to DocKind.MOBI, "doc.xps" to DocKind.XPS, "nb.ipynb" to DocKind.IPYNB, "contatos.vcf" to DocKind.VCARD,
            "agenda.ics" to DocKind.ICAL, "arq.torrent" to DocKind.TORRENT, "banco.db" to DocKind.SQLITE, "fonte.ttf" to DocKind.FONT,
            "poi_SampleDoc.doc" to DocKind.DOC, "poi_SampleSS.xls" to DocKind.XLS, "poi_SampleShow.ppt" to DocKind.PPT
        ).forEach { (f, k) -> open(DocumentViewerActivity::class.java, f, k) }
    }

    @Test fun mediaAndArchives() {
        open(PlayerActivity::class.java, "tom.wav", DocKind.AUDIO)
        open(PlayerActivity::class.java, "lista.m3u", DocKind.PLAYLIST)
        open(ArchiveActivity::class.java, "arq.7z", DocKind.ARCHIVE)
        open(ArchiveActivity::class.java, "arq.tar.gz", DocKind.ARCHIVE)
        open(ArchiveActivity::class.java, "junrar_rar4.rar", DocKind.ARCHIVE)
        open(ImageViewerActivity::class.java, "img_multi.tif", DocKind.IMAGE)
        open(ImageViewerActivity::class.java, "img_rle.psd", DocKind.IMAGE)
        open(ImageViewerActivity::class.java, "hq.cb7", DocKind.CBZ)
        open(ImageViewerActivity::class.java, "foto.png", DocKind.IMAGE)
    }

    @Test fun editors() {
        open(CodeEditorActivity::class.java, "legenda.srt", null)
        open(SheetEditorActivity::class.java, "sample.xlsx", DocKind.XLSX)
        open(SheetEditorActivity::class.java, "sample.csv", DocKind.CSV)
        open(SheetEditorActivity::class.java, "poi_SampleSS.xls", DocKind.XLS)
        open(EditorActivity::class.java, "sample.docx", null) { putExtra(EditorActivity.EXTRA_SOURCE_KIND, DocKind.DOCX.name) }
        open(ImageEditorActivity::class.java, "foto.png", null)
        open(TextViewerActivity::class.java, "sample.md", DocKind.CODE)
    }

    @Test fun newTools() {
        for (t in listOf(ToolId.ZIP_CREATE, ToolId.UNZIP, ToolId.PLAY_MEDIA, ToolId.EDIT_DOC, ToolId.IMAGE_EDIT, ToolId.NEW_SHEET, ToolId.NEW_TEXT, ToolId.OPEN_LINK)) {
            val i = Intent(ApplicationProvider.getApplicationContext(), ToolActivity::class.java).putExtra("tool_id", t.name)
            Robolectric.buildActivity(ToolActivity::class.java, i).setup()
            idle()
        }
        Robolectric.buildActivity(DeviceFilesActivity::class.java).setup()
        idle()
    }
}
