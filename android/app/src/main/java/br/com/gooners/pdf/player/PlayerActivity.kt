package br.com.gooners.pdf.player

import android.app.PictureInPictureParams
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Rational
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.RepeatModeUtil
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.convert.TextDecode
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.Router
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.util.Prefs
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs

/** Player de vídeo e áudio: arquivos locais, listas M3U/PLS/XSPF e transmissões (HLS, DASH, RTSP, HTTP). */
@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_URIS = "uris"
        const val EXTRA_TITLES = "titles"
        const val EXTRA_INDEX = "index"

        /** Toca uma lista (ex.: todas as músicas do aparelho) começando em [index]. */
        fun playList(ctx: Context, uris: List<Uri>, titles: List<String>, index: Int) {
            ctx.startActivity(Intent(ctx, PlayerActivity::class.java)
                .putStringArrayListExtra(EXTRA_URIS, ArrayList(uris.map { it.toString() }))
                .putStringArrayListExtra(EXTRA_TITLES, ArrayList(titles))
                .putExtra(EXTRA_INDEX, index)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
    }

    private lateinit var playerView: PlayerView
    private lateinit var toolbar: MaterialToolbar
    private lateinit var info: TextView
    private lateinit var lockButton: ImageButton
    private lateinit var loading: View
    private var service: PlaybackService? = null
    private var player: ExoPlayer? = null
    private var pending: Pair<List<MediaEntry>, Int>? = null
    private var bound = false
    private var locked = false
    private var name = ""
    private val handler = Handler(Looper.getMainLooper())
    private val hideInfo = Runnable { info.visibility = View.GONE }
    private var sleepAt = 0L
    private val sleepRunnable = Runnable { player?.pause(); sleepAt = 0; toast("Timer: reprodução pausada") }
    private val audio by lazy { getSystemService(AUDIO_SERVICE) as AudioManager }

    private val pickSubtitle = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { addSubtitle(it) } }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(n: ComponentName?, binder: IBinder?) {
            val s = (binder as? PlaybackService.LocalBinder)?.service ?: return
            service = s
            attach(s.player)
        }

        override fun onServiceDisconnected(n: ComponentName?) {
            service = null
            player = null
        }
    }

    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            updateTitle()
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) {
                mediaItem?.mediaId?.let { id -> val pos = resumePosition(id); if (pos > 0) player?.seekTo(pos) }
            }
        }

        override fun onPlaybackStateChanged(state: Int) {
            // o PlayerView já mostra o indicador de carregamento
            loading.visibility = View.GONE
            if (state == Player.STATE_ENDED) player?.currentMediaItem?.mediaId?.let { Prefs.putLong("pos_" + FileUtil.keyFor(Uri.parse(it)), 0) }
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width <= 0 || videoSize.height <= 0) return
            if (Prefs.getBoolean("rotate_video", true) && !isInPip()) {
                requestedOrientation = if (videoSize.width * videoSize.pixelWidthHeightRatio > videoSize.height)
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            }
            updatePipParams()
        }

        override fun onTracksChanged(tracks: Tracks) {
            val video = tracks.containsType(C.TRACK_TYPE_VIDEO)
            playerView.keepScreenOn = video
            if (!video && Prefs.getBoolean("rotate_video", true)) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }

        override fun onPlayerError(error: PlaybackException) = showError(error)

        // Android 12+: a janela flutuante automática só vale enquanto um vídeo está tocando
        override fun onIsPlayingChanged(isPlaying: Boolean) = updatePipParams()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        playerView = findViewById(R.id.playerView)
        toolbar = findViewById(R.id.toolbar)
        info = findViewById(R.id.gestureInfo)
        lockButton = findViewById(R.id.lockButton)
        loading = findViewById(R.id.loading)
        toolbar.setNavigationOnClickListener { finish() }
        toolbar.inflateMenu(R.menu.player)
        toolbar.menu.findItem(R.id.m_bg).isChecked = Prefs.getBoolean("bg_video", false)
        toolbar.menu.findItem(R.id.m_rotate).isChecked = Prefs.getBoolean("rotate_video", true)
        toolbar.menu.findItem(R.id.m_pip).isVisible = Build.VERSION.SDK_INT >= 26
        toolbar.setOnMenuItemClickListener { onMenu(it.itemId); true }
        toolbar.navigationIcon?.setTint(0xFFFFFFFF.toInt())
        toolbar.overflowIcon?.setTint(0xFFFFFFFF.toInt())

        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        playerView.setShowShuffleButton(true)
        playerView.setRepeatToggleModes(RepeatModeUtil.REPEAT_TOGGLE_MODE_ONE or RepeatModeUtil.REPEAT_TOGGLE_MODE_ALL)
        playerView.setShowSubtitleButton(true)
        playerView.setArtworkDisplayMode(PlayerView.ARTWORK_DISPLAY_MODE_FIT)
        playerView.defaultArtwork = ContextCompat.getDrawable(this, R.drawable.art_music)
        playerView.controllerShowTimeoutMs = 3500
        playerView.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v ->
            if (locked || isInPip()) return@ControllerVisibilityListener
            toolbar.visibility = v
            lockButton.visibility = v
            systemBars(v == View.VISIBLE)
        })
        playerView.setFullscreenButtonClickListener { full ->
            requestedOrientation = if (full) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
        lockButton.setOnClickListener { setLocked(!locked) }
        setupGestures()

        handleIntent(intent)
        val svc = Intent(this, PlaybackService::class.java)
        try { startService(svc) } catch (_: Exception) {}
        bound = bindService(Intent(this, PlaybackService::class.java).setAction(PlaybackService.ACTION_LOCAL), connection, BIND_AUTO_CREATE)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    // ------------------------------------------------------------------ fila de reprodução
    private fun handleIntent(i: Intent) {
        val uris = i.getStringArrayListExtra(EXTRA_URIS)
        if (uris != null) {
            val titles = i.getStringArrayListExtra(EXTRA_TITLES).orEmpty()
            setPending(uris.mapIndexed { k, u -> MediaEntry(Uri.parse(u), titles.getOrNull(k)) }, i.getIntExtra(EXTRA_INDEX, 0))
            return
        }
        val uri = i.data ?: return
        name = i.getStringExtra(Router.EXTRA_NAME) ?: runCatching { FileUtil.displayName(this, uri) }.getOrDefault(uri.lastPathSegment ?: "Mídia")
        toolbar.title = FileUtil.baseName(name)
        if (FileUtil.extension(name) in DocKind.systemPlayerExt) {
            // MIDI e toques: sintetizador do próprio Android
            startActivity(Intent(this, SystemPlayerActivity::class.java).setData(uri).putExtra(Router.EXTRA_NAME, name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            finish()
            return
        }
        val kind = runCatching { DocKind.valueOf(i.getStringExtra(Router.EXTRA_KIND) ?: "") }.getOrNull() ?: DocKind.fromName(name)
        if (kind != DocKind.PLAYLIST) { setPending(listOf(MediaEntry(uri, FileUtil.baseName(name))), 0); return }
        lifecycleScope.launch {
            val entries = withContext(Dispatchers.IO) {
                try {
                    val text = if (uri.scheme == "http" || uri.scheme == "https") {
                        (URL(uri.toString()).openConnection() as HttpURLConnection).run {
                            connectTimeout = 15000; readTimeout = 20000
                            inputStream.use { s -> TextDecode.decode(s.readBytes().let { if (it.size > 4_000_000) it.copyOf(4_000_000) else it }) }
                        }
                    } else FileUtil.open(this@PlayerActivity, uri).use { TextDecode.decode(it.readBytes()) }
                    if (Playlists.isHls(text)) listOf(MediaEntry(uri, FileUtil.baseName(name), androidx.media3.common.MimeTypes.APPLICATION_M3U8))
                    else Playlists.parse(text, uri)
                } catch (e: Exception) { emptyList() }
            }
            if (entries.isEmpty()) {
                Dialogs.message(this@PlayerActivity, "Lista vazia", "Não foi possível ler itens reproduzíveis nesta lista. Endereços relativos só funcionam em listas baixadas da internet ou abertas de uma pasta do aparelho.")
            } else {
                setPending(entries, 0)
                if (entries.size > 1) toast("${entries.size} itens na lista")
            }
        }
    }

    private fun setPending(entries: List<MediaEntry>, index: Int) {
        pending = entries to index.coerceIn(0, maxOf(0, entries.size - 1))
        player?.let { apply(it) }
    }

    private fun attach(p: ExoPlayer) {
        player = p
        p.addListener(listener)
        playerView.player = p
        apply(p)
        updateTitle()
        loading.visibility = View.GONE
    }

    private fun apply(p: ExoPlayer) {
        val (entries, index) = pending ?: return
        pending = null
        if (entries.isEmpty()) return
        // reabriu pelo aviso de reprodução com a mesma mídia: só reconecta
        if (entries.size == 1 && p.currentMediaItem?.mediaId == entries[0].uri.toString()) return
        val start = resumePosition(entries[index].uri.toString())
        p.setMediaItems(entries.map { it.toItem() }, index, start)
        p.prepare()
        p.play()
        if (start > 0) toast("Continuando de ${fmt(start)}")
    }

    private fun resumePosition(id: String): Long = Prefs.getLong("pos_" + FileUtil.keyFor(Uri.parse(id)), 0)

    private fun savePosition() {
        val p = player ?: return
        val id = p.currentMediaItem?.mediaId ?: return
        val dur = p.duration
        if (dur == C.TIME_UNSET || dur < 90_000 || p.isCurrentMediaItemLive) return
        val pos = p.currentPosition
        Prefs.putLong("pos_" + FileUtil.keyFor(Uri.parse(id)), if (pos in 10_000 until dur - 15_000) pos else 0)
    }

    private fun updateTitle() {
        val p = player ?: return
        val md = p.mediaMetadata
        val title = md.title ?: md.displayTitle ?: p.currentMediaItem?.mediaMetadata?.title ?: FileUtil.baseName(name)
        toolbar.title = title
        val parts = listOfNotNull(md.artist?.toString(), md.albumTitle?.toString(), if (p.mediaItemCount > 1) "${p.currentMediaItemIndex + 1}/${p.mediaItemCount}" else null)
        toolbar.subtitle = parts.joinToString(" · ").ifBlank { null }
    }

    private fun entriesFromPlayer(): MutableList<MediaEntry> {
        val p = player ?: return ArrayList()
        return (0 until p.mediaItemCount).map { i ->
            val it = p.getMediaItemAt(i)
            val sub = it.localConfiguration?.subtitleConfigurations?.firstOrNull()
            MediaEntry(it.localConfiguration?.uri ?: Uri.parse(it.mediaId), it.mediaMetadata.title?.toString(), it.localConfiguration?.mimeType, sub?.uri, sub?.mimeType)
        }.toMutableList()
    }

    private fun addSubtitle(uri: Uri) {
        val p = player ?: return
        Router.persist(this, uri)
        val idx = p.currentMediaItemIndex
        val pos = p.currentPosition
        val list = entriesFromPlayer()
        if (idx !in list.indices) return
        val subName = runCatching { FileUtil.displayName(this, uri) }.getOrDefault(uri.toString())
        list[idx] = list[idx].copy(subtitle = uri, subtitleMime = Playlists.subtitleMime(subName))
        p.replaceMediaItem(idx, list[idx].toItem())
        p.seekTo(idx, pos)
        p.play()
        toast("Legenda adicionada: $subName")
    }

    // ------------------------------------------------------------------ gestos
    private enum class Mode { NONE, SEEK, BRIGHTNESS, VOLUME }
    private var mode = Mode.NONE
    private var seekStart = 0L
    private var seekTarget = 0L
    private var volumeAcc = 0f
    private var brightness = -1f

    private fun setupGestures() {
        val detector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true

            override fun onDoubleTap(e: MotionEvent): Boolean {
                val p = player ?: return false
                val forward = e.x > playerView.width / 2f
                p.seekTo((p.currentPosition + if (forward) 10_000 else -10_000).coerceAtLeast(0))
                flash(if (forward) "10 s ⏩" else "⏪ 10 s")
                return true
            }

            override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
                val start = e1 ?: return false
                val p = player ?: return false
                val h = playerView.height.toFloat().coerceAtLeast(1f)
                val w = playerView.width.toFloat().coerceAtLeast(1f)
                if (mode == Mode.NONE) {
                    // perto das bordas ficam os gestos do sistema e a barra de controle
                    if (start.y < h * 0.08f || start.y > h * 0.88f) return false
                    val tx = abs(e2.x - start.x); val ty = abs(e2.y - start.y)
                    mode = when {
                        tx > ty && tx > 24 && !p.isCurrentMediaItemLive && p.duration != C.TIME_UNSET -> { seekStart = p.currentPosition; Mode.SEEK }
                        ty > 24 -> if (start.x < w / 2) Mode.BRIGHTNESS else Mode.VOLUME
                        else -> return false
                    }
                    volumeAcc = audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat()
                    brightness = window.attributes.screenBrightness.takeIf { it >= 0 }
                        ?: (Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255f)
                }
                when (mode) {
                    Mode.SEEK -> {
                        val span = minOf(p.duration, 600_000L).coerceAtLeast(60_000L)
                        seekTarget = (seekStart + ((e2.x - start.x) / w * span).toLong()).coerceIn(0, p.duration)
                        val delta = (seekTarget - seekStart) / 1000
                        flash("${if (delta >= 0) "+" else "−"}${fmt(abs(delta) * 1000)}  ·  ${fmt(seekTarget)}", 900)
                    }
                    Mode.BRIGHTNESS -> {
                        brightness = (brightness + dy / h * 1.2f).coerceIn(0.01f, 1f)
                        window.attributes = window.attributes.apply { screenBrightness = brightness }
                        flash("☀ ${(brightness * 100).toInt()}%", 900)
                    }
                    Mode.VOLUME -> {
                        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                        volumeAcc = (volumeAcc + dy / h * max * 1.3f).coerceIn(0f, max.toFloat())
                        audio.setStreamVolume(AudioManager.STREAM_MUSIC, volumeAcc.toInt(), 0)
                        flash("🔊 ${(volumeAcc / max * 100).toInt()}%", 900)
                    }
                    Mode.NONE -> {}
                }
                return true
            }
        })
        playerView.setOnTouchListener { _, ev ->
            if (locked) {
                if (ev.actionMasked == MotionEvent.ACTION_UP) { lockButton.visibility = View.VISIBLE; handler.postDelayed({ if (locked) lockButton.visibility = View.GONE }, 2500) }
                return@setOnTouchListener true
            }
            detector.onTouchEvent(ev)
            if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) {
                val was = mode
                if (was == Mode.SEEK) player?.seekTo(seekTarget)
                mode = Mode.NONE
                return@setOnTouchListener was != Mode.NONE
            }
            mode != Mode.NONE
        }
    }

    private fun setLocked(on: Boolean) {
        locked = on
        lockButton.setImageResource(if (on) R.drawable.ic_lock else R.drawable.ic_unlock)
        playerView.useController = !on
        toolbar.visibility = if (on) View.GONE else View.VISIBLE
        lockButton.visibility = View.VISIBLE
        if (on) {
            systemBars(false)
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LOCKED
            flash("Controles bloqueados — toque no cadeado para liberar")
            handler.postDelayed({ if (locked) lockButton.visibility = View.GONE }, 2500)
        } else {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            playerView.showController()
        }
    }

    private fun flash(text: String, ms: Long = 1200) {
        info.text = text
        info.visibility = View.VISIBLE
        handler.removeCallbacks(hideInfo)
        handler.postDelayed(hideInfo, ms)
    }

    private fun systemBars(show: Boolean) {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        if (show) c.show(WindowInsetsCompat.Type.systemBars()) else {
            if (player?.currentTracks?.containsType(C.TRACK_TYPE_VIDEO) != true) return
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    // ------------------------------------------------------------------ menu
    private fun onMenu(id: Int) {
        val p = player
        when (id) {
            R.id.m_queue -> {
                if (p == null || p.mediaItemCount == 0) return
                val titles = (0 until p.mediaItemCount).map { i ->
                    val md = p.getMediaItemAt(i).mediaMetadata
                    (if (i == p.currentMediaItemIndex) "▶ " else "") + (md.title ?: md.displayTitle ?: "Item ${i + 1}") + (md.artist?.let { " · $it" } ?: "")
                }
                Dialogs.choose(this, "Fila (${titles.size})", titles) { i -> p.seekTo(i, 0); p.play() }
            }
            R.id.m_aspect -> {
                val modes = listOf(AspectRatioFrameLayout.RESIZE_MODE_FIT, AspectRatioFrameLayout.RESIZE_MODE_ZOOM, AspectRatioFrameLayout.RESIZE_MODE_FILL,
                    AspectRatioFrameLayout.RESIZE_MODE_FIXED_WIDTH, AspectRatioFrameLayout.RESIZE_MODE_FIXED_HEIGHT)
                Dialogs.single(this, "Ajuste da imagem", listOf("Ajustar à tela", "Preencher (cortar bordas)", "Esticar", "Pela largura", "Pela altura"),
                    modes.indexOf(playerView.resizeMode).coerceAtLeast(0)) { playerView.resizeMode = modes[it] }
            }
            R.id.m_subtitle -> pickSubtitle.launch(arrayOf("*/*"))
            R.id.m_speed -> {
                if (p == null) return
                val speeds = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f)
                Dialogs.single(this, "Velocidade", speeds.map { if (it == 1f) "Normal (1×)" else "${it}×".replace(".", ",") },
                    speeds.indexOf(p.playbackParameters.speed).coerceAtLeast(3)) { p.setPlaybackSpeed(speeds[it]) }
            }
            R.id.m_timer -> {
                val mins = listOf(0, 10, 15, 30, 45, 60, 90, 120)
                val labels = mins.map { if (it == 0) "Desligado" else "$it minutos" } + "No fim da faixa atual"
                val left = if (sleepAt > 0) " (faltam ${((sleepAt - System.currentTimeMillis()) / 60000) + 1} min)" else ""
                Dialogs.choose(this, "Timer para desligar$left", labels) { i ->
                    handler.removeCallbacks(sleepRunnable)
                    p?.pauseAtEndOfMediaItems = false
                    sleepAt = 0
                    when {
                        i == labels.size - 1 -> { p?.pauseAtEndOfMediaItems = true; toast("Vai pausar no fim desta faixa") }
                        mins[i] > 0 -> {
                            sleepAt = System.currentTimeMillis() + mins[i] * 60_000L
                            handler.postDelayed(sleepRunnable, mins[i] * 60_000L)
                            toast("Pausa em ${mins[i]} minutos")
                        }
                    }
                }
            }
            R.id.m_eq -> {
                val eq = service?.equalizer()
                if (eq == null) { toast("Equalizador indisponível neste aparelho"); return }
                val presets = (0 until eq.numberOfPresets).map { eq.getPresetName(it.toShort()) }
                Dialogs.choose(this, "Equalizador", listOf("Desligado") + presets) { i ->
                    try {
                        if (i == 0) eq.enabled = false else { eq.enabled = true; eq.usePreset((i - 1).toShort()) }
                    } catch (e: Throwable) { toast("Não foi possível aplicar") }
                }
            }
            R.id.m_pip -> enterPip()
            R.id.m_bg -> { val v = !Prefs.getBoolean("bg_video", false); Prefs.putBoolean("bg_video", v); toolbar.menu.findItem(R.id.m_bg).isChecked = v }
            R.id.m_rotate -> {
                val v = !Prefs.getBoolean("rotate_video", true); Prefs.putBoolean("rotate_video", v); toolbar.menu.findItem(R.id.m_rotate).isChecked = v
                if (!v) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
            R.id.m_lock -> setLocked(true)
            R.id.m_info -> showInfo()
            R.id.m_share -> {
                val u = p?.currentMediaItem?.localConfiguration?.uri ?: return
                val i = if (u.scheme == "http" || u.scheme == "https" || u.scheme == "rtsp") Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, u.toString())
                else Intent(Intent.ACTION_SEND).setType(contentResolver.getType(u) ?: "*/*").putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivity(Intent.createChooser(i, "Compartilhar"))
            }
            R.id.m_system -> openSystemPlayer()
            R.id.m_other -> p?.currentMediaItem?.localConfiguration?.uri?.let { FileUtil.openWithOtherApp(this, it, contentResolver.getType(it) ?: "video/*") }
        }
    }

    private fun showInfo() {
        val p = player ?: return
        val sb = StringBuilder()
        p.currentMediaItem?.localConfiguration?.uri?.let { sb.append("Origem: ").append(if (it.scheme == "content") FileUtil.displayName(this, it) else it.toString()).append("\n") }
        if (p.duration != C.TIME_UNSET) sb.append("Duração: ").append(fmt(p.duration)).append("\n")
        if (p.isCurrentMediaItemLive) sb.append("Transmissão ao vivo\n")
        p.videoFormat?.let { f ->
            sb.append("\nVídeo: ").append(f.sampleMimeType ?: "?").append(f.codecs?.let { " ($it)" } ?: "").append("\n")
            sb.append("Resolução: ${f.width} × ${f.height}").append(if (f.frameRate > 0) " · ${"%.2f".format(f.frameRate)} qps" else "").append("\n")
            if (f.bitrate > 0) sb.append("Taxa: ${f.bitrate / 1000} kbps\n")
        }
        p.audioFormat?.let { f ->
            sb.append("\nÁudio: ").append(f.sampleMimeType ?: "?").append(f.codecs?.let { " ($it)" } ?: "").append("\n")
            sb.append("${f.channelCount} canais · ${f.sampleRate} Hz").append(if (f.bitrate > 0) " · ${f.bitrate / 1000} kbps" else "").append("\n")
            f.language?.let { sb.append("Idioma: $it\n") }
        }
        val md = p.mediaMetadata
        listOfNotNull(md.artist?.let { "Artista: $it" }, md.albumTitle?.let { "Álbum: $it" }, md.genre?.let { "Gênero: $it" },
            md.recordingYear?.let { "Ano: $it" }).forEach { sb.append(it).append("\n") }
        Dialogs.message(this, "Informações", sb.toString().trim())
    }

    private fun showError(e: PlaybackException) {
        loading.visibility = View.GONE
        val reason = when (e.errorCode) {
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED ->
                "O formato do arquivo não é suportado pelo player interno."
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED, PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES ->
                "Este aparelho não tem decodificador para o codec desta mídia."
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
                "Falha de conexão. Verifique a internet e o endereço."
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "O servidor recusou a transmissão (erro HTTP)."
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "Arquivo não encontrado."
            PlaybackException.ERROR_CODE_IO_NO_PERMISSION -> "Sem permissão para ler o arquivo. Abra-o novamente pelo seletor de arquivos."
            PlaybackException.ERROR_CODE_DRM_UNSPECIFIED, PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED -> "Conteúdo protegido por DRM."
            else -> e.errorCodeName
        }
        val p = player
        val b = MaterialAlertDialogBuilder(this).setTitle("Não foi possível reproduzir").setMessage(reason)
            .setPositiveButton("Player do sistema") { _, _ -> openSystemPlayer() }
            .setNegativeButton("Fechar", null)
        if (p != null && p.hasNextMediaItem()) b.setNeutralButton("Próximo") { _, _ -> p.seekToNextMediaItem(); p.prepare(); p.play() }
        else b.setNeutralButton("Outro app") { _, _ -> p?.currentMediaItem?.localConfiguration?.uri?.let { FileUtil.openWithOtherApp(this, it, "video/*") } }
        if (!isFinishing) b.show()
    }

    private fun openSystemPlayer() {
        val u = player?.currentMediaItem?.localConfiguration?.uri ?: intent.data ?: return
        player?.pause()
        startActivity(Intent(this, SystemPlayerActivity::class.java).setData(u).putExtra(Router.EXTRA_NAME, toolbar.title?.toString()).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    // ------------------------------------------------------------------ picture-in-picture
    private fun isInPip() = Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode

    private fun pipParams(): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < 26) return null
        val vs = player?.videoSize
        val w = (vs?.width ?: 16).coerceAtLeast(1); val h = (vs?.height ?: 9).coerceAtLeast(1)
        val r = (w.toFloat() / h).coerceIn(1 / 2.3f, 2.3f)
        val b = PictureInPictureParams.Builder().setAspectRatio(Rational((r * 1000).toInt(), 1000))
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(player?.isPlaying == true && hasVideo()).setSeamlessResizeEnabled(true)
        return b.build()
    }

    private fun updatePipParams() {
        if (Build.VERSION.SDK_INT >= 26) pipParams()?.let { runCatching { setPictureInPictureParams(it) } }
    }

    private fun hasVideo() = player?.currentTracks?.containsType(C.TRACK_TYPE_VIDEO) == true

    private fun enterPip() {
        if (Build.VERSION.SDK_INT < 26) { toast("Disponível a partir do Android 8"); return }
        if (!packageManager.hasSystemFeature("android.software.picture_in_picture")) { toast("Este aparelho não suporta janela flutuante"); return }
        pipParams()?.let { runCatching { enterPictureInPictureMode(it) } }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT in 26..30 && player?.isPlaying == true && hasVideo() && Prefs.getBoolean("auto_pip", true)) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        playerView.useController = !isInPictureInPictureMode && !locked
        toolbar.visibility = if (isInPictureInPictureMode) View.GONE else View.VISIBLE
        lockButton.visibility = View.GONE
        if (isInPictureInPictureMode) playerView.hideController()
    }

    // ------------------------------------------------------------------ ciclo de vida
    override fun onStop() {
        super.onStop()
        savePosition()
        if (!isInPip() && hasVideo() && !Prefs.getBoolean("bg_video", false)) player?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        savePosition()
        player?.removeListener(listener)
        playerView.player = null
        val idle = player?.let { !it.playWhenReady || it.mediaItemCount == 0 } ?: true
        if (bound) runCatching { unbindService(connection) }
        if (idle) runCatching { stopService(Intent(this, PlaybackService::class.java)) }
    }

    private fun fmt(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s / 60) % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
