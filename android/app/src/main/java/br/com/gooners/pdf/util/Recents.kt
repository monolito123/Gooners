package br.com.gooners.pdf.util

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class RecentFile(
    val uri: String,
    val name: String,
    val kind: DocKind,
    val time: Long,
    val size: Long,
    val favorite: Boolean = false
)

object Recents {
    private const val MAX = 60

    private fun sp(ctx: Context) = ctx.getSharedPreferences("recents", Context.MODE_PRIVATE)

    fun list(ctx: Context): List<RecentFile> {
        val arr = try { JSONArray(sp(ctx).getString("items", "[]")) } catch (_: Exception) { JSONArray() }
        val out = ArrayList<RecentFile>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out += RecentFile(
                o.getString("u"), o.optString("n"),
                runCatching { DocKind.valueOf(o.optString("k")) }.getOrDefault(DocKind.UNKNOWN),
                o.optLong("t"), o.optLong("s", -1), o.optBoolean("f")
            )
        }
        return out
    }

    private fun save(ctx: Context, items: List<RecentFile>) {
        val arr = JSONArray()
        items.take(MAX).forEach {
            arr.put(JSONObject().put("u", it.uri).put("n", it.name).put("k", it.kind.name)
                .put("t", it.time).put("s", it.size).put("f", it.favorite))
        }
        sp(ctx).edit().putString("items", arr.toString()).apply()
    }

    fun add(ctx: Context, uri: String, name: String, kind: DocKind, size: Long) {
        val items = list(ctx).toMutableList()
        val old = items.firstOrNull { it.uri == uri }
        items.removeAll { it.uri == uri }
        items.add(0, RecentFile(uri, name, kind, System.currentTimeMillis(), size, old?.favorite ?: false))
        // Favoritos nunca saem da lista por excesso de itens
        val favs = items.filter { it.favorite }
        val rest = items.filterNot { it.favorite }.take(MAX - favs.size)
        save(ctx, (favs + rest).sortedByDescending { it.time })
    }

    fun remove(ctx: Context, uri: String) = save(ctx, list(ctx).filterNot { it.uri == uri })

    fun toggleFavorite(ctx: Context, uri: String) =
        save(ctx, list(ctx).map { if (it.uri == uri) it.copy(favorite = !it.favorite) else it })

    fun clear(ctx: Context) = save(ctx, list(ctx).filter { it.favorite })
}
