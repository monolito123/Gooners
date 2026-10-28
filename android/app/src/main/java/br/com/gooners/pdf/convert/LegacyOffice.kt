package br.com.gooners.pdf.convert

/**
 * Formatos binários antigos (.doc/.xls/.ppt 97-2003): extrai o texto legível do arquivo.
 * Não preserva layout, mas permite ler o conteúdo sem outro aplicativo.
 */
object LegacyOffice {
    fun extractText(b: ByteArray): String {
        val utf16 = StringBuilder()
        val ansi = StringBuilder()
        // trechos UTF-16LE
        run {
            val cur = StringBuilder()
            var i = 0
            while (i + 1 < b.size) {
                val ch = ((b[i + 1].toInt() and 0xFF) shl 8 or (b[i].toInt() and 0xFF)).toChar()
                if (ok(ch)) cur.append(ch) else { flush(cur, utf16, 6); }
                i += 2
            }
            flush(cur, utf16, 6)
        }
        // trechos de 8 bits (Windows-1252)
        run {
            val cp = charset("windows-1252")
            val cur = StringBuilder()
            for (x in b) {
                val ch = String(byteArrayOf(x), cp)[0]
                if (ok(ch)) cur.append(ch) else flush(cur, ansi, 10)
            }
            flush(cur, ansi, 10)
        }
        val best = if (letters(utf16) >= letters(ansi) * 0.6) utf16 else ansi
        return best.toString().replace(Regex("\\n{3,}"), "\n\n").trim()
    }

    private fun ok(ch: Char) = ch == '\r' || ch == '\n' || ch == '\t' || (ch >= ' ' && ch.code < 0xD800 && ch != '�' && (ch.isLetterOrDigit() || ch.isWhitespace() || ch in ".,;:!?()[]{}'\"-–—/\\@#$%&*+=<>«»ºª°§|_~^`´"))

    private fun letters(s: CharSequence) = s.count { it.isLetter() }

    private fun flush(cur: StringBuilder, out: StringBuilder, min: Int) {
        val s = cur.toString().trim()
        if (s.length >= min && s.count { it.isLetter() } > s.length * 0.55) {
            out.append(s.replace('\r', '\n')).append('\n')
        }
        cur.setLength(0)
    }

    fun toHtml(b: ByteArray): String {
        val text = extractText(b)
        val sb = StringBuilder("<div class=\"note\">Visualização simplificada de arquivo no formato antigo (97-2003): só o texto é exibido.</div>")
        text.split(Regex("\\n+")).forEach { if (it.isNotBlank()) sb.append("<p>").append(X.esc(it)).append("</p>") }
        return sb.toString()
    }
}
