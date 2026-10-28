package br.com.gooners.pdf.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import br.com.gooners.pdf.reader.ArchiveActivity
import br.com.gooners.pdf.reader.DocumentViewerActivity
import br.com.gooners.pdf.reader.ImageViewerActivity
import br.com.gooners.pdf.reader.TextViewerActivity
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Recents
import br.com.gooners.pdf.viewer.PdfViewerActivity
import java.io.File

object Router {
    const val EXTRA_KIND = "kind"
    const val EXTRA_NAME = "name"
    const val EXTRA_EDIT = "edit"
    const val EXTRA_TOOL = "tool"

    fun persist(ctx: Context, uri: Uri) {
        try {
            ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
        }
        try {
            ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        } catch (_: Exception) {
        }
    }

    /** Abre qualquer documento no leitor adequado. [extra] permite pedir modo edição ou uma ferramenta no PDF. */
    fun open(ctx: Context, uri: Uri, nameHint: String? = null, addRecent: Boolean = true, extra: (Intent.() -> Unit)? = null) {
        val name = nameHint ?: FileUtil.displayName(ctx, uri)
        val kind = DocKind.detect(ctx, uri, name)
        if (addRecent && uri.scheme == "content" && !uri.authority.orEmpty().endsWith(".files")) {
            Recents.add(ctx, uri.toString(), name, kind, FileUtil.size(ctx, uri))
        }
        val cls = when (kind) {
            DocKind.PDF -> PdfViewerActivity::class.java
            DocKind.IMAGE, DocKind.CBZ -> ImageViewerActivity::class.java
            DocKind.ZIP -> ArchiveActivity::class.java
            DocKind.TEXT, DocKind.CODE, DocKind.UNKNOWN -> TextViewerActivity::class.java
            else -> DocumentViewerActivity::class.java
        }
        val i = Intent(ctx, cls).setData(uri)
            .putExtra(EXTRA_KIND, kind.name)
            .putExtra(EXTRA_NAME, name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        if (ctx !is Activity) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        extra?.invoke(i)
        ctx.startActivity(i)
    }

    fun openFile(ctx: Context, file: File, extra: (Intent.() -> Unit)? = null) =
        open(ctx, Uri.fromFile(file), file.name, addRecent = false, extra = extra)
}
