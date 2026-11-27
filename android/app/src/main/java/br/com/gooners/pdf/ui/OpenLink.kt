package br.com.gooners.pdf.ui

import android.content.Intent
import android.net.Uri
import android.text.InputType
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import br.com.gooners.pdf.player.PlayerActivity
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * "Abrir link": transmissões (HLS, DASH, RTSP, rádios, MP4/MP3 da web) vão para o player;
 * documentos são baixados e abertos no leitor certo.
 */
object OpenLink {
    private const val MAX_DOWNLOAD = 300L * 1024 * 1024

    fun ask(activity: AppCompatActivity, initial: String = "") {
        Dialogs.input(activity, "Abrir link ou transmissão", "https://… (vídeo, rádio, .m3u8, .mpd, rtsp://, PDF…)", initial,
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI, "Abrir") { s -> open(activity, s) }
    }

    fun open(activity: AppCompatActivity, raw: String) {
        var s = raw.trim()
        if (s.isEmpty()) return
        if (!Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(s)) s = "https://$s"
        val uri = Uri.parse(s)
        val scheme = uri.scheme?.lowercase()
        val byName = DocKind.fromName(Uri.decode(uri.path ?: ""))
        if (scheme in setOf("rtsp", "rtmp", "udp", "rtp", "mms") || byName.isMedia) { play(activity, uri); return }
        if (scheme != "http" && scheme != "https") { Dialogs.message(activity, "Link inválido", "Use um endereço http, https ou rtsp."); return }
        val pd = Dialogs.progress(activity, "Conectando…")
        activity.lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) { download(activity, uri) { done, total -> activity.runOnUiThread { pd.update("Baixando… ${FileUtil.human(done)}" + if (total > 0) " de ${FileUtil.human(total)}" else "", if (total > 0) done.toFloat() / total else null) } } }
                pd.dismiss()
                when (result) {
                    null -> play(activity, uri)
                    else -> Router.openFile(activity, result)
                }
            } catch (e: Exception) {
                pd.dismiss()
                Dialogs.message(activity, "Não foi possível abrir o link", e.message ?: e.toString())
            }
        }
    }

    private fun play(activity: AppCompatActivity, uri: Uri) {
        activity.startActivity(Intent(activity, PlayerActivity::class.java).setData(uri).putExtra(Router.EXTRA_NAME, uri.lastPathSegment ?: uri.host ?: "Transmissão"))
    }

    /** Baixa o arquivo; devolve null quando o servidor responde com mídia (então é melhor transmitir). */
    private fun download(activity: AppCompatActivity, uri: Uri, progress: (Long, Long) -> Unit): File? {
        val conn = URL(uri.toString()).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        conn.setRequestProperty("User-Agent", "GoonersPDF/2.0 (Android)")
        try {
            val code = conn.responseCode
            if (code >= 400) throw IllegalStateException("O servidor respondeu com erro $code.")
            val type = conn.contentType?.lowercase().orEmpty()
            if (type.startsWith("video/") || type.startsWith("audio/") || type.contains("mpegurl") || type.contains("dash+xml") || type.contains("ogg")) return null
            val disp = conn.getHeaderField("Content-Disposition")
            var name = disp?.let { Regex("filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) }?.let { Uri.decode(it) }
                ?: Uri.decode(conn.url.path ?: "").substringAfterLast('/').ifBlank { uri.host ?: "download" }
            if (!name.contains('.')) name += when {
                type.contains("pdf") -> ".pdf"
                type.contains("html") -> ".html"
                type.contains("json") -> ".json"
                type.startsWith("text/") -> ".txt"
                type.startsWith("image/") -> "." + type.substringAfter('/').substringBefore(';')
                else -> ""
            }
            val total = conn.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            if (total > MAX_DOWNLOAD) throw IllegalStateException("Arquivo grande demais para abrir direto (${FileUtil.human(total)}).")
            val out = File(FileUtil.dir(activity, "out/web${System.currentTimeMillis()}"), FileUtil.sanitize(name))
            conn.inputStream.use { input ->
                out.outputStream().use { o ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    var last = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        done += n
                        if (done > MAX_DOWNLOAD) throw IllegalStateException("Arquivo grande demais para abrir direto.")
                        if (done - last > 256 * 1024) { last = done; progress(done, total) }
                    }
                }
            }
            return out
        } finally {
            conn.disconnect()
        }
    }
}
