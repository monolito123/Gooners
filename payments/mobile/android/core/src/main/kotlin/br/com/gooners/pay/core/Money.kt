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
