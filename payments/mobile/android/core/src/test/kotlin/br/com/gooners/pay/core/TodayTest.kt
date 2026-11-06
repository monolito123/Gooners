package br.com.gooners.pay.core

import br.com.gooners.pay.core.api.DaySummary
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
