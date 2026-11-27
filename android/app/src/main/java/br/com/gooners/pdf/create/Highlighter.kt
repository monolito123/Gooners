package br.com.gooners.pdf.create

import android.text.Spannable
import android.text.style.ForegroundColorSpan
import br.com.gooners.pdf.util.FileUtil

/** Realce de sintaxe leve (palavras-chave, textos, comentários, números) para as linguagens mais comuns. */
object Highlighter {
    class Theme(val keyword: Int, val string: Int, val comment: Int, val number: Int, val tag: Int)

    val light = Theme(0xFF7C3AED.toInt(), 0xFF15803D.toInt(), 0xFF9CA3AF.toInt(), 0xFFB45309.toInt(), 0xFF2563EB.toInt())
    val dark = Theme(0xFFC4B5FD.toInt(), 0xFF86EFAC.toInt(), 0xFF6B7280.toInt(), 0xFFFCD34D.toInt(), 0xFF93C5FD.toInt())

    private val cLike = setOf("if", "else", "for", "while", "do", "switch", "case", "break", "continue", "return", "class", "struct", "enum", "interface",
        "public", "private", "protected", "static", "final", "const", "new", "this", "super", "null", "true", "false", "void", "int", "long", "float",
        "double", "char", "boolean", "bool", "try", "catch", "finally", "throw", "throws", "import", "package", "extends", "implements", "abstract",
        "fun", "val", "var", "let", "function", "async", "await", "export", "default", "from", "typeof", "instanceof", "in", "of", "is", "as",
        "object", "when", "override", "open", "data", "sealed", "companion", "lateinit", "suspend", "namespace", "using", "template", "typename",
        "go", "func", "defer", "chan", "map", "range", "type", "struct", "impl", "fn", "mut", "pub", "use", "mod", "match", "self", "Self", "trait",
        "where", "yield", "lambda", "nil", "undefined", "string", "number", "any", "readonly", "declare", "module", "require")
    private val python = setOf("def", "class", "if", "elif", "else", "for", "while", "return", "import", "from", "as", "try", "except", "finally",
        "raise", "with", "lambda", "pass", "break", "continue", "in", "is", "not", "and", "or", "None", "True", "False", "yield", "global",
        "nonlocal", "async", "await", "self", "print", "del", "assert")
    private val sql = setOf("select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create", "table", "drop", "alter",
        "join", "left", "right", "inner", "outer", "on", "group", "by", "order", "having", "limit", "and", "or", "not", "null", "as", "distinct",
        "union", "primary", "key", "foreign", "references", "index", "view", "case", "when", "then", "else", "end", "count", "sum", "avg")
    private val shell = setOf("if", "then", "else", "elif", "fi", "for", "do", "done", "while", "case", "esac", "function", "echo", "export",
        "local", "return", "in", "cd", "exit", "set", "unset", "source", "sudo")

    enum class Lang { C, PYTHON, SQL, SHELL, MARKUP, JSON, INI, NONE }

    fun lang(name: String): Lang = when (FileUtil.extension(name)) {
        "kt", "kts", "java", "js", "mjs", "cjs", "ts", "tsx", "jsx", "c", "h", "cc", "cpp", "cxx", "hpp", "cs", "go", "rs", "swift", "dart",
        "scala", "groovy", "gradle", "php", "m", "mm", "sol", "proto", "css", "scss", "less", "vue", "svelte" -> Lang.C
        "py", "pyw", "rb", "r", "jl", "nim" -> Lang.PYTHON
        "sql" -> Lang.SQL
        "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "mk", "makefile", "dockerfile" -> Lang.SHELL
        "xml", "html", "htm", "xhtml", "svg", "plist", "xsd", "xsl", "gpx", "kml", "rss", "atom", "csproj", "md" -> Lang.MARKUP
        "json", "jsonc", "json5", "geojson", "ipynb" -> Lang.JSON
        "ini", "cfg", "conf", "properties", "toml", "yaml", "yml", "env", "reg" -> Lang.INI
        else -> Lang.NONE
    }

    private val number = Regex("\\b(0x[0-9a-fA-F]+|\\d+(\\.\\d+)?([eE][+-]?\\d+)?)\\b")
    private val word = Regex("\\b[A-Za-z_][A-Za-z0-9_]*\\b")
    private val dq = Regex("\"(\\\\.|[^\"\\\\\\n])*\"")
    private val sq = Regex("'(\\\\.|[^'\\\\\\n])*'")
    private val bt = Regex("`(\\\\.|[^`\\\\])*`")

    fun apply(text: Spannable, lang: Lang, theme: Theme, from: Int = 0, to: Int = text.length) {
        if (lang == Lang.NONE) return
        val end = to.coerceAtMost(text.length)
        if (from >= end) return
        text.getSpans(from, end, ForegroundColorSpan::class.java).forEach { text.removeSpan(it) }
        val s = text.subSequence(from, end).toString()
        val colored = BooleanArray(s.length)
        fun paint(r: IntRange, color: Int) {
            if (r.isEmpty() || r.first < 0 || r.last >= s.length) return
            if (colored[r.first]) return
            for (i in r) colored[i] = true
            text.setSpan(ForegroundColorSpan(color), from + r.first, from + r.last + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        val comments = when (lang) {
            Lang.C -> listOf(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), Regex("//[^\\n]*"))
            Lang.PYTHON, Lang.SHELL, Lang.INI -> listOf(Regex("(?m)(^|\\s)[#;][^\\n]*"))
            Lang.SQL -> listOf(Regex("--[^\\n]*"), Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL))
            Lang.MARKUP -> listOf(Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL))
            else -> emptyList()
        }
        comments.forEach { re -> re.findAll(s).forEach { paint(it.range, theme.comment) } }
        listOf(dq, sq, bt).forEach { re -> re.findAll(s).forEach { paint(it.range, theme.string) } }
        when (lang) {
            Lang.MARKUP -> Regex("</?[A-Za-z][\\w:.-]*|/?>").findAll(s).forEach { paint(it.range, theme.tag) }
            Lang.JSON -> Regex("\"(\\\\.|[^\"\\\\])*\"\\s*:").findAll(s).forEach { paint(it.range, theme.tag) }
            Lang.INI -> Regex("(?m)^\\s*[\\w.-]+\\s*(?=[=:])|(?m)^\\s*\\[[^]]+]").findAll(s).forEach { paint(it.range, theme.tag) }
            else -> {
                val kw = when (lang) { Lang.PYTHON -> python; Lang.SQL -> sql; Lang.SHELL -> shell; else -> cLike }
                val ci = lang == Lang.SQL
                word.findAll(s).forEach { m -> if ((if (ci) m.value.lowercase() else m.value) in kw) paint(m.range, theme.keyword) }
            }
        }
        number.findAll(s).forEach { paint(it.range, theme.number) }
    }
}
