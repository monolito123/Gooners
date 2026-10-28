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
        if (uri == null) {
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
