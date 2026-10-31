package br.com.gooners.pay.core

/**
 * An amount in centavos. Formatting does not depend on the device locale: "R$" and a
 * no-break space, "." between thousands, "," before the centavos (conformance vectors, money).
 */
@JvmInline
value class Money(val centavos: Long) {
    fun format(): String {
        val neg = centavos < 0
        val abs = if (neg) -centavos else centavos
        val reais = (abs / 100).toString()
        val grouped = StringBuilder()
        reais.forEachIndexed { i, c ->
            if (i > 0 && (reais.length - i) % 3 == 0) grouped.append('.')
            grouped.append(c)
        }
        val cents = (abs % 100).toString().padStart(2, '0')
        return (if (neg) "-" else "") + "R$ " + grouped + "," + cents
    }

    /** The keypad: digits shift in from the right, as on a card terminal. */
    fun typed(digit: Int): Money {
        require(digit in 0..9)
        val next = centavos * 10 + digit
        return if (next > MAX_KEYPAD) this else Money(next)
    }

    fun backspace(): Money = Money(centavos / 10)

    val isZero: Boolean get() = centavos == 0L

    /**
     * The amount as words, for screen readers: "cento e vinte e nove reais e noventa centavos"
     * (docs/06 §4). Digits read one by one are easy to mishear at a counter.
     */
    fun spoken(): String {
        if (centavos < 0) return "menos " + Money(-centavos).spoken()
        val reais = centavos / 100
        val cents = centavos % 100
        val r = when {
            reais == 0L -> null
            reais == 1L -> "um real"
            reais % 1_000_000 == 0L -> Words.number(reais) + " de reais"
            else -> Words.number(reais) + " reais"
        }
        val c = when (cents) {
            0L -> null
            1L -> "um centavo"
            else -> Words.number(cents) + " centavos"
        }
        return listOfNotNull(r, c).joinToString(" e ").ifEmpty { "zero real" }
    }

    /** API Pix and BR Code form: "129.90". */
    fun decimal(): String = "${centavos / 100}.${(centavos % 100).toString().padStart(2, '0')}"

    companion object {
        /** The keypad stops at R$ 999.999,99, well under the platform's per-payment limit. */
        const val MAX_KEYPAD = 99_999_999L

        fun zero() = Money(0)

        /** Parses "129.90" (API Pix, BR Code field 54). */
        fun parseDecimal(s: String): Money {
            val m = Regex("""^(\d{1,10})\.(\d{2})$""").matchEntire(s) ?: throw IllegalArgumentException("not a 123.45 amount: $s")
            return Money(m.groupValues[1].toLong() * 100 + m.groupValues[2].toLong())
        }

        /** What a person types: "150", "150,5", "1.234,56". Null when it is not an amount. */
        fun parseReais(s: String): Money? {
            val m = Regex("""^(\d{1,3}(?:\.\d{3})+|\d{1,10})(?:,(\d{1,2}))?$""").matchEntire(s.trim()) ?: return null
            return Money(m.groupValues[1].replace(".", "").toLong() * 100 + m.groupValues[2].padEnd(2, '0').toLong())
        }
    }
}

/** Brazilian Portuguese number words, masculine (reais, centavos). */
internal object Words {
    private val units = listOf("zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
        "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove")
    private val tens = listOf("", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa")
    private val hundreds = listOf("", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos")
    private val scales = listOf("" to "", "mil" to "mil", "milhão" to "milhões", "bilhão" to "bilhões")

    /** 0..999. */
    private fun group(n: Int): String = when {
        n < 20 -> units[n]
        n < 100 -> tens[n / 10] + if (n % 10 != 0) " e " + units[n % 10] else ""
        n == 100 -> "cem"
        else -> hundreds[n / 100] + if (n % 100 != 0) " e " + group(n % 100) else ""
    }

    fun number(n: Long): String {
        require(n in 0..999_999_999_999L)
        if (n == 0L) return "zero"
        val groups = generateSequence(n) { it / 1000 }.takeWhile { it > 0 }.map { (it % 1000).toInt() }.toList() // lowest first
        val parts = groups.withIndex().filter { it.value != 0 }.reversed()
        val out = StringBuilder()
        parts.forEachIndexed { i, (scale, g) ->
            val words = when {
                scale == 1 && g == 1 -> "mil" // "mil", never "um mil"
                scale == 0 -> group(g)
                else -> group(g) + " " + (if (g == 1) scales[scale].first else scales[scale].second)
            }
            if (i > 0) {
                // "mil e cem", "mil e vinte", "dois milhões e quinhentos mil"; else just a space.
                val last = i == parts.size - 1
                out.append(if (last && (g < 100 || g % 100 == 0)) " e " else " ")
            }
            out.append(words)
        }
        return out.toString()
    }
}
