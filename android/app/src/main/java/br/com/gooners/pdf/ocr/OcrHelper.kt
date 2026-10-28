package br.com.gooners.pdf.ocr

import android.graphics.Bitmap
import android.graphics.Rect
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.TimeUnit

/**
 * OCR com ML Kit pelo Google Play Services: o modelo é baixado pelo sistema, sem aumentar o APK.
 * Chamar fora da thread principal.
 */
object OcrHelper {
    class Line(val text: String, val box: Rect)
    class Result(val text: String, val lines: List<Line>)

    private val client by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    fun recognize(bmp: Bitmap): Result {
        val task = client.process(InputImage.fromBitmap(bmp, 0))
        val res = try {
            Tasks.await(task, 90, TimeUnit.SECONDS)
        } catch (e: Exception) {
            throw IllegalStateException(
                "O reconhecimento de texto precisa do Google Play Services. Se for a primeira vez, aguarde o download do modelo e tente de novo.", e
            )
        }
        val lines = ArrayList<Line>()
        for (block in res.textBlocks) for (line in block.lines) {
            val b = line.boundingBox ?: continue
            lines += Line(line.text, b)
        }
        return Result(res.text, lines)
    }
}
