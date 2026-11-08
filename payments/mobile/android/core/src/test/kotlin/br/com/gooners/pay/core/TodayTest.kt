package br.com.gooners.pay.core

import br.com.gooners.pay.core.api.DaySummary
import br.com.gooners.pay.core.api.PeriodSummary
import br.com.gooners.pay.core.today.Today
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The "Hoje" card's words and figures; TodayTests.swift holds the iOS kit to the same cases. */
class TodayTest {
    @Test fun sharesAddUpToAHundred() {
        assertEquals(listOf(83, 17), Today.shares(listOf(10_000, 2_000)))
        assertEquals(listOf(34, 33, 33), Today.shares(listOf(1, 1, 1)))
        assertEquals(listOf(100), Today.shares(listOf(5)))
        assertEquals(listOf(0, 0), Today.shares(listOf(0, 0)))
        assertEquals(emptyList<Int>(), Today.shares(emptyList()))
        assertEquals(100, Today.shares(listOf(7, 13, 29, 51, 3)).sum())
    }

    @Test fun changeAgainstLastWeek() {
        assertEquals("+50%", Today.change(50.0))
        assertEquals("−12,5%", Today.change(-12.5))
        assertEquals("0%", Today.change(0.0))
        assertNull(Today.change(null))
        assertEquals("vs. sexta passada até agora", Today.versus("2026-10-30", today = true))
        assertEquals("vs. domingo passado", Today.versus("2026-11-01", today = false))
        assertEquals("vs. sábado passado", Today.versus("2026-10-31", today = false))
    }

    @Test fun methodsAndStates() {
        assertEquals("Crédito", Today.method("credit"))
        assertEquals("boleto bancario", Today.method("boleto_bancario"))
        assertEquals("other", Today.chart("card"))
        assertEquals("pix", Today.chart("pix"))
        assertEquals("Paga" to Today.Tone.POSITIVE, Today.status("captured"))
        assertEquals("Aguardando" to Today.Tone.ATTENTION, Today.status("requires_action"))
        assertEquals("Recusada" to Today.Tone.ALERT, Today.status("failed"))
        assertEquals("on hold" to Today.Tone.NEUTRAL, Today.status("on_hold"))
    }

    @Test fun peakHour() {
        assertNull(Today.peakHour(List(24) { 0L }))
        assertNull(Today.peakHour(emptyList()))
        assertEquals(9, Today.peakHour(List(24) { if (it == 9) 500L else if (it == 14) 200L else 0L }))
    }

    @Test fun chartAxes() {
        val compact = mapOf(0L to "R$ 0", 90_000L to "R$ 900", 99_950L to "R$ 1 mil", 149_999L to "R$ 1,5 mil", 250_000L to "R$ 2,5 mil",
            1_000_000L to "R$ 10 mil", 1_234_000L to "R$ 12 mil", 99_999_999L to "R$ 1 mi", 125_000_000L to "R$ 1,3 mi", 1_500_000_000L to "R$ 15 mi")
        compact.forEach { (c, want) -> assertEquals("$c", want, Today.compact(c)) }
        assertEquals(listOf(0L, 10_000L), Today.ticks(0))
        assertEquals(listOf(0L, 100L), Today.ticks(50))
        assertEquals(listOf(0L, 5_000L, 10_000L, 15_000L), Today.ticks(12_000))
        assertEquals(listOf(0L, 500_000L, 1_000_000L), Today.ticks(1_000_000))
        assertEquals(listOf(0L, 500_000L, 1_000_000L, 1_500_000L), Today.ticks(1_200_000))
        assertEquals(listOf(0, 6, 12, 18, 23), Today.axis(24))
        assertEquals((0..6).toList(), Today.axis(7))
        assertEquals(listOf(0, 6, 12, 18, 24, 29), Today.axis(30))
    }

    private fun example(section: String): String {
        val doc = java.io.File(System.getProperty("api.reference")).readText()
        return doc.substringAfter("### $section").substringAfter("```json").substringBefore("```")
    }

    @Test fun salesViews() {
        val json = Json { ignoreUnknownKeys = true }
        val day = Today.dayView(json.decodeFromString(DaySummary.serializer(), example("8.5")), today = true)
        assertEquals("Hoje", day.title)
        assertEquals("+50%", day.change)
        assertEquals("sexta passada", day.compareName)
        assertEquals(24, day.compare.size)
        assertEquals(listOf(0L, 5_000L, 10_000L), day.ticks)
        assertEquals("11h", day.labels[11])
        assertEquals("23h às 0h", day.spoken[23])
        assertEquals(listOf(0, 6, 12, 18, 23), day.axis)

        val period = Today.periodView(json.decodeFromString(PeriodSummary.serializer(), example("8.6")), java.time.LocalDate.parse("2026-11-06"))
        assertEquals("Últimos 7 dias", period.title)
        assertEquals("31/10 a 06/11", period.range)
        assertEquals("+12,4%", period.change)
        assertEquals("vs. os 7 dias anteriores até agora", period.versus)
        assertEquals("sábado, 31/10", period.spoken[0])
        assertEquals(listOf("credit", "debit", "pix"), period.byMethod.map { it.method })
        assertEquals(100, period.shares.sum())
        assertEquals(listOf(0L, 50_000L, 100_000L, 150_000L), period.ticks)
        assertEquals((0..6).toList(), period.axis)
        assertEquals(7, period.compare.size)
    }

    @Test fun decodesTheApiExample() {
        // The example of docs/02 §8.5, as the platform sends it.
        val doc = java.io.File(System.getProperty("api.reference")).readText()
        val example = doc.substringAfter("### 8.5").substringAfter("```json").substringBefore("```")
        val s = Json { ignoreUnknownKeys = true }.decodeFromString(DaySummary.serializer(), example)
        assertEquals(s.gross, s.byMethod.sumOf { it.gross })
        assertEquals(24, s.hourly.size)
        assertEquals(s.gross, s.hourly.sum())
        assertEquals(s.gross - s.fees - s.refunded, s.net)
    }
}
