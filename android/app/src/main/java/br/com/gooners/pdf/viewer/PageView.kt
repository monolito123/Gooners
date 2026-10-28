package br.com.gooners.pdf.viewer

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import br.com.gooners.pdf.edit.Annot
import br.com.gooners.pdf.edit.AnnotPainter
import br.com.gooners.pdf.edit.InkAnnot
import br.com.gooners.pdf.edit.ShapeAnnot
import br.com.gooners.pdf.edit.ShapeType
import kotlin.math.abs
import kotlin.math.max

enum class Tool { HAND, SELECT, EDIT_TEXT, PEN, MARKER, HIGHLIGHT, UNDERLINE, STRIKE, TEXT, RECT, OVAL, LINE, ARROW, SIGN, IMAGE, STAMP, WHITEOUT, REDACT, ERASER }

class Detail(val bitmap: Bitmap, val rect: Rect, val pageWidth: Int)

interface PageHost {
    val tool: Tool
    val penColor: Int
    val penWidth: Float
    val highlightColor: Int
    val colorFilter: ColorFilter?
    val selected: Annot?
    fun pageWidthPt(page: Int): Float
    fun aspect(page: Int): Float
    fun base(page: Int): Bitmap?
    fun annotations(page: Int): List<Annot>
    fun image(key: String): Bitmap?
    fun searchRects(page: Int): List<RectF>
    fun currentMatch(page: Int): RectF?
    fun onAdd(a: Annot)
    fun onChange(old: Annot, new: Annot)
    fun onErase(a: Annot)
    fun onSelect(a: Annot?)
    fun onTapForText(page: Int, x: Float, y: Float)
    fun onTapForImage(page: Int, x: Float, y: Float)
    fun onTapEditText(page: Int, x: Float, y: Float)
    fun onSingleTap()
    fun onDoubleTap(view: PageView, x: Float, y: Float)
}

@SuppressLint("ViewConstructor")
class PageView(context: Context, private val host: PageHost) : View(context) {
    var page = -1
        private set
    var detail: Detail? = null
        set(v) {
            if (field !== v) field?.bitmap?.recycle()
            field = v
            invalidate()
        }

    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
    private val hlPaint = Paint().apply { color = 0x66FFC107; style = Paint.Style.FILL }
    private val curPaint = Paint().apply { color = 0x88FF5722.toInt(); style = Paint.Style.FILL }
    private val placeholder = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFBDBDBD.toInt(); textAlign = Paint.Align.CENTER }
    private val density = resources.displayMetrics.density

    // estado do gesto atual
    private var draft: Annot? = null
    private var inkPoints: FloatArray = FloatArray(256)
    private var inkCount = 0
    private var startX = 0f
    private var startY = 0f
    private var dragMode = 0 // 0 nada, 1 desenhar, 2 mover, 3 redimensionar
    private var dragTarget: Annot? = null
    private var multiTouch = false

    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent) = true
        override fun onSingleTapConfirmed(e: MotionEvent): Boolean { host.onSingleTap(); return true }
        override fun onDoubleTap(e: MotionEvent): Boolean { host.onDoubleTap(this@PageView, e.x, e.y); return true }
    })

    fun bind(p: Int) {
        if (p != page) {
            detail = null
            draft = null
        }
        page = p
        invalidate()
    }

    val scale: Float get() = if (page < 0) 1f else width / host.pageWidthPt(page)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val h = if (page < 0) w else (w * host.aspect(page)).toInt()
        setMeasuredDimension(w, h)
    }

    override fun onDraw(c: Canvas) {
        if (page < 0) return
        val base = host.base(page)
        bmpPaint.colorFilter = host.colorFilter
        if (base != null && !base.isRecycled) {
            c.drawBitmap(base, null, Rect(0, 0, width, height), bmpPaint)
        } else {
            c.drawColor(if (host.colorFilter != null) Color.rgb(40, 40, 40) else Color.WHITE)
            placeholder.textSize = 18 * density
            c.drawText("${page + 1}", width / 2f, height / 2f, placeholder)
        }
        detail?.let { d ->
            if (d.pageWidth == width && !d.bitmap.isRecycled) c.drawBitmap(d.bitmap, null, d.rect, bmpPaint)
        }
        val s = scale
        c.save()
        c.scale(s, s)
        for (r in host.searchRects(page)) c.drawRect(r, hlPaint)
        host.currentMatch(page)?.let { c.drawRect(it, curPaint) }
        val moving = if (dragMode >= 2) dragTarget else null
        for (a in host.annotations(page)) {
            if (a === moving) continue
            AnnotPainter.draw(c, a, host::image)
        }
        draft?.let { AnnotPainter.draw(c, it, host::image) }
        val sel = if (dragMode >= 2) draft else host.selected?.takeIf { it.page == page }
        sel?.let { AnnotPainter.selection(c, it.bounds(), s, it.resizable) }
        c.restore()
    }

    private fun hit(x: Float, y: Float): Annot? {
        val slop = 10 * density / scale
        return host.annotations(page).lastOrNull { a ->
            val b = RectF(a.bounds()); b.inset(-slop, -slop); b.contains(x, y)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (page < 0) return false
        val tool = host.tool
        if (tool == Tool.HAND) return gestures.onTouchEvent(e)
        val s = scale
        val x = e.x / s
        val y = e.y / s
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                multiTouch = false
                startX = x; startY = y
                dragMode = 0
                when (tool) {
                    Tool.SELECT -> {
                        val sel = host.selected?.takeIf { it.page == page }
                        val handle = 22 * density / s
                        if (sel != null && sel.resizable && abs(x - sel.bounds().right) < handle && abs(y - sel.bounds().bottom) < handle) {
                            dragMode = 3; dragTarget = sel; draft = sel
                        } else {
                            val h = hit(x, y)
                            if (h == null) {
                                host.onSelect(null)
                                return gestures.onTouchEvent(e)
                            }
                            host.onSelect(h)
                            dragMode = 2; dragTarget = h; draft = h
                        }
                    }
                    Tool.ERASER -> { hit(x, y)?.let { host.onErase(it) } }
                    Tool.PEN, Tool.MARKER -> {
                        dragMode = 1; inkCount = 0; addPoint(x, y); updateInkDraft()
                    }
                    Tool.TEXT, Tool.SIGN, Tool.IMAGE, Tool.STAMP, Tool.EDIT_TEXT -> dragMode = 1
                    else -> { dragMode = 1; draft = shapeFor(tool, x, y, x, y) }
                }
                parent?.requestDisallowInterceptTouchEvent(true)
                return true
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                // dois dedos: cancela o traço e devolve o gesto para zoom/rolagem
                multiTouch = true
                draft = null; dragMode = 0; dragTarget = null
                parent?.requestDisallowInterceptTouchEvent(false)
                invalidate()
                return false
            }
            MotionEvent.ACTION_MOVE -> {
                if (multiTouch) return false
                when {
                    tool == Tool.ERASER -> hit(x, y)?.let { host.onErase(it) }
                    dragMode == 1 && (tool == Tool.PEN || tool == Tool.MARKER) -> {
                        for (h in 0 until e.historySize) addPoint(e.getHistoricalX(h) / s, e.getHistoricalY(h) / s)
                        addPoint(x, y); updateInkDraft()
                    }
                    dragMode == 1 && draft is ShapeAnnot -> {
                        val d = draft as ShapeAnnot
                        draft = d.copy(x2 = x, y2 = if (tool == Tool.UNDERLINE || tool == Tool.STRIKE) max(y, d.y1 + 4f) else y)
                    }
                    dragMode == 2 -> draft = dragTarget?.moved(x - startX, y - startY)
                    dragMode == 3 -> dragTarget?.let { t ->
                        val b = t.bounds()
                        val r = RectF(b.left, b.top, max(b.left + 8f, x), max(b.top + 8f, y))
                        draft = t.resized(r)
                    }
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (multiTouch) { multiTouch = false; return false }
                val moved = abs(x - startX) > 4 / s * density || abs(y - startY) > 4 / s * density
                when {
                    tool == Tool.TEXT -> if (!moved) host.onTapForText(page, x, y)
                    tool == Tool.EDIT_TEXT -> if (!moved) host.onTapEditText(page, x, y)
                    tool == Tool.SIGN || tool == Tool.IMAGE || tool == Tool.STAMP -> if (!moved) host.onTapForImage(page, x, y)
                    dragMode == 1 && (tool == Tool.PEN || tool == Tool.MARKER) -> { addPoint(x, y); updateInkDraft(); draft?.let { host.onAdd(it) } }
                    dragMode == 1 -> (draft as? ShapeAnnot)?.let { d -> if (!d.isTiny) host.onAdd(normalize(d)) }
                    dragMode >= 2 -> {
                        val t = dragTarget; val d = draft
                        if (t != null && d != null && moved) host.onChange(t, d)
                    }
                }
                draft = null; dragMode = 0; dragTarget = null
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                draft = null; dragMode = 0; dragTarget = null; invalidate()
            }
        }
        return true
    }

    private fun normalize(d: ShapeAnnot): ShapeAnnot = when (d.type) {
        ShapeType.LINE, ShapeType.ARROW -> d
        ShapeType.UNDERLINE, ShapeType.STRIKE -> d
        else -> { val r = d.rect(); d.copy(x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom) }
    }

    private fun shapeFor(tool: Tool, x1: Float, y1: Float, x2: Float, y2: Float): ShapeAnnot? {
        val type = when (tool) {
            Tool.RECT -> ShapeType.RECT
            Tool.OVAL -> ShapeType.OVAL
            Tool.LINE -> ShapeType.LINE
            Tool.ARROW -> ShapeType.ARROW
            Tool.HIGHLIGHT -> ShapeType.HIGHLIGHT
            Tool.UNDERLINE -> ShapeType.UNDERLINE
            Tool.STRIKE -> ShapeType.STRIKE
            Tool.WHITEOUT -> ShapeType.WHITEOUT
            Tool.REDACT -> ShapeType.REDACT
            else -> return null
        }
        val color = if (type == ShapeType.HIGHLIGHT) host.highlightColor else host.penColor
        return ShapeAnnot(page, type, x1, y1, x2, y2, color, host.penWidth)
    }

    private fun addPoint(x: Float, y: Float) {
        if (inkCount + 2 > inkPoints.size) inkPoints = inkPoints.copyOf(inkPoints.size * 2)
        inkPoints[inkCount++] = x; inkPoints[inkCount++] = y
    }

    private fun updateInkDraft() {
        val marker = host.tool == Tool.MARKER
        draft = InkAnnot(
            page, inkPoints.copyOf(inkCount),
            if (marker) host.highlightColor else host.penColor,
            if (marker) host.penWidth * 6f else host.penWidth,
            if (marker) 0.4f else 1f
        )
    }

    /** Parte da página visível na tela, em pixels locais. */
    fun visibleRegion(out: Rect): Boolean = getLocalVisibleRect(out) && out.width() > 0 && out.height() > 0
}
