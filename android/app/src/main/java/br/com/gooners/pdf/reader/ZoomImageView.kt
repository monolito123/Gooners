package br.com.gooners.pdf.reader

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import androidx.appcompat.widget.AppCompatImageView
import kotlin.math.max
import kotlin.math.min

/** Imagem com pinça, duplo toque e arraste; libera o gesto para o paginador quando chega na borda. */
class ZoomImageView(context: Context) : AppCompatImageView(context) {
    private val m = Matrix()
    private var base = 1f
    private var scale = 1f
    var onTap: (() -> Unit)? = null

    init { scaleType = ScaleType.MATRIX }

    private val scaler = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(d: ScaleGestureDetector): Boolean {
            val ns = (scale * d.scaleFactor).coerceIn(1f, 10f)
            val f = ns / scale
            scale = ns
            m.postScale(f, f, d.focusX, d.focusY)
            clamp(); imageMatrix = m
            return true
        }
    })

    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onSingleTapConfirmed(e: MotionEvent): Boolean { onTap?.invoke(); return true }
        override fun onDoubleTap(e: MotionEvent): Boolean {
            if (scale > 1.1f) reset() else {
                val f = 2.8f; scale = f; m.postScale(f, f, e.x, e.y); clamp(); imageMatrix = m
            }
            return true
        }
        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
            if (scale <= 1.01f) return false
            m.postTranslate(-dx, -dy); clamp(); imageMatrix = m
            return true
        }
    })

    override fun setImageDrawable(drawable: Drawable?) {
        super.setImageDrawable(drawable)
        post { reset() }
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        reset()
    }

    fun reset() {
        val d = drawable ?: return
        val dw = d.intrinsicWidth.toFloat(); val dh = d.intrinsicHeight.toFloat()
        if (dw <= 0 || dh <= 0 || width == 0) return
        base = min(width / dw, height / dh)
        scale = 1f
        m.reset()
        m.postScale(base, base)
        m.postTranslate((width - dw * base) / 2, (height - dh * base) / 2)
        imageMatrix = m
    }

    private fun bounds(): RectF {
        val d = drawable ?: return RectF()
        val r = RectF(0f, 0f, d.intrinsicWidth.toFloat(), d.intrinsicHeight.toFloat())
        m.mapRect(r)
        return r
    }

    private fun clamp() {
        val r = bounds()
        var dx = 0f; var dy = 0f
        dx = if (r.width() <= width) (width - r.width()) / 2 - r.left else when {
            r.left > 0 -> -r.left
            r.right < width -> width - r.right
            else -> 0f
        }
        dy = if (r.height() <= height) (height - r.height()) / 2 - r.top else when {
            r.top > 0 -> -r.top
            r.bottom < height -> height - r.bottom
            else -> 0f
        }
        m.postTranslate(dx, dy)
    }

    private var lastX = 0f

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        scaler.onTouchEvent(e)
        gestures.onTouchEvent(e)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { lastX = e.x; parent?.requestDisallowInterceptTouchEvent(scale > 1.01f) }
            MotionEvent.ACTION_POINTER_DOWN -> parent?.requestDisallowInterceptTouchEvent(true)
            MotionEvent.ACTION_MOVE -> if (e.pointerCount == 1 && scale > 1.01f) {
                val r = bounds()
                val dx = e.x - lastX
                val atEdge = (dx > 0 && r.left >= -1f) || (dx < 0 && r.right <= width + 1f)
                parent?.requestDisallowInterceptTouchEvent(!atEdge)
                lastX = e.x
            }
        }
        return true
    }

    override fun canScrollHorizontally(direction: Int): Boolean {
        if (scale <= 1.01f) return false
        val r = bounds()
        return if (direction > 0) r.right > width + 1 else r.left < -1
    }

    fun rotateBy(deg: Float) {
        rotation = (rotation + deg) % 360
        val swap = (rotation / 90).toInt() % 2 != 0
        val s = if (swap && width > 0 && height > 0) min(width.toFloat() / height, height.toFloat() / width) else 1f
        scaleX = s; scaleY = s
        if (max(scaleX, scaleY) == 1f) reset()
    }
}
