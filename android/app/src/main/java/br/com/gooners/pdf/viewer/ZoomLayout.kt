package br.com.gooners.pdf.viewer

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.widget.FrameLayout

/**
 * Detecta o gesto de pinça em qualquer modo. Durante o gesto aplica só uma escala visual (barata);
 * ao soltar, avisa o leitor para refazer o layout no novo zoom e renderizar com nitidez.
 */
class ZoomLayout @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : FrameLayout(context, attrs) {

    var currentZoom = 1f
    var minZoom = 1f
    var maxZoom = 6f
    var onZoomCommit: ((factor: Float, focusX: Float, focusY: Float) -> Unit)? = null

    private var scaling = false
    private var factor = 1f
    private var fx = 0f
    private var fy = 0f

    private val detector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(d: ScaleGestureDetector): Boolean {
            scaling = true
            factor = 1f
            fx = d.focusX; fy = d.focusY
            val child = getChildAt(0) ?: return false
            child.pivotX = fx; child.pivotY = fy
            return true
        }

        override fun onScale(d: ScaleGestureDetector): Boolean {
            factor = (factor * d.scaleFactor).coerceIn(minZoom / currentZoom, maxZoom / currentZoom)
            getChildAt(0)?.apply { scaleX = factor; scaleY = factor }
            return true
        }

        override fun onScaleEnd(d: ScaleGestureDetector) {
            finish()
        }
    })

    private fun finish() {
        if (!scaling) return
        scaling = false
        getChildAt(0)?.apply { scaleX = 1f; scaleY = 1f }
        if (kotlin.math.abs(factor - 1f) > 0.01f) onZoomCommit?.invoke(factor, fx, fy)
        factor = 1f
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        detector.onTouchEvent(ev)
        return scaling || ev.pointerCount > 1
    }

    override fun onTouchEvent(ev: MotionEvent): Boolean {
        detector.onTouchEvent(ev)
        if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) finish()
        return true
    }
}
