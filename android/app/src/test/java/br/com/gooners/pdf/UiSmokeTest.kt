package br.com.gooners.pdf

import android.content.Intent
import android.net.Uri
import android.os.Looper
import android.view.View
import androidx.test.core.app.ApplicationProvider
import br.com.gooners.pdf.create.EditorActivity
import br.com.gooners.pdf.reader.ArchiveActivity
import br.com.gooners.pdf.reader.DocumentViewerActivity
import br.com.gooners.pdf.reader.TextViewerActivity
import br.com.gooners.pdf.tools.ToolActivity
import br.com.gooners.pdf.tools.ToolId
import br.com.gooners.pdf.ui.DeviceFilesActivity
import br.com.gooners.pdf.ui.MainActivity
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.util.DocKind
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UiSmokeTest {
    private fun idle() { repeat(5) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(30) } }

    @Test fun main() {
        val a = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        idle()
        a.findViewById<com.google.android.material.bottomnavigation.BottomNavigationView>(R.id.nav).selectedItemId = R.id.nav_tools
        idle()
        assertTrue(a.findViewById<View>(R.id.toolsList).visibility == View.VISIBLE)
    }

    @Test fun allTools() {
        val pdf = Fixtures.file("sample.pdf")
        for (t in ToolId.values()) {
            if (t == ToolId.NEW_DOC || t == ToolId.SCAN || t == ToolId.ORGANIZE) continue
            val i = Intent(ApplicationProvider.getApplicationContext(), ToolActivity::class.java)
                .putExtra("tool_id", t.name).putExtra("file", pdf.path).putExtra("name", "sample.pdf")
            val a = Robolectric.buildActivity(ToolActivity::class.java, i).setup().get()
            idle()
            assertNotNull(t.name, a.findViewById(R.id.run))
            a.finish()
        }
    }

    @Test fun editor() {
        val i = Intent(ApplicationProvider.getApplicationContext(), EditorActivity::class.java).putExtra(EditorActivity.EXTRA_HTML, "<h1>Oi</h1><p><b>forte</b> texto</p><ul><li>a</li></ul>")
        val c = Robolectric.buildActivity(EditorActivity::class.java, i).setup()
        idle()
        c.pause().stop().destroy()
    }

    private fun open(cls: Class<out android.app.Activity>, fixture: String, kind: DocKind) {
        val f = Fixtures.file(fixture)
        val i = Intent(ApplicationProvider.getApplicationContext(), cls).setData(Uri.fromFile(f))
            .putExtra(Router.EXTRA_KIND, kind.name).putExtra(Router.EXTRA_NAME, fixture)
        val c = Robolectric.buildActivity(cls, i).setup()
        idle(); Thread.sleep(400); idle()
        c.pause().stop().destroy()
    }

    @Test fun viewers() {
        open(DocumentViewerActivity::class.java, "sample.docx", DocKind.DOCX)
        open(DocumentViewerActivity::class.java, "sample.xlsx", DocKind.XLSX)
        open(DocumentViewerActivity::class.java, "sample.epub", DocKind.EPUB)
        open(DocumentViewerActivity::class.java, "sample.md", DocKind.MARKDOWN)
        open(TextViewerActivity::class.java, "sample.csv", DocKind.TEXT)
        open(ArchiveActivity::class.java, "sample.docx", DocKind.ZIP)
        Robolectric.buildActivity(DeviceFilesActivity::class.java).setup()
        idle()
    }
}
