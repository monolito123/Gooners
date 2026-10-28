package br.com.gooners.pdf.organize

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.LruCache
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.edit.PdfBoxUtil
import br.com.gooners.pdf.ui.Dialogs
import br.com.gooners.pdf.ui.SaveHelper
import br.com.gooners.pdf.ui.dp
import br.com.gooners.pdf.util.BitmapUtil
import br.com.gooners.pdf.util.FileUtil
import br.com.gooners.pdf.viewer.PdfCore
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Collections
import java.util.concurrent.Executors

/** Organizar páginas: reordenar, girar, duplicar, excluir, extrair e inserir (em branco, de outro PDF ou imagem). */
class OrganizeActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_FILE = "file"
        const val EXTRA_NAME = "name"
        const val EXTRA_RESULT = "result"
    }

    /** Uma página do resultado: de um PDF de origem, em branco ou imagem. */
    private data class Item(val id: Long, val source: Int, val page: Int, val rotation: Int = 0, val image: Uri? = null)

    private val sources = ArrayList<File>()
    private val cores = HashMap<Int, PdfCore>()
    private val items = ArrayList<Item>()
    private val selected = HashSet<Long>()
    private var nextId = 1L
    private var name = "documento.pdf"
    private var dirty = false
    private val forResult get() = callingActivity != null
    private val thumbs = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 10).toInt()) {
        override fun sizeOf(k: String, v: Bitmap) = v.byteCount
    }
    private val renderer = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private lateinit var grid: RecyclerView
    private lateinit var toolbar: MaterialToolbar
    private val adapter = ThumbAdapter()
    private val saver = SaveHelper(this)

    private val pickPdf = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { insertPdf(it) } }
    private val pickImages = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            val at = insertPosition()
            uris.forEachIndexed { i, u -> items.add(at + i, Item(nextId++, -1, 0, 0, u)) }
            dirty = true; refresh()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_organize)
        val path = intent.getStringExtra(EXTRA_FILE) ?: run { finish(); return }
        name = intent.getStringExtra(EXTRA_NAME) ?: File(path).name
        toolbar = findViewById(R.id.toolbar)
        toolbar.title = "Organizar páginas"
        toolbar.setNavigationOnClickListener { onBack() }
        toolbar.menu.add("Salvar").setIcon(R.drawable.ic_check).setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS)
        toolbar.menu.add("Selecionar tudo")
        toolbar.menu.add("Inverter ordem")
        toolbar.setOnMenuItemClickListener {
            when (it.title) {
                "Salvar" -> save()
                "Selecionar tudo" -> { if (selected.size == items.size) selected.clear() else items.forEach { i -> selected += i.id }; refresh() }
                "Inverter ordem" -> { items.reverse(); dirty = true; refresh() }
            }
            true
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() = onBack() })

        grid = findViewById(R.id.grid)
        val span = (resources.displayMetrics.widthPixels / dp(118)).coerceIn(2, 8)
        grid.layoutManager = GridLayoutManager(this, span)
        grid.adapter = adapter
        ItemTouchHelper(object : ItemTouchHelper.SimpleCallback(ItemTouchHelper.UP or ItemTouchHelper.DOWN or ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT, 0) {
            override fun onMove(rv: RecyclerView, a: RecyclerView.ViewHolder, b: RecyclerView.ViewHolder): Boolean {
                val from = a.bindingAdapterPosition; val to = b.bindingAdapterPosition
                if (from < 0 || to < 0) return false
                Collections.swap(items, from, to)
                adapter.notifyItemMoved(from, to)
                dirty = true
                return true
            }
            override fun onSwiped(vh: RecyclerView.ViewHolder, dir: Int) {}
            override fun clearView(rv: RecyclerView, vh: RecyclerView.ViewHolder) {
                super.clearView(rv, vh); refresh()
            }
        }).attachToRecyclerView(grid)

        setupActions()
        lifecycleScope.launch {
            try {
                addSource(File(path))
                val n = cores[0]!!.pageCount
                for (p in 0 until n) items += Item(nextId++, 0, p)
                refresh()
            } catch (e: Exception) {
                Dialogs.message(this@OrganizeActivity, "Erro", e.message ?: e.toString())
            }
        }
    }

    private suspend fun addSource(f: File): Int {
        val core = withContext(renderer) { PdfCore.open(f) }
        sources += f
        val idx = sources.size - 1
        cores[idx] = core
        return idx
    }

    private fun setupActions() {
        val row = findViewById<LinearLayout>(R.id.actions)
        fun action(label: String, icon: Int, fn: () -> Unit) {
            row.addView(MaterialButton(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
                text = label; setIconResource(icon); iconPadding = dp(4); isAllCaps = false
                setOnClickListener { fn() }
            })
        }
        action("Girar", R.drawable.ic_rotate) { rotateSelected(90) }
        action("Duplicar", R.drawable.ic_copy) { duplicateSelected() }
        action("Excluir", R.drawable.ic_delete) { deleteSelected() }
        action("Extrair", R.drawable.ic_split) { extractSelected() }
        action("Em branco", R.drawable.ic_page_add) { insertBlank() }
        action("Inserir PDF", R.drawable.ic_pdf) { pickPdf.launch(arrayOf("application/pdf")) }
        action("Inserir imagem", R.drawable.ic_image) { pickImages.launch(arrayOf("image/*")) }
    }

    private fun targets(): List<Item> = if (selected.isEmpty()) emptyList() else items.filter { it.id in selected }

    private fun needSelection(): Boolean {
        if (selected.isEmpty()) { Toast.makeText(this, "Toque nas páginas para selecioná-las", Toast.LENGTH_SHORT).show(); return true }
        return false
    }

    private fun rotateSelected(d: Int) {
        if (needSelection()) return
        for (i in items.indices) if (items[i].id in selected) items[i] = items[i].copy(rotation = (items[i].rotation + d) % 360)
        dirty = true; refresh()
    }

    private fun duplicateSelected() {
        if (needSelection()) return
        var i = 0
        while (i < items.size) {
            if (items[i].id in selected) { items.add(i + 1, items[i].copy(id = nextId++)); i++ }
            i++
        }
        dirty = true; refresh()
    }

    private fun deleteSelected() {
        if (needSelection()) return
        if (selected.size >= items.size) { Toast.makeText(this, "O documento precisa ter pelo menos uma página", Toast.LENGTH_SHORT).show(); return }
        items.removeAll { it.id in selected }
        selected.clear(); dirty = true; refresh()
    }

    private fun insertPosition(): Int {
        val last = items.indexOfLast { it.id in selected }
        return if (last >= 0) last + 1 else items.size
    }

    private fun insertBlank() {
        items.add(insertPosition(), Item(nextId++, -2, 0))
        dirty = true; refresh()
    }

    private fun insertPdf(uri: Uri) {
        lifecycleScope.launch {
            try {
                val f = withContext(Dispatchers.IO) { FileUtil.copyToCache(this@OrganizeActivity, uri, "work") }
                val plain = withContext(Dispatchers.IO) {
                    if (PdfBoxUtil.needsPassword(f)) null else f
                } ?: run { Toast.makeText(this@OrganizeActivity, "Remova a senha desse PDF antes de inserir", Toast.LENGTH_LONG).show(); return@launch }
                val idx = addSource(plain)
                val at = insertPosition()
                val n = cores[idx]!!.pageCount
                for (p in 0 until n) items.add(at + p, Item(nextId++, idx, p))
                dirty = true; refresh()
            } catch (e: Exception) {
                Dialogs.message(this@OrganizeActivity, "Erro", e.message ?: e.toString())
            }
        }
    }

    private fun refresh() {
        toolbar.subtitle = "${items.size} páginas" + if (selected.isNotEmpty()) " · ${selected.size} selecionadas" else ""
        adapter.notifyDataSetChanged()
    }

    private fun onBack() {
        if (!dirty) { finish(); return }
        com.google.android.material.dialog.MaterialAlertDialogBuilder(this).setTitle("Descartar alterações?")
            .setMessage("As mudanças na ordem e nas páginas ainda não foram salvas.")
            .setPositiveButton("Salvar") { _, _ -> save() }
            .setNegativeButton("Descartar") { _, _ -> finish() }
            .setNeutralButton("Cancelar", null).show()
    }

    /** Monta o novo PDF com as páginas na ordem atual. */
    private suspend fun build(list: List<Item>, out: File) = withContext(Dispatchers.IO) {
        val docs = HashMap<Int, PDDocument>()
        try {
            PDDocument().use { dst ->
                var lastSize = PDRectangle.A4
                for (it in list) {
                    when {
                        it.source >= 0 -> {
                            val src = docs.getOrPut(it.source) { PdfBoxUtil.load(sources[it.source]).also { d -> if (d.isEncrypted) d.isAllSecurityToBeRemoved = true } }
                            val orig = src.getPage(it.page)
                            // cópia rasa do dicionário: permite duplicar a mesma página com rotações diferentes
                            val copy = PDPage(COSDictionary(orig.cosObject))
                            copy.cosObject.removeItem(COSName.PARENT)
                            copy.mediaBox = orig.mediaBox
                            copy.cropBox = orig.cropBox
                            orig.resources?.let { r -> copy.resources = r }
                            copy.rotation = (orig.rotation + it.rotation) % 360
                            dst.addPage(copy)
                            lastSize = orig.mediaBox
                        }
                        it.source == -2 -> dst.addPage(PDPage(PDRectangle(lastSize.width, lastSize.height)).apply { rotation = it.rotation })
                        it.image != null -> {
                            val bmp = BitmapUtil.decode(this@OrganizeActivity, it.image, 2600) ?: continue
                            val img = JPEGFactory.createFromImage(dst, if (bmp.hasAlpha()) flattenAlpha(bmp) else bmp, 0.88f)
                            val w = lastSize.width; val h = lastSize.height
                            val page = PDPage(PDRectangle(w, h)).apply { rotation = it.rotation }
                            dst.addPage(page)
                            val s = minOf((w - 36) / bmp.width, (h - 36) / bmp.height)
                            val dw = bmp.width * s; val dh = bmp.height * s
                            PDPageContentStream(dst, page).use { cs -> cs.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh) }
                        }
                    }
                }
                dst.save(out)
            }
        } finally {
            docs.values.forEach { runCatching { it.close() } }
        }
    }

    private fun flattenAlpha(b: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(b.width, b.height, Bitmap.Config.ARGB_8888)
        android.graphics.Canvas(out).apply { drawColor(Color.WHITE); drawBitmap(b, 0f, 0f, null) }
        return out
    }

    private fun save() {
        val pd = Dialogs.progress(this, "Salvando páginas…")
        lifecycleScope.launch {
            try {
                val out = FileUtil.newOutFile(this@OrganizeActivity, name)
                build(items.toList(), out)
                pd.dismiss()
                dirty = false
                if (forResult) {
                    setResult(RESULT_OK, Intent().putExtra(EXTRA_RESULT, out.path))
                    finish()
                } else saver.showResult(listOf(out), "PDF reorganizado com ${items.size} páginas.")
            } catch (e: Exception) {
                pd.dismiss(); Dialogs.message(this@OrganizeActivity, "Erro ao salvar", e.message ?: e.toString())
            }
        }
    }

    private fun extractSelected() {
        if (needSelection()) return
        val pd = Dialogs.progress(this, "Extraindo páginas…")
        lifecycleScope.launch {
            try {
                val out = FileUtil.newOutFile(this@OrganizeActivity, FileUtil.baseName(name) + "_paginas.pdf")
                build(targets(), out)
                pd.dismiss()
                saver.showResult(listOf(out), "Novo PDF com ${selected.size} páginas.")
            } catch (e: Exception) {
                pd.dismiss(); Dialogs.message(this@OrganizeActivity, "Erro", e.message ?: e.toString())
            }
        }
    }

    // ------------------------------------------------------------------ miniaturas
    private inner class ThumbAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = items.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val frame = FrameLayout(parent.context).apply {
                layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(160)).apply { setMargins(dp(5), dp(5), dp(5), dp(5)) }
                setPadding(dp(4), dp(4), dp(4), dp(4))
            }
            frame.addView(ImageView(parent.context).apply { scaleType = ImageView.ScaleType.FIT_CENTER }, FrameLayout.LayoutParams(-1, -1).apply { bottomMargin = dp(20) })
            frame.addView(TextView(parent.context).apply { gravity = Gravity.CENTER; textSize = 12f }, FrameLayout.LayoutParams(-1, dp(20), Gravity.BOTTOM))
            frame.addView(ImageView(parent.context).apply { setImageResource(R.drawable.ic_check); setBackgroundResource(R.drawable.bg_chip); setPadding(dp(3), dp(3), dp(3), dp(3)) },
                FrameLayout.LayoutParams(dp(26), dp(26), Gravity.TOP or Gravity.END))
            return object : RecyclerView.ViewHolder(frame) {}
        }

        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            val it = items[pos]
            val frame = h.itemView as FrameLayout
            val iv = frame.getChildAt(0) as ImageView
            val label = frame.getChildAt(1) as TextView
            val check = frame.getChildAt(2)
            val sel = it.id in selected
            frame.setBackgroundResource(if (sel) R.drawable.bg_selected_tool else 0)
            check.visibility = if (sel) View.VISIBLE else View.GONE
            label.text = "${pos + 1}" + when { it.source == -2 -> " · branco"; it.image != null -> " · imagem"; it.source > 0 -> " · inserida"; else -> "" }
            iv.rotation = it.rotation.toFloat()
            iv.setBackgroundColor(Color.WHITE)
            val key = "${it.source}_${it.page}_${it.image}"
            val cached = thumbs.get(key)
            iv.setImageBitmap(cached)
            iv.tag = key
            if (cached == null && it.source != -2) lifecycleScope.launch {
                val bmp = withContext(renderer) {
                    try {
                        if (it.image != null) BitmapUtil.decode(this@OrganizeActivity, it.image, dp(220))
                        else cores[it.source]?.render(it.page, dp(110))
                    } catch (e: Exception) { null }
                } ?: return@launch
                thumbs.put(key, bmp)
                if (iv.tag == key) iv.setImageBitmap(bmp)
            }
            frame.setOnClickListener { _ ->
                if (!selected.remove(it.id)) selected += it.id
                refresh()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cores.values.forEach { it.close() }
        renderer.close()
    }
}
