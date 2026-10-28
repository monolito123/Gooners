package br.com.gooners.pdf.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import kotlin.math.max

object BitmapUtil {

    fun bounds(ctx: Context, uri: Uri): Pair<Int, Int> {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        FileUtil.open(ctx, uri).use { BitmapFactory.decodeStream(it, null, o) }
        return o.outWidth to o.outHeight
    }

    /** Decodifica reduzindo para no máximo [maxDim] px no maior lado, já corrigindo a rotação EXIF. */
    fun decode(ctx: Context, uri: Uri, maxDim: Int): Bitmap? {
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                val src = ImageDecoder.createSource(ctx.contentResolver, uri)
                return ImageDecoder.decodeBitmap(src) { dec, info, _ ->
                    val w = info.size.width; val h = info.size.height
                    val m = max(w, h)
                    if (m > maxDim) {
                        val s = maxDim.toFloat() / m
                        dec.setTargetSize((w * s).toInt().coerceAtLeast(1), (h * s).toInt().coerceAtLeast(1))
                    }
                    dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    dec.isMutableRequired = false
                }
            } catch (_: Exception) {
                // cai para o BitmapFactory
            }
        }
        val (w, h) = try { bounds(ctx, uri) } catch (_: Exception) { return null }
        if (w <= 0 || h <= 0) return null
        var sample = 1
        while (max(w, h) / (sample * 2) >= maxDim) sample *= 2
        val o = BitmapFactory.Options().apply { inSampleSize = sample }
        var bmp = FileUtil.open(ctx, uri).use { BitmapFactory.decodeStream(it, null, o) } ?: return null
        val m = max(bmp.width, bmp.height)
        if (m > maxDim) {
            val s = maxDim.toFloat() / m
            bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt().coerceAtLeast(1), (bmp.height * s).toInt().coerceAtLeast(1), true)
        }
        return rotateByExif(ctx, uri, bmp)
    }

    private fun rotateByExif(ctx: Context, uri: Uri, bmp: Bitmap): Bitmap {
        val orientation = try {
            FileUtil.open(ctx, uri).use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
        } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            else -> return bmp
        }
        return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    }

    fun rotate(bmp: Bitmap, degrees: Float): Bitmap {
        val m = Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    }
}
