package br.com.gooners.pay.core.today

import br.com.gooners.pay.core.api.DaySummary
import br.com.gooners.pay.core.api.MethodTotal
import br.com.gooners.pay.core.api.PeriodSummary
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

    // ---- charts ----

    /** Methods in a fixed order, so each keeps its place and colour from one day to the next. */
    private val order = listOf("credit", "debit", "prepaid", "card", "pix", "crypto")

    fun ordered(parts: List<MethodTotal>): List<MethodTotal> =
        parts.sortedWith(compareBy<MethodTotal> { order.indexOf(it.method).let { i -> if (i < 0) order.size else i } }.thenBy { it.method })

    /**
     * An axis label: "R$ 900", "R$ 2,5 mil", "R$ 12 mil", "R$ 1,3 mi". Whole numbers from ten
     * up, one decimal below, rounded half up on whole centavos so every platform agrees.
     */
    fun compact(centavos: Long): String {
        val c = maxOf(0L, centavos)
        val reais = (c + 50) / 100
        if (reais < 1_000) return "R$ $reais"
        if (reais < 1_000_000) return "R$ " + tenths((c + 5_000) / 10_000, reais >= 10_000) + " mil"
        return "R$ " + tenths((c + 5_000_000) / 10_000_000, reais >= 10_000_000) + " mi"
    }

    private fun tenths(t: Long, whole: Boolean): String = when {
        whole -> ((t + 5) / 10).toString()
        t % 10 == 0L -> (t / 10).toString()
        else -> "${t / 10},${t % 10}"
    }

    /**
     * The y-axis lines from 0 up to the first clean step at or above max, three steps at most:
     * steps of 1, 2, 2.5 or 5 times a power of ten, in whole reais.
     */
    fun ticks(max: Long): List<Long> {
        if (max <= 0) return listOf(0, 10_000)
        val raw = (max + 2) / 3
        var p = 100L // R$ 1: no step smaller
        while (p * 10 <= raw) p *= 10
        val step = listOf(10L, 20L, 25L, 50L, 100L).map { it * p / 10 }.firstOrNull { it >= raw && it >= 100 } ?: (p * 10)
        val n = (max + step - 1) / step
        return (0..n).map { it * step }
    }

    /** Which buckets get an x-axis label: every one up to 8, else about six, the last always. */
    fun axis(n: Int): List<Int> {
        if (n <= 8) return (0 until n).toList()
        if (n == 24) return listOf(0, 6, 12, 18, 23)
        val step = (n - 1 + 4) / 5
        val out = generateSequence(0) { it + step }.takeWhile { it < n - 1 - step / 2 }.toMutableList()
        out += n - 1
        return out
    }

    private val weekdayNames = mapOf(
        DayOfWeek.MONDAY to "segunda", DayOfWeek.TUESDAY to "terça", DayOfWeek.WEDNESDAY to "quarta", DayOfWeek.THURSDAY to "quinta",
        DayOfWeek.FRIDAY to "sexta", DayOfWeek.SATURDAY to "sábado", DayOfWeek.SUNDAY to "domingo",
    )

    private fun ddMM(iso: String): String = iso.take(10).split('-').let { if (it.size == 3) "${it[2]}/${it[1]}" else iso }

    /** A chart, ready to draw: a day by hour or a period by day, against what it is compared with. */
    data class SalesView(
        val title: String,
        val range: String,
        val gross: Long,
        val net: Long,
        val fees: Long,
        val refunded: Long,
        val sales: Long,
        val averageTicket: Long,
        /** "+50%", or null when there is nothing to compare with. */
        val change: String?,
        val changeSign: Int,
        val versus: String,
        /** The two series, for the legend and the readout. */
        val focusName: String,
        val compareName: String,
        val buckets: List<Long>,
        /** As long as buckets; empty when there is no comparison. */
        val compare: List<Long>,
        /** Short labels ("11h", "05/11") and spoken ones ("11h às 12h", "quarta, 05/11"). */
        val labels: List<String>,
        val spoken: List<String>,
        val axis: List<Int>,
        val ticks: List<Long>,
        val byMethod: List<MethodTotal>,
        val shares: List<Int>,
        val waitingCount: Long,
        val waitingAmount: Long,
        val empty: String,
    )

    /** A day by hour, against the same weekday last week. */
    fun dayView(d: DaySummary, today: Boolean): SalesView {
        val lw = d.lastWeek
        val buckets = d.hourly.ifEmpty { List(24) { 0L } }
        val compare = lw?.hourly?.takeIf { it.size == buckets.size }.orEmpty()
        val parts = ordered(d.byMethod)
        val pct = lw?.changePct
        val versusDay = lw?.let { versus(it.date, today) } ?: "vs. semana passada"
        return SalesView(
            title = if (today) "Hoje" else "Dia",
            range = ddMM(d.date),
            gross = d.gross, net = d.net, fees = d.fees, refunded = d.refunded, sales = d.sales, averageTicket = d.averageTicket,
            change = change(pct), changeSign = sign(pct), versus = versusDay,
            focusName = if (today) "Hoje" else ddMM(d.date),
            compareName = versusDay.removePrefix("vs. ").removeSuffix(" até agora"),
            buckets = buckets, compare = compare,
            labels = buckets.indices.map { "${it}h" },
            spoken = buckets.indices.map { "${it}h às ${(it + 1) % 24}h" },
            axis = axis(buckets.size),
            ticks = ticks(maxOf(buckets.maxOrNull() ?: 0, compare.maxOrNull() ?: 0)),
            byMethod = parts, shares = shares(parts.map { it.gross }),
            waitingCount = d.waiting.count, waitingAmount = d.waiting.amount,
            empty = if (today) "Nenhuma venda ainda hoje. A primeira aparece aqui na hora." else "Nenhuma venda neste dia.",
        )
    }

    /** A period by day, against the period just before. */
    fun periodView(p: PeriodSummary, today: LocalDate): SalesView {
        val endsToday = p.to == today.toString()
        val buckets = p.daily.map { it.gross }
        val compare = p.previous.daily.takeIf { it.size == buckets.size }.orEmpty()
        val parts = ordered(p.byMethod)
        val pct = p.previous.changePct
        return SalesView(
            title = if (endsToday) "Últimos ${p.days} dias" else "${p.days} dias",
            range = "${ddMM(p.from)} a ${ddMM(p.to)}",
            gross = p.gross, net = p.net, fees = p.fees, refunded = p.refunded, sales = p.sales, averageTicket = p.averageTicket,
            change = change(pct), changeSign = sign(pct),
            versus = "vs. os ${p.days} dias anteriores" + if (endsToday) " até agora" else "",
            focusName = "Estes ${p.days} dias",
            compareName = "${p.days} dias anteriores",
            buckets = buckets, compare = compare,
            labels = p.daily.map { ddMM(it.date) },
            spoken = p.daily.map { d ->
                runCatching { weekdayNames.getValue(LocalDate.parse(d.date).dayOfWeek) + ", " + ddMM(d.date) }.getOrDefault(ddMM(d.date))
            },
            axis = axis(buckets.size),
            ticks = ticks(maxOf(buckets.maxOrNull() ?: 0, compare.maxOrNull() ?: 0)),
            byMethod = parts, shares = shares(parts.map { it.gross }),
            waitingCount = 0, waitingAmount = 0,
            empty = "Nenhuma venda nestes ${p.days} dias.",
        )
    }

    private fun sign(pct: Double?): Int = when {
        pct == null || pct == 0.0 -> 0
        pct > 0 -> 1
        else -> -1
    }
}
