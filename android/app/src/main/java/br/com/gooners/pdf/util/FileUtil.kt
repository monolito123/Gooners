package br.com.gooners.pdf.util

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.text.DecimalFormat
import java.util.Locale

object FileUtil {

    fun displayName(ctx: Context, uri: Uri): String {
        if (uri.scheme == "file") return File(uri.path ?: "arquivo").name
        try {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val v = c.getString(0)
                    if (!v.isNullOrBlank()) return v
                }
            }
        } catch (_: Exception) {
        }
        return Uri.decode(uri.lastPathSegment ?: "arquivo").substringAfterLast('/')
    }

    fun size(ctx: Context, uri: Uri): Long {
        if (uri.scheme == "file") return File(uri.path ?: "").length()
        try {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
            }
        } catch (_: Exception) {
        }
        return -1
    }

    fun open(ctx: Context, uri: Uri): InputStream =
        ctx.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Não foi possível abrir o arquivo")

    fun dir(ctx: Context, sub: String): File = File(ctx.cacheDir, sub).apply { mkdirs() }

    fun keyFor(uri: Uri): String {
        val md = MessageDigest.getInstance("MD5").digest(uri.toString().toByteArray())
        return md.joinToString("") { "%02x".format(it) }.take(16)
    }

    /** Copia o conteúdo para o cache (cópia de trabalho). Arquivos locais são usados diretamente. */
    fun copyToCache(ctx: Context, uri: Uri, sub: String = "work", name: String? = null): File {
        if (uri.scheme == "file") {
            val f = File(uri.path!!)
            if (f.canRead()) return f
        }
        val n = sanitize(name ?: displayName(ctx, uri))
        val out = File(dir(ctx, "$sub/${keyFor(uri)}${System.nanoTime() % 100000}"), n)
        out.parentFile?.mkdirs()
        open(ctx, uri).use { input -> out.outputStream().use { input.copyTo(it, 64 * 1024) } }
        return out
    }

    fun newOutFile(ctx: Context, name: String): File {
        val d = File(dir(ctx, "out"), System.currentTimeMillis().toString())
        d.mkdirs()
        return File(d, sanitize(name))
    }

    fun tempFile(ctx: Context, ext: String): File =
        File(dir(ctx, "tmp"), "t${System.nanoTime()}.$ext")

    fun sanitize(name: String): String =
        name.replace(Regex("[\\\\/:*?\"<>|\\n\\r\\t]"), "_").trim().ifEmpty { "arquivo" }.take(120)

    fun extension(name: String): String = name.substringAfterLast('.', "").lowercase(Locale.ROOT)

    fun baseName(name: String): String = if (name.contains('.')) name.substringBeforeLast('.') else name

    fun mimeOf(name: String): String {
        val ext = extension(name)
        return when (ext) {
            "pdf" -> "application/pdf"
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "txt", "md", "log" -> "text/plain"
            "html", "htm" -> "text/html"
            "zip" -> "application/zip"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }

    fun uriFor(ctx: Context, file: File): Uri =
        FileProvider.getUriForFile(ctx, ctx.packageName + ".files", file)

    fun share(activity: Activity, files: List<File>) {
        if (files.isEmpty()) return
        val uris = ArrayList(files.map { uriFor(activity, it) })
        val intent = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).apply {
                type = mimeOf(files[0].name)
                putExtra(Intent.EXTRA_STREAM, uris[0])
                clipData = ClipData.newRawUri(files[0].name, uris[0])
            }
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = if (files.all { mimeOf(it.name) == mimeOf(files[0].name) }) mimeOf(files[0].name) else "*/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(Intent.createChooser(intent, "Compartilhar"))
    }

    fun openWithOtherApp(activity: Activity, uri: Uri, mime: String?) {
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime ?: "*/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            activity.startActivity(Intent.createChooser(i, "Abrir com"))
        } catch (_: Exception) {
        }
    }

    fun writeTo(ctx: Context, file: File, uri: Uri) {
        (ctx.contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException("Sem acesso de escrita"))
            .use { out -> file.inputStream().use { it.copyTo(out, 64 * 1024) } }
    }

    fun human(bytes: Long): String {
        if (bytes < 0) return ""
        if (bytes < 1024) return "$bytes B"
        val units = arrayOf("KB", "MB", "GB")
        var v = bytes / 1024.0
        var i = 0
        while (v >= 1024 && i < units.size - 1) {
            v /= 1024; i++
        }
        return DecimalFormat("#,##0.#").format(v) + " " + units[i]
    }
}
