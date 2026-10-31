package br.com.gooners.pay.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** A QR code, always dark on white with a quiet zone so any camera reads it. */
@Composable
fun QrCode(text: String, description: String, modifier: Modifier = Modifier, size: Dp = 260.dp) {
    val bitmap = remember(text) {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2))
        val px = IntArray(m.width * m.height) { if (m[it % m.width, it / m.width]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt() }
        Bitmap.createBitmap(px, m.width, m.height, Bitmap.Config.ARGB_8888).asImageBitmap()
    }
    Image(bitmap, null, filterQuality = FilterQuality.None,
        modifier = modifier.size(size).background(Color.White).padding(4.dp).semantics { contentDescription = description })
}
