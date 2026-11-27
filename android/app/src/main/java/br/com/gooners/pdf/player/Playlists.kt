package br.com.gooners.pdf.player

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import br.com.gooners.pdf.convert.X
import br.com.gooners.pdf.convert.X.attr
import br.com.gooners.pdf.convert.X.local
import br.com.gooners.pdf.util.FileUtil
import java.io.File
import java.net.URL

/** Item da fila de reprodução. */
data class MediaEntry(
    val uri: Uri,
    val title: String? = null,
    val mime: String? = null,
    val subtitle: Uri? = null,
    val subtitleMime: String? = null,
    val group: String? = null
) {
    @OptIn(UnstableApi::class)
    fun toItem(): MediaItem {
        val b = MediaItem.Builder().setUri(uri).setMediaId(uri.toString())
        (mime ?: Playlists.streamMime(uri))?.let { b.setMimeType(it) }
        subtitle?.let { s ->
            b.setSubtitleConfigurations(listOf(
                MediaItem.SubtitleConfiguration.Builder(s).setMimeType(subtitleMime ?: Playlists.subtitleMime(s.toString()))
                    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT).setLanguage("und").setLabel("Legenda externa").build()
            ))
        }
        b.setMediaMetadata(MediaMetadata.Builder().setTitle(title).setDisplayTitle(title).setArtist(group).build())
        return b.build()
    }
}

/** Listas de reprodução: M3U/M3U8 (inclusive listas de IPTV), PLS, XSPF e WPL. */
object Playlists {
    fun isHls(text: String) = text.contains("#EXT-X-TARGETDURATION") || text.contains("#EXT-X-STREAM-INF") ||
        text.contains("#EXT-X-MEDIA-SEQUENCE") || text.contains("#EXT-X-PLAYLIST-TYPE")

    fun streamMime(uri: Uri): String? {
        val path = (uri.lastPathSegment ?: uri.toString()).lowercase().substringBefore('?')
        return when {
            path.endsWith(".m3u8") -> MimeTypes.APPLICATION_M3U8
            path.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
            else -> null
        }
    }

    fun subtitleMime(name: String): String = when (FileUtil.extension(name.substringBefore('?'))) {
        "vtt", "webvtt" -> MimeTypes.TEXT_VTT
        "ass", "ssa" -> MimeTypes.TEXT_SSA
        "ttml", "dfxp", "xml" -> MimeTypes.APPLICATION_TTML
        else -> MimeTypes.APPLICATION_SUBRIP
    }

    fun resolve(base: Uri?, ref: String): Uri? {
        val r = ref.trim()
        if (r.isEmpty()) return null
        if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(r) || r.startsWith("content:") || r.startsWith("file:")) return Uri.parse(r)
        if (r.startsWith("/")) return Uri.fromFile(File(r))
        if (Regex("^[A-Za-z]:\\\\").containsMatchIn(r)) return null // caminho do Windows: não existe no aparelho
        val b = base ?: return null
        return when (b.scheme) {
            "http", "https" -> try { Uri.parse(URL(URL(b.toString()), r).toString()) } catch (e: Exception) { null }
            "file" -> b.path?.let { Uri.fromFile(File(File(it).parentFile, r.replace('\\', '/'))) }
            else -> null
        }
    }

    fun parse(text: String, base: Uri?): List<MediaEntry> {
        val t = text.trimStart('﻿').trim()
        return when {
            t.startsWith("[playlist]", true) -> pls(t, base)
            t.startsWith("<") && t.contains("<trackList", true) -> xspf(t, base)
            t.startsWith("<") && t.contains("<smil", true) -> wpl(t, base)
            else -> m3u(t, base)
        }
    }

    private fun m3u(t: String, base: Uri?): List<MediaEntry> {
        val out = ArrayList<MediaEntry>()
        var title: String? = null
        var group: String? = null
        for (raw in t.lines()) {
            val line = raw.trim()
            when {
                line.isEmpty() -> {}
                line.startsWith("#EXTINF", true) -> {
                    title = line.substringAfter(',', "").trim().ifEmpty { null }
                    group = Regex("group-title=\"([^\"]*)\"").find(line)?.groupValues?.get(1)?.ifEmpty { null }
                }
                line.startsWith("#EXTGRP:", true) -> group = line.substringAfter(':').trim()
                line.startsWith("#") -> {}
                else -> {
                    resolve(base, line)?.let { out += MediaEntry(it, title ?: it.lastPathSegment?.let { s -> Uri.decode(s) }, group = group) }
                    title = null
                }
            }
        }
        return out
    }

    private fun pls(t: String, base: Uri?): List<MediaEntry> {
        val files = HashMap<Int, String>()
        val titles = HashMap<Int, String>()
        for (line in t.lines()) {
            val m = Regex("^(File|Title)(\\d+)=(.*)$", RegexOption.IGNORE_CASE).find(line.trim()) ?: continue
            val n = m.groupValues[2].toInt()
            if (m.groupValues[1].equals("File", true)) files[n] = m.groupValues[3] else titles[n] = m.groupValues[3]
        }
        return files.keys.sorted().mapNotNull { n -> resolve(base, files[n]!!)?.let { MediaEntry(it, titles[n]) } }
    }

    private fun xspf(t: String, base: Uri?): List<MediaEntry> {
        val out = ArrayList<MediaEntry>()
        var loc: String? = null
        var title: String? = null
        var field = ""
        val sb = StringBuilder()
        X.walk(t, { p -> field = p.local(); sb.setLength(0); if (field == "track") { loc = null; title = null } },
            { p ->
                when (p.local()) {
                    "location" -> loc = sb.toString().trim()
                    "title" -> title = sb.toString().trim()
                    "track" -> loc?.let { l -> resolve(base, Uri.decode(l))?.let { out += MediaEntry(it, title) } }
                }
                sb.setLength(0)
            }, { s -> sb.append(s) })
        return out
    }

    private fun wpl(t: String, base: Uri?): List<MediaEntry> {
        val out = ArrayList<MediaEntry>()
        X.walk(t, { p -> if (p.local() == "media") p.attr("src")?.let { s -> resolve(base, s)?.let { out += MediaEntry(it, FileUtil.baseName(it.lastPathSegment ?: "")) } } })
        return out
    }
}
