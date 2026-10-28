package br.com.gooners.pdf.viewer

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.Closeable
import java.io.File

/**
 * Renderizador nativo do Android (pdfium) — rápido e sem bibliotecas nativas extras.
 * Todas as chamadas são sincronizadas: o PdfRenderer só permite uma página aberta por vez.
 */
class PdfCore private constructor(val file: File, private val pfd: ParcelFileDescriptor, private val renderer: PdfRenderer) : Closeable {

    val pageCount: Int = renderer.pageCount
    val widths = FloatArray(pageCount)
    val heights = FloatArray(pageCount)
    @Volatile
    private var closed = false

    init {
        for (i in 0 until pageCount) {
            renderer.openPage(i).use { p ->
                widths[i] = p.width.toFloat().coerceAtLeast(1f)
                heights[i] = p.height.toFloat().coerceAtLeast(1f)
            }
        }
    }

    fun aspect(i: Int) = heights[i] / widths[i]

    /** Página inteira com largura [widthPx]. */
    @Synchronized
    fun render(index: Int, widthPx: Int): Bitmap? {
        if (closed || index !in 0 until pageCount) return null
        val w = widthPx.coerceIn(16, 4096)
        val h = (w * aspect(index)).toInt().coerceIn(16, 8192)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.WHITE)
        renderer.openPage(index).use { it.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
        return bmp
    }

    /** Só o trecho [region] (em pixels de uma página com largura [pageWidthPx]) — nitidez total no zoom sem estourar a memória. */
    @Synchronized
    fun renderRegion(index: Int, pageWidthPx: Float, region: Rect): Bitmap? {
        if (closed || index !in 0 until pageCount || region.width() <= 0 || region.height() <= 0) return null
        val bmp = Bitmap.createBitmap(region.width(), region.height(), Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.WHITE)
        val scale = pageWidthPx / widths[index]
        val m = Matrix()
        m.setScale(scale, scale)
        m.postTranslate(-region.left.toFloat(), -region.top.toFloat())
        renderer.openPage(index).use { it.render(bmp, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
        return bmp
    }

    @Synchronized
    fun renderForPrint(index: Int, widthPx: Int): Bitmap? {
        if (closed) return null
        val h = (widthPx * aspect(index)).toInt()
        val bmp = Bitmap.createBitmap(widthPx, h, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.WHITE)
        renderer.openPage(index).use { it.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT) }
        return bmp
    }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        try { renderer.close() } catch (_: Exception) {}
        try { pfd.close() } catch (_: Exception) {}
    }

    companion object {
        /** @throws SecurityException se o PDF exige senha. */
        fun open(file: File): PdfCore {
            val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            try {
                return PdfCore(file, pfd, PdfRenderer(pfd))
            } catch (e: Exception) {
                pfd.close()
                throw e
            }
        }
    }
}
