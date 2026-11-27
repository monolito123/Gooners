package br.com.gooners.pdf.convert

/** RTF -> HTML (texto, parágrafos, negrito, itálico, sublinhado, acentos e Unicode). */
object RtfParser {
    private val skipDest = setOf("fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr",
        "footerl", "footerr", "footnote", "listtable", "listoverridetable", "themedata", "colorschememapping", "datastore", "latentstyles",
        "rsidtbl", "generator", "xmlnstbl", "mmathPr", "fldinst", "filetbl", "revtbl", "pgdsctbl", "bkmkstart", "bkmkend")

    private class State(var b: Boolean = false, var i: Boolean = false, var u: Boolean = false, var skip: Boolean = false, var uc: Int = 1)

    fun toHtml(rtf: String): String {
        val out = StringBuilder("<p>")
        val stack = ArrayList<State>()
        var st = State()
        var open = State()
        var skipChars = 0
        var i = 0
        val n = rtf.length

        fun syncStyle() {
            if (open.u && !st.u) out.append("</u>")
            if (open.i && !st.i) out.append("</i>")
            if (open.b && !st.b) out.append("</b>")
            if (!open.b && st.b) out.append("<b>")
            if (!open.i && st.i) out.append("<i>")
            if (!open.u && st.u) out.append("<u>")
            open = State(st.b, st.i, st.u)
        }

        fun emit(s: String) {
            if (st.skip) return
            if (skipChars > 0) { skipChars--; return }
            syncStyle()
            out.append(s)
        }

        while (i < n) {
            val c = rtf[i]
            when (c) {
                '{' -> { stack += State(st.b, st.i, st.u, st.skip, st.uc); i++ }
                '}' -> { st = stack.removeLastOrNull() ?: State(); i++ }
                '\\' -> {
                    i++
                    if (i >= n) break
                    val d = rtf[i]
                    when {
                        d == '\\' || d == '{' || d == '}' -> { emit(X.esc(d.toString())); i++ }
                        d == '\'' -> {
                            val hex = rtf.substring(i + 1, minOf(i + 3, n))
                            hex.toIntOrNull(16)?.let { emit(X.esc(String(byteArrayOf(it.toByte()), charset("windows-1252")))) }
                            i += 3
                        }
                        d == '*' -> { st.skip = true; i++ }
                        d == '~' -> { emit("&nbsp;"); i++ }
                        d == '-' || d == '_' -> { emit(if (d == '_') "-" else ""); i++ }
                        d == '\n' || d == '\r' -> { emit("</p><p>"); i++ }
                        d.isLetter() -> {
                            val start = i
                            while (i < n && rtf[i].isLetter()) i++
                            val word = rtf.substring(start, i)
                            var num: Int? = null
                            if (i < n && (rtf[i] == '-' || rtf[i].isDigit())) {
                                val ns = i; i++
                                while (i < n && rtf[i].isDigit()) i++
                                num = rtf.substring(ns, i).toIntOrNull()
                            }
                            if (i < n && rtf[i] == ' ') i++
                            when (word) {
                                in skipDest -> st.skip = true
                                "par", "sect" -> emit("</p><p>")
                                "line" -> emit("<br>")
                                "page" -> emit("</p><hr class=\"pb\"><p>")
                                "tab" -> emit("&emsp;")
                                "cell" -> emit(" &nbsp;│&nbsp; ")
                                "row" -> emit("<br>")
                                "b" -> st.b = num != 0
                                "i" -> st.i = num != 0
                                "ul" -> st.u = num != 0
                                "ulnone" -> st.u = false
                                "plain" -> { st.b = false; st.i = false; st.u = false }
                                "uc" -> st.uc = num ?: 1
                                "u" -> num?.let { v -> emit(X.esc(String(Character.toChars(if (v < 0) v + 65536 else v)))); skipChars = st.uc }
                                "emdash" -> emit("—")
                                "endash" -> emit("–")
                                "bullet" -> emit("•")
                                "lquote" -> emit("‘"); "rquote" -> emit("’")
                                "ldblquote" -> emit("“"); "rdblquote" -> emit("”")
                            }
                        }
                        else -> i++
                    }
                }
                '\r', '\n' -> i++
                else -> {
                    if (!st.skip) {
                        if (skipChars > 0) skipChars-- else { syncStyle(); out.append(X.esc(c.toString())) }
                    }
                    i++
                }
            }
        }
        st = State(); syncStyle()
        out.append("</p>")
        return out.toString().replace("<p></p>", "<p>&nbsp;</p>")
    }
}

/** RTF com HTML encapsulado (corpo de e-mails do Outlook): recupera o HTML original ([MS-OXRTFEX]). */
fun RtfParser.deEncapsulateHtml(rtf: String): String? {
    if (!rtf.contains("\\fromhtml")) return null
    class G(var skip: Boolean = false, var tag: Boolean = false, var rtfOnly: Boolean = false) { fun copy() = G(skip, tag, rtfOnly) }
    val skipWords = setOf("fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "listtable", "listoverridetable", "themedata", "generator")
    val out = StringBuilder()
    val stack = ArrayList<G>()
    var g = G()
    var star = false
    var skipNext = 0
    var i = 0
    val n = rtf.length
    fun emit(s: String) {
        if (g.skip || g.rtfOnly) return
        if (skipNext > 0) { skipNext--; return }
        out.append(s)
    }
    while (i < n) {
        val c = rtf[i]
        when (c) {
            '{' -> { stack += g.copy(); i++ }
            '}' -> { g = stack.removeLastOrNull() ?: G(); star = false; i++ }
            '\\' -> {
                i++
                if (i >= n) break
                val d = rtf[i]
                when {
                    d == '\\' || d == '{' || d == '}' -> { emit(d.toString()); i++ }
                    d == '\'' -> {
                        rtf.substring(i + 1, minOf(i + 3, n)).toIntOrNull(16)?.let { emit(String(byteArrayOf(it.toByte()), charset("windows-1252"))) }
                        i += 3
                    }
                    d == '*' -> { star = true; i++ }
                    d == '~' -> { emit(" "); i++ }
                    d.isLetter() -> {
                        val st = i
                        while (i < n && rtf[i].isLetter()) i++
                        val word = rtf.substring(st, i)
                        var num: Int? = null
                        if (i < n && (rtf[i] == '-' || rtf[i].isDigit())) {
                            val ns = i; i++
                            while (i < n && rtf[i].isDigit()) i++
                            num = rtf.substring(ns, i).toIntOrNull()
                        }
                        if (i < n && rtf[i] == ' ') i++
                        when {
                            word == "htmltag" -> { g.tag = true; g.skip = false }
                            word == "htmlrtf" -> g.rtfOnly = num != 0
                            word in skipWords -> g.skip = true
                            star -> g.skip = true
                            word == "par" || word == "line" -> emit("\n")
                            word == "tab" -> emit("\t")
                            word == "u" && num != null -> { emit(String(Character.toChars(if (num < 0) num + 65536 else num))); skipNext = 1 }
                        }
                        star = false
                    }
                    else -> i++
                }
            }
            '\r', '\n' -> i++
            else -> { emit(c.toString()); i++ }
        }
    }
    return out.toString().takeIf { it.contains('<') }
}
