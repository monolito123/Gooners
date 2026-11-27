package br.com.gooners.pdf.player

import android.app.PendingIntent
import android.content.Intent
import android.media.audiofx.Equalizer
import android.os.Binder
import android.os.IBinder
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Serviço que mantém o player vivo: o áudio continua com a tela desligada ou em outro app,
 * com controles na notificação, na tela de bloqueio e em fones Bluetooth.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    lateinit var player: ExoPlayer
        private set
    private var session: MediaSession? = null
    private var equalizer: Equalizer? = null
    var audioSession = C.AUDIO_SESSION_ID_UNSET
        private set

    inner class LocalBinder : Binder() {
        val service: PlaybackService get() = this@PlaybackService
    }

    override fun onCreate() {
        super.onCreate()
        // decodificadores do aparelho primeiro; FFmpeg entra para áudio que o aparelho não decodifica (AC3, DTS, TrueHD…)
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true)
        val extractors = DefaultExtractorsFactory()
            .setConstantBitrateSeekingEnabled(true)
            .setConstantBitrateSeekingAlwaysEnabled(true)
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ENABLE_HDMV_DTS_AUDIO_STREAMS)
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("GoonersPDF/2.0 (Android) ExoPlayer")
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)
        val sources = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http), extractors)
        player = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(sources)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
        audioSession = Util.generateAudioSessionIdV21(this)
        player.audioSessionId = audioSession
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, PlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        session = MediaSession.Builder(this, player).setSessionActivity(open).build().also { addSession(it) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onBind(intent: Intent?): IBinder? =
        if (intent?.action == ACTION_LOCAL) LocalBinder() else super.onBind(intent)

    /** Equalizador do sistema ligado à sessão de áudio do player. */
    fun equalizer(): Equalizer? {
        if (equalizer == null) equalizer = try { Equalizer(0, audioSession).apply { enabled = true } } catch (e: Throwable) { null }
        return equalizer
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // fechou o app pela lista de recentes sem nada tocando: encerra tudo
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            player.stop()
            stopSelf()
        }
    }

    override fun onDestroy() {
        try { equalizer?.release() } catch (_: Throwable) {}
        session?.let { s ->
            s.player.release()
            s.release()
        }
        session = null
        super.onDestroy()
    }

    companion object {
        const val ACTION_LOCAL = "br.com.gooners.pdf.player.LOCAL"
    }
}
