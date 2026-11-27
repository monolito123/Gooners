package br.com.gooners.pdf.ui

import android.Manifest
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.text.format.DateUtils
import android.util.LruCache
import android.util.Size
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SearchView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.player.PlayerActivity
import br.com.gooners.pdf.util.DocKind
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Biblioteca do aparelho: documentos, vídeos, músicas, imagens e arquivos compactados (permissões opcionais). */
class DeviceFilesActivity : AppCompatActivity() {
    private class Item(val uri: Uri, val name: String, val size: Long, val modified: Long, val kind: DocKind, val extra: String = "", val id: Long = 0)

    private enum class Tab(val label: String) { DOCS("Documentos"), VIDEO("Vídeos"), MUSIC("Músicas"), IMAGES("Imagens"), ARCHIVES("Compactados") }

    private var tab = Tab.DOCS
    private var all: List<Item> = emptyList()
    private var shown: List<Item> = emptyList()
    private var query = ""
    private lateinit var list: RecyclerView
    private lateinit var empty: TextView
    private lateinit var action: MaterialButton
    private lateinit var toolbar: MaterialToolbar
    private val thumbs = object : LruCache<Long, Bitmap>((Runtime.getRuntime().maxMemory() / 16).toInt()) { override fun sizeOf(k: Long, v: Bitmap) = v.byteCount }

    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { load() }
    private val manageAll = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { load() }

    private val docExt = listOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv", "epub", "fb2", "mobi", "azw3",
        "md", "html", "htm", "xps", "djvu", "cbz", "cbr", "eml", "msg", "vcf", "ics", "json", "xml", "pages", "numbers", "key", "ipynb", "tif", "tiff", "psd")
    private val archiveExt = listOf("zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "apk", "jar", "cab", "deb")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        toolbar = findViewById(R.id.toolbar)
        toolbar.title = "Biblioteca do aparelho"
        toolbar.setNavigationOnClickListener { finish() }
        val search = SearchView(this).apply {
            queryHint = "Buscar pelo nome"
            setOnQueryTextListener(object : SearchView.OnQueryTextListener {
                override fun onQueryTextSubmit(q: String?) = true
                override fun onQueryTextChange(q: String?): Boolean { this@DeviceFilesActivity.query = q.orEmpty(); this@DeviceFilesActivity.filter(); return true }
            })
        }
        toolbar.menu.add("Buscar").setIcon(R.drawable.ic_search).setActionView(search)
            .setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS or android.view.MenuItem.SHOW_AS_ACTION_COLLAPSE_ACTION_VIEW)
        toolbar.menu.add("Tocar todas").setOnMenuItemClickListener { playAll(0); true }
        list = findViewById(R.id.list)
        empty = findViewById(R.id.empty)
        action = findViewById(R.id.action)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = Adapter()
        findViewById<View>(R.id.chipsScroll).visibility = View.VISIBLE
        val chips = findViewById<ChipGroup>(R.id.chips)
        Tab.values().forEach { t ->
            chips.addView(Chip(this).apply {
                text = t.label; isCheckable = true; isChecked = t == tab; id = View.generateViewId()
                setOnClickListener { tab = t; load() }
            })
        }
        intent.getStringExtra("tab")?.let { name -> Tab.values().firstOrNull { it.name == name }?.let { tab = it; (0 until chips.childCount).forEach { i -> (chips.getChildAt(i) as Chip).isChecked = Tab.values()[i] == it } } }
        load()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun allFiles(): Boolean = try {
        if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager() else granted(Manifest.permission.READ_EXTERNAL_STORAGE)
    } catch (e: Exception) { false }

    /** Permissão necessária para a aba atual (null = já concedida). */
    private fun missing(): Array<String>? {
        if (tab == Tab.DOCS || tab == Tab.ARCHIVES) return if (allFiles()) null else arrayOf("manage")
        if (Build.VERSION.SDK_INT >= 33) {
            val p = when (tab) { Tab.VIDEO -> Manifest.permission.READ_MEDIA_VIDEO; Tab.MUSIC -> Manifest.permission.READ_MEDIA_AUDIO; else -> Manifest.permission.READ_MEDIA_IMAGES }
            return if (granted(p) || allFiles()) null else arrayOf(p)
        }
        return if (granted(Manifest.permission.READ_EXTERNAL_STORAGE)) null else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    private fun load() {
        val need = missing()
        all = emptyList(); filter()
        if (need != null) {
            empty.visibility = View.VISIBLE
            empty.text = when (tab) {
                Tab.DOCS, Tab.ARCHIVES -> "Para listar seus documentos e arquivos compactados, o app precisa de acesso aos arquivos do aparelho.\n\nVocê também pode usar \"Abrir\" na tela inicial, que não precisa de permissão."
                Tab.VIDEO -> "Permita o acesso aos vídeos para ver todos os vídeos do aparelho."
                Tab.MUSIC -> "Permita o acesso às músicas e áudios para montar sua biblioteca."
                Tab.IMAGES -> "Permita o acesso às fotos e imagens do aparelho."
            }
            action.visibility = View.VISIBLE
            action.text = "Permitir acesso"
            action.setOnClickListener {
                if (need[0] == "manage") {
                    if (Build.VERSION.SDK_INT >= 30) {
                        try { manageAll.launch(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName"))) }
                        catch (e: Exception) { manageAll.launch(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
                    } else askPerms.launch(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE))
                } else askPerms.launch(need)
            }
            return
        }
        action.visibility = View.GONE
        empty.visibility = View.GONE
        val progress = findViewById<View>(R.id.progress)
        progress.visibility = View.VISIBLE
        val t = tab
        lifecycleScope.launch {
            val items = withContext(Dispatchers.IO) { runCatching { query(t) }.getOrDefault(emptyList()) }
            if (t != tab) return@launch
            all = items
            progress.visibility = View.GONE
            filter()
        }
    }

    private fun query(t: Tab): List<Item> = when (t) {
        Tab.VIDEO -> media(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, DocKind.VIDEO)
        Tab.MUSIC -> media(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, DocKind.AUDIO)
        Tab.IMAGES -> media(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, DocKind.IMAGE)
        Tab.DOCS -> files(docExt)
        Tab.ARCHIVES -> files(archiveExt)
    }

    private fun media(base: Uri, kind: DocKind): List<Item> {
        val cols = arrayListOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED)
        if (kind == DocKind.AUDIO) cols += listOf(MediaStore.Audio.AudioColumns.TITLE, MediaStore.Audio.AudioColumns.ARTIST, MediaStore.Audio.AudioColumns.DURATION)
        if (kind == DocKind.VIDEO) cols += MediaStore.Video.VideoColumns.DURATION
        val out = ArrayList<Item>()
        val order = if (kind == DocKind.AUDIO) "${MediaStore.Audio.AudioColumns.TITLE} COLLATE NOCASE ASC" else "${MediaStore.MediaColumns.DATE_MODIFIED} DESC"
        contentResolver.query(base, cols.toTypedArray(), null, null, order)?.use { c ->
            while (c.moveToNext() && out.size < 20000) {
                val id = c.getLong(0)
                val name = c.getString(1) ?: continue
                val extra = when (kind) {
                    DocKind.AUDIO -> listOfNotNull(c.getString(5)?.takeIf { it != "<unknown>" }, dur(c.getLong(6))).joinToString(" · ")
                    DocKind.VIDEO -> dur(c.getLong(4)) ?: ""
                    else -> ""
                }
                val title = if (kind == DocKind.AUDIO) c.getString(4)?.ifBlank { null } ?: name else name
                out += Item(ContentUris.withAppendedId(base, id), title, c.getLong(2), c.getLong(3) * 1000, kind, extra, id)
            }
        }
        return out
    }

    private fun files(exts: List<String>): List<Item> {
        val base = MediaStore.Files.getContentUri("external")
        val proj = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.SIZE, MediaStore.Files.FileColumns.DATE_MODIFIED)
        val sel = exts.joinToString(" OR ") { "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?" }
        val out = ArrayList<Item>()
        contentResolver.query(base, proj, sel, exts.map { "%.$it" }.toTypedArray(), "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC")?.use { c ->
            while (c.moveToNext() && out.size < 10000) {
                val name = c.getString(1) ?: continue
                val size = c.getLong(2)
                if (size <= 0) continue
                out += Item(ContentUris.withAppendedId(base, c.getLong(0)), name, size, c.getLong(3) * 1000, DocKind.fromName(name))
            }
        }
        return out
    }

    private fun dur(ms: Long): String? {
        if (ms <= 0) return null
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s / 60) % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    private fun filter() {
        val q = query.lowercase()
        shown = if (q.isEmpty()) all else all.filter { it.name.lowercase().contains(q) || it.extra.lowercase().contains(q) }
        toolbar.subtitle = "${shown.size} ${tab.label.lowercase()}"
        toolbar.menu.getItem(1)?.isVisible = tab == Tab.MUSIC || tab == Tab.VIDEO
        if (shown.isEmpty() && missing() == null && all.isEmpty().not()) { empty.visibility = View.VISIBLE; empty.text = "Nada encontrado." }
        else if (missing() == null) empty.visibility = View.GONE
        list.adapter?.notifyDataSetChanged()
    }

    private fun playAll(start: Int) {
        val items = shown.filter { it.kind == DocKind.AUDIO || it.kind == DocKind.VIDEO }
        if (items.isEmpty()) return
        PlayerActivity.playList(this, items.map { it.uri }, items.map { it.name }, start.coerceIn(0, items.size - 1))
    }

    private fun thumbnail(item: Item): Bitmap? {
        thumbs.get(item.id)?.let { return it }
        val b: Bitmap? = try {
            if (Build.VERSION.SDK_INT >= 29) contentResolver.loadThumbnail(item.uri, Size(144, 144), null)
            else @Suppress("DEPRECATION") when (item.kind) {
                DocKind.VIDEO -> MediaStore.Video.Thumbnails.getThumbnail(contentResolver, item.id, MediaStore.Video.Thumbnails.MICRO_KIND, null)
                DocKind.IMAGE -> MediaStore.Images.Thumbnails.getThumbnail(contentResolver, item.id, MediaStore.Images.Thumbnails.MICRO_KIND, null)
                else -> null
            }
        } catch (e: Exception) { null }
        b?.let { thumbs.put(item.id, it) }
        return b
    }

    private inner class Adapter : RecyclerView.Adapter<FileRow>() {
        override fun getItemCount() = shown.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = FileRow(parent)
        override fun onBindViewHolder(h: FileRow, pos: Int) {
            val d = shown[pos]
            val sub = listOf(d.extra, if (d.kind == DocKind.AUDIO) "" else d.kind.label, FileUtil.human(d.size), DateUtils.getRelativeTimeSpanString(d.modified).toString())
                .filter { it.isNotBlank() }.joinToString(" · ")
            h.bind(d.name, sub, d.kind)
            h.icon.tag = d.id
            if (d.kind == DocKind.VIDEO || d.kind == DocKind.IMAGE || (d.kind == DocKind.AUDIO && Build.VERSION.SDK_INT >= 29)) {
                lifecycleScope.launch {
                    val b = withContext(Dispatchers.IO) { thumbnail(d) } ?: return@launch
                    if (h.icon.tag == d.id) { h.icon.imageTintList = null; h.icon.setPadding(0, 0, 0, 0); h.icon.scaleType = android.widget.ImageView.ScaleType.CENTER_CROP; h.icon.setImageBitmap(b) }
                }
            } else { h.icon.scaleType = android.widget.ImageView.ScaleType.FIT_CENTER; val p = (8 * resources.displayMetrics.density).toInt(); h.icon.setPadding(p, p, p, p) }
            h.itemView.setOnClickListener {
                if (d.kind == DocKind.AUDIO) playAll(shown.filter { it.kind == DocKind.AUDIO }.indexOf(d))
                else Router.open(this@DeviceFilesActivity, d.uri, d.name)
            }
        }
    }
}
