package br.com.gooners.pdf.tools

import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import java.io.File
import java.io.FileOutputStream

/** Envia o PDF para o serviço de impressão do Android (inclui "Salvar como PDF"). */
class PdfPrintAdapter(private val file: File, private val name: String) : PrintDocumentAdapter() {
    override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) {
        if (cancel?.isCanceled == true) { cb.onLayoutCancelled(); return }
        cb.onLayoutFinished(PrintDocumentInfo.Builder(name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
    }

    override fun onWrite(pages: Array<out PageRange>?, dest: ParcelFileDescriptor, cancel: CancellationSignal?, cb: WriteResultCallback) {
        try {
            file.inputStream().use { input -> FileOutputStream(dest.fileDescriptor).use { input.copyTo(it) } }
            cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (e: Exception) {
            cb.onWriteFailed(e.message)
        }
    }
}
