package br.com.gooners.pdf.edit

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/** Desenha anotações num Canvas já escalado para pontos PDF. */
object AnnotPainter {
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isSubpixelText = true }
    private val bmpPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val path = Path()

    fun measureText(text: String, size: Float): Float {
        textPaint.textSize = size
        return text.lines().maxOfOrNull { textPaint.measureText(it) } ?: 0f
    }

    fun draw(c: Canvas, a: Annot, images: (String) -> Bitmap?) {
        when (a) {
            is InkAnnot -> {
                stroke.color = a.color
                stroke.alpha = (a.alpha * 255).toInt()
                stroke.strokeWidth = a.width
                path.reset()
                val p = a.points
                if (p.size >= 2) {
                    path.moveTo(p[0], p[1])
                    if (p.size == 2) path.lineTo(p[0] + 0.1f, p[1])
                    var i = 2
                    while (i < p.size - 1) {
                        // suaviza o traço com curvas pelos pontos médios
                        val mx = (p[i - 2] + p[i]) / 2; val my = (p[i - 1] + p[i + 1]) / 2
                        path.quadTo(p[i - 2], p[i - 1], mx, my)
                        i += 2
                    }
                    path.lineTo(p[p.size - 2], p[p.size - 1])
                }
                c.drawPath(path, stroke)
            }
            is ShapeAnnot -> drawShape(c, a)
            is TextAnnot -> {
                textPaint.color = a.color
                textPaint.textSize = a.size
                a.text.lines().forEachIndexed { i, line ->
                    c.drawText(line, a.x, a.y + a.size * 0.9f + i * a.lineHeight, textPaint)
                }
            }
            is ImageAnnot -> {
                val b = images(a.imageKey)
                if (b != null && !b.isRecycled) c.drawBitmap(b, null, a.bounds(), bmpPaint)
                else {
                    stroke.color = Color.GRAY; stroke.alpha = 255; stroke.strokeWidth = 1f
                    c.drawRect(a.bounds(), stroke)
                }
            }
        }
    }

    private fun drawShape(c: Canvas, a: ShapeAnnot) {
        val r = a.rect()
        stroke.color = a.color; stroke.alpha = 255; stroke.strokeWidth = a.width
        fill.color = a.color; fill.alpha = 255
        when (a.type) {
            ShapeType.RECT -> if (a.fill) c.drawRect(r, fill) else c.drawRect(r, stroke)
            ShapeType.OVAL -> if (a.fill) c.drawOval(r, fill) else c.drawOval(r, stroke)
            ShapeType.LINE -> c.drawLine(a.x1, a.y1, a.x2, a.y2, stroke)
            ShapeType.ARROW -> {
                c.drawLine(a.x1, a.y1, a.x2, a.y2, stroke)
                val ang = atan2((a.y2 - a.y1).toDouble(), (a.x2 - a.x1).toDouble())
                val len = 6f + a.width * 3f
                for (d in doubleArrayOf(Math.PI * 0.82, -Math.PI * 0.82)) {
                    c.drawLine(a.x2, a.y2, a.x2 + (len * cos(ang + d)).toFloat(), a.y2 + (len * sin(ang + d)).toFloat(), stroke)
                }
            }
            ShapeType.HIGHLIGHT -> { fill.alpha = 100; c.drawRect(r, fill) }
            ShapeType.UNDERLINE -> c.drawLine(r.left, r.bottom, r.right, r.bottom, stroke)
            ShapeType.STRIKE -> c.drawLine(r.left, r.centerY(), r.right, r.centerY(), stroke)
            ShapeType.WHITEOUT -> { fill.color = Color.WHITE; c.drawRect(r, fill) }
            ShapeType.REDACT -> { fill.color = Color.BLACK; c.drawRect(r, fill) }
        }
    }

    fun selection(c: Canvas, r: RectF, scale: Float, resizable: Boolean) {
        stroke.color = 0xFF4F46E5.toInt(); stroke.alpha = 255; stroke.strokeWidth = 1.5f / scale
        c.drawRect(r, stroke)
        if (resizable) {
            fill.color = 0xFF4F46E5.toInt(); fill.alpha = 255
            c.drawCircle(r.right, r.bottom, 7f / scale, fill)
        }
    }
}
