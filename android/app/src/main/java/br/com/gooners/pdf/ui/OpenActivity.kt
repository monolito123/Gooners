package br.com.gooners.pdf.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/** Ponto de entrada para "Abrir com"/"Compartilhar": descobre o formato e chama o leitor correto. */
class OpenActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_SEND -> if (Build.VERSION.SDK_INT >= 33)
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> intent.data
        }
        val sharedText = if (intent.action == Intent.ACTION_SEND) intent.getStringExtra(Intent.EXTRA_TEXT) else null
        val link = sharedText?.let { Regex("(https?|rtsp|rtmp)://\\S+").find(it)?.value }
        if (uri == null && link != null) {
            // link compartilhado como texto (ex.: navegador): abre como transmissão ou baixa o documento
            startActivity(Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_LINK, link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        } else if (uri == null) {
            Toast.makeText(this, "Nenhum arquivo recebido", Toast.LENGTH_SHORT).show()
        } else {
            try {
                Router.open(this, uri)
            } catch (e: Exception) {
                Toast.makeText(this, "Não foi possível abrir: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
        finish()
    }
}
