package br.com.gooners.pdf.edit

import br.com.gooners.pdf.App
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.font.PDFont
import com.tom_roush.pdfbox.pdmodel.font.PDType0Font
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.util.Matrix
import java.io.File

object PdfBoxUtil {

    /** Abre com uso de memória limitado (arquivos temporários) para aguentar PDFs grandes em aparelhos simples. */
    fun load(file: File, password: String? = null): PDDocument =
        PDDocument.load(file, password ?: "", MemoryUsageSetting.setupMixed(24L * 1024 * 1024).setTempDir(App.instance.cacheDir))

    fun isEncrypted(file: File): Boolean = try {
        PDDocument.load(file, "", MemoryUsageSetting.setupTempFileOnly()).use { it.isEncrypted }
    } catch (e: com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException) {
        true
    }

    fun needsPassword(file: File): Boolean = try {
        PDDocument.load(file, "", MemoryUsageSetting.setupTempFileOnly()).close(); false
    } catch (e: com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException) {
        true
    }

    /** Remove a senha e grava uma cópia aberta (usada para renderizar PDFs protegidos). */
    fun decrypt(src: File, password: String, out: File) {
        load(src, password).use { doc ->
            doc.isAllSecurityToBeRemoved = true
            doc.save(out)
        }
    }

    /** Tenta reparar PDFs corrompidos: o parser do PdfBox é tolerante e regrava a tabela de objetos. */
    fun repair(src: File, out: File) {
        load(src).use { doc ->
            doc.isAllSecurityToBeRemoved = true
            doc.save(out)
        }
    }

    fun encrypt(doc: PDDocument, userPassword: String, ownerPassword: String = userPassword,
                allowPrint: Boolean = true, allowCopy: Boolean = true, allowModify: Boolean = true) {
        val ap = AccessPermission()
        ap.setCanPrint(allowPrint)
        ap.setCanExtractContent(allowCopy)
        ap.setCanModify(allowModify)
        ap.setCanModifyAnnotations(allowModify)
        ap.setCanFillInForm(true)
        val policy = StandardProtectionPolicy(ownerPassword, userPassword, ap)
        policy.encryptionKeyLength = 256
        doc.protect(policy)
    }

    /** Fonte Unicode embutida (acentos, cedilha etc.); cai para Helvetica se algo falhar. */
    fun unicodeFont(doc: PDDocument): PDFont = try {
        App.instance.assets.open("com/tom_roush/pdfbox/resources/ttf/LiberationSans-Regular.ttf").use {
            PDType0Font.load(doc, it, true)
        }
    } catch (e: Exception) {
        PDType1Font.HELVETICA
    }

    /** Troca caracteres que a fonte não tem por '?' para não abortar a gravação. */
    fun safeText(font: PDFont, s: String): String {
        val sb = StringBuilder()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val ch = String(Character.toChars(cp))
            sb.append(
                try { font.encode(ch); ch } catch (e: Exception) { if (cp == '\t'.code) "    " else "?" }
            )
            i += Character.charCount(cp)
        }
        return sb.toString()
    }

    fun textWidth(font: PDFont, s: String, size: Float): Float =
        try { font.getStringWidth(safeText(font, s)) / 1000f * size } catch (e: Exception) { s.length * size * 0.5f }
}

/**
 * Geometria da página como exibida (já girada). Desenhar dentro de [begin] usa coordenadas
 * de tela com Y para cima: (0,0) no canto inferior esquerdo da página visível.
 */
class PageGeo(page: PDPage) {
    private val box = page.cropBox
    val rotation = ((page.rotation % 360) + 360) % 360
    val width: Float = if (rotation == 90 || rotation == 270) box.height else box.width
    val height: Float = if (rotation == 90 || rotation == 270) box.width else box.height

    val matrix: Matrix
        get() {
            val llx = box.lowerLeftX; val lly = box.lowerLeftY; val w = box.width; val h = box.height
            return when (rotation) {
                90 -> Matrix(0f, 1f, -1f, 0f, llx + w, lly)
                180 -> Matrix(-1f, 0f, 0f, -1f, llx + w, lly + h)
                270 -> Matrix(0f, -1f, 1f, 0f, llx, lly + h)
                else -> Matrix(1f, 0f, 0f, 1f, llx, lly)
            }
        }

    fun begin(doc: PDDocument, page: PDPage): PDPageContentStream {
        val cs = PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, true)
        cs.transform(matrix)
        return cs
    }

    /** Converte Y de cima para baixo (tela) em Y de baixo para cima (PDF). */
    fun y(top: Float) = height - top
}
