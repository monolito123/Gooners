package br.com.gooners.pdf.edit

import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Anotações em coordenadas da página como ela aparece na tela: pontos PDF (1/72"), origem no canto superior esquerdo.
 * São desenhadas na tela pelo PageView e gravadas no PDF pelo PdfSaver.
 */
sealed class Annot {
    abstract val page: Int
    abstract fun bounds(): RectF
    abstract fun moved(dx: Float, dy: Float): Annot
    open fun resized(r: RectF): Annot = this
    open val resizable: Boolean get() = false
}

enum class ShapeType { RECT, OVAL, LINE, ARROW, HIGHLIGHT, UNDERLINE, STRIKE, WHITEOUT, REDACT }

data class InkAnnot(
    override val page: Int,
    val points: FloatArray,
    val color: Int,
    val width: Float,
    val alpha: Float = 1f
) : Annot() {
    override fun bounds(): RectF {
        var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var r = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
        var i = 0
        while (i < points.size - 1) {
            l = min(l, points[i]); r = max(r, points[i]); t = min(t, points[i + 1]); b = max(b, points[i + 1]); i += 2
        }
        return RectF(l - width, t - width, r + width, b + width)
    }

    override fun moved(dx: Float, dy: Float): Annot {
        val p = points.copyOf()
        var i = 0
        while (i < p.size - 1) { p[i] += dx; p[i + 1] += dy; i += 2 }
        return copy(points = p)
    }

    override fun equals(other: Any?) = this === other
    override fun hashCode() = System.identityHashCode(this)
}

data class ShapeAnnot(
    override val page: Int,
    val type: ShapeType,
    val x1: Float, val y1: Float, val x2: Float, val y2: Float,
    val color: Int,
    val width: Float,
    val fill: Boolean = false
) : Annot() {
    override fun bounds(): RectF {
        val pad = if (type == ShapeType.LINE || type == ShapeType.ARROW) max(width, 6f) else width / 2
        return RectF(min(x1, x2) - pad, min(y1, y2) - pad, max(x1, x2) + pad, max(y1, y2) + pad)
    }

    fun rect() = RectF(min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
    override fun moved(dx: Float, dy: Float) = copy(x1 = x1 + dx, y1 = y1 + dy, x2 = x2 + dx, y2 = y2 + dy)
    override val resizable get() = type != ShapeType.LINE && type != ShapeType.ARROW
    override fun resized(r: RectF) = copy(x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom)
    val isTiny get() = abs(x2 - x1) < 2 && abs(y2 - y1) < 2
}

data class TextAnnot(
    override val page: Int,
    val text: String,
    val x: Float,
    val y: Float,
    val size: Float,
    val color: Int,
    /** largura medida (pt) — atualizada pelo PageView para o teste de toque */
    val measuredWidth: Float = text.lines().maxOfOrNull { it.length }?.times(size * 0.55f) ?: 0f
) : Annot() {
    val lineHeight get() = size * 1.2f
    override fun bounds() = RectF(x, y, x + max(measuredWidth, size), y + lineHeight * text.lines().size)
    override fun moved(dx: Float, dy: Float) = copy(x = x + dx, y = y + dy)
    override val resizable get() = true
    override fun resized(r: RectF): Annot {
        val lines = text.lines().size.coerceAtLeast(1)
        val newSize = (r.height() / lines / 1.2f).coerceIn(4f, 200f)
        return copy(x = r.left, y = r.top, size = newSize, measuredWidth = measuredWidth * newSize / size)
    }
}

data class ImageAnnot(
    override val page: Int,
    val imageKey: String,
    val left: Float, val top: Float, val right: Float, val bottom: Float
) : Annot() {
    override fun bounds() = RectF(left, top, right, bottom)
    override fun moved(dx: Float, dy: Float) = copy(left = left + dx, right = right + dx, top = top + dy, bottom = bottom + dy)
    override val resizable get() = true
    override fun resized(r: RectF): Annot {
        // mantém a proporção da imagem
        val ratio = (bottom - top) / (right - left)
        val w = max(10f, r.width())
        return copy(left = r.left, top = r.top, right = r.left + w, bottom = r.top + w * ratio)
    }
}

/** Histórico simples de desfazer/refazer guardando o estado inteiro (listas pequenas e imutáveis). */
class AnnotHistory {
    var items: List<Annot> = emptyList()
        private set
    private val undoStack = ArrayDeque<List<Annot>>()
    private val redoStack = ArrayDeque<List<Annot>>()

    fun set(newItems: List<Annot>) {
        undoStack.addLast(items)
        if (undoStack.size > 200) undoStack.removeFirst()
        redoStack.clear()
        items = newItems
    }

    fun add(a: Annot) = set(items + a)
    fun remove(a: Annot) = set(items.filter { it !== a })
    fun replace(old: Annot, new: Annot) = set(items.map { if (it === old) new else it })

    fun canUndo() = undoStack.isNotEmpty()
    fun canRedo() = redoStack.isNotEmpty()

    fun undo(): Boolean {
        val prev = undoStack.removeLastOrNull() ?: return false
        redoStack.addLast(items); items = prev; return true
    }

    fun redo(): Boolean {
        val next = redoStack.removeLastOrNull() ?: return false
        undoStack.addLast(items); items = next; return true
    }

    fun clear() { items = emptyList(); undoStack.clear(); redoStack.clear() }
    fun forPage(p: Int) = items.filter { it.page == p }
    val isDirty get() = items.isNotEmpty()
}
