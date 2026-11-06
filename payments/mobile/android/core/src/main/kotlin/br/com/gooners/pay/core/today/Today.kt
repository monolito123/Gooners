package br.com.gooners.pay.core.today

import java.time.DayOfWeek
import java.time.LocalDate
import java.util.Locale

/**
 * The words and figures of the "Hoje" card (docs/06 §6), the same in both apps and the web
 * console: how customers paid, each payment's state as a word (the colour only repeats it),
 * the mix in whole percent, and the change against the same weekday last week. The iOS kit
 * has the same functions (Today.swift); the tests hold both to the same cases.
 */
object Today {
    /** How a state reads: the tone picks the chip's colour role. */
    enum class Tone { POSITIVE, ATTENTION, ALERT, INFO, NEUTRAL }

    private val methods = mapOf("credit" to "Crédito", "debit" to "Débito", "prepaid" to "Pré-pago", "card" to "Cartão", "pix" to "Pix", "crypto" to "Cripto")

    /** A payment method in the merchant's words; an unknown one reads as its code. */
    fun method(code: String): String = methods[code] ?: code.replace('_', ' ')

    /** The chart colour family of a method: credit, debit, pix, crypto, or other. */
    fun chart(code: String): String = if (code in setOf("credit", "debit", "pix", "crypto")) code else "other"

    private val statuses = mapOf(
        "captured" to ("Paga" to Tone.POSITIVE), "partially_refunded" to ("Estorno parcial" to Tone.ATTENTION),
        "refunded" to ("Estornada" to Tone.INFO), "requires_payment_method" to ("Aguardando" to Tone.ATTENTION),
        "requires_action" to ("Aguardando" to Tone.ATTENTION), "processing" to ("Aguardando" to Tone.ATTENTION),
        "failed" to ("Recusada" to Tone.ALERT), "canceled" to ("Cancelada" to Tone.NEUTRAL),
    )

    /** A payment's state as a word and a tone. */
    fun status(code: String): Pair<String, Tone> = statuses[code] ?: (code.replace('_', ' ') to Tone.NEUTRAL)

    /**
     * Each part's share in whole percent, adding up to exactly 100 (largest remainder), in
     * the order given. All zeros stay zeros.
     */
    fun shares(parts: List<Long>): List<Int> {
        val total = parts.sum()
        if (total <= 0) return parts.map { 0 }
        val exact = parts.map { it * 100.0 / total }
        val out = exact.map { it.toInt() }.toMutableList()
        val left = 100 - out.sum()
        exact.indices.sortedWith(compareByDescending<Int> { exact[it] - out[it] }.thenBy { it }).take(left).forEach { out[it]++ }
        return out
    }

    /** "+50%", "−12,5%" (a true minus sign), "0%"; null when there is nothing to compare with. */
    fun change(pct: Double?): String? {
        pct ?: return null
        val abs = Math.abs(pct)
        val n = if (abs == Math.floor(abs)) abs.toLong().toString() else String.format(Locale.ROOT, "%.1f", abs).replace('.', ',')
        return when {
            pct > 0 -> "+$n%"
            pct < 0 -> "−$n%"
            else -> "0%"
        }
    }

    private val weekdays = mapOf(
        DayOfWeek.MONDAY to "segunda passada", DayOfWeek.TUESDAY to "terça passada", DayOfWeek.WEDNESDAY to "quarta passada",
        DayOfWeek.THURSDAY to "quinta passada", DayOfWeek.FRIDAY to "sexta passada", DayOfWeek.SATURDAY to "sábado passado",
        DayOfWeek.SUNDAY to "domingo passado",
    )

    /** "vs. sexta passada até agora" for today; "vs. domingo passado" for a past day. */
    fun versus(lastWeekDate: String, today: Boolean): String {
        val day = runCatching { LocalDate.parse(lastWeekDate.take(10)) }.getOrNull() ?: return "vs. semana passada"
        return "vs. ${weekdays.getValue(day.dayOfWeek)}" + if (today) " até agora" else ""
    }

    /** The hour that sold the most, or null on a day with no sales. */
    fun peakHour(hourly: List<Long>): Int? {
        val max = hourly.maxOrNull() ?: return null
        return if (max <= 0) null else hourly.indexOf(max)
    }
}
