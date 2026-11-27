package br.com.gooners.pdf.player

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.TextView
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.FileUtil

/**
 * Reprodutor do próprio Android (MediaPlayer): usado para MIDI/toques e como alternativa
 * quando o player principal não reconhece um arquivo.
 */
class SystemPlayerActivity : AppCompatActivity() {
    private lateinit var video: VideoView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri: Uri = intent.data ?: run { finish(); return }
        val name = intent.getStringExtra(Router.EXTRA_NAME) ?: runCatching { FileUtil.displayName(this, uri) }.getOrDefault("Mídia")
        title = name
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        video = VideoView(this)
        root.addView(video, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        val label = TextView(this).apply {
            text = "♪ $name\n\nReprodutor do sistema"
            setTextColor(0xCCFFFFFF.toInt()); textSize = 16f; gravity = Gravity.CENTER
            setPadding(dp(24), dp(24), dp(24), dp(24))
        }
        root.addView(label, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        setContentView(root)
        val controller = MediaController(this)
        controller.setAnchorView(video)
        video.setMediaController(controller)
        video.setOnPreparedListener { mp ->
            if (mp.videoWidth > 0) label.visibility = TextView.GONE
            video.start()
            controller.show(0)
        }
        video.setOnErrorListener { _, _, _ ->
            Dialogs.message(this, "Não foi possível reproduzir", "Nem o reprodutor do sistema reconhece este arquivo. Tente \"Abrir com outro app\" no player principal.")
            true
        }
        video.setVideoURI(uri)
    }

    override fun onPause() {
        super.onPause()
        if (video.isPlaying) video.pause()
    }
}
