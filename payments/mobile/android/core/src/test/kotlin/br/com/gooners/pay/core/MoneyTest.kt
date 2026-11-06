package br.com.gooners.pay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MoneyTest {
    @Test
    fun parsesWhatPeopleType() {
        mapOf("150" to 15000L, "150,5" to 15050L, "150,05" to 15005L, " 0,99 " to 99L, "1.234,56" to 123456L, "1.234.567" to 123456700L)
            .forEach { (s, want) -> assertEquals(s, want, Money.parseReais(s)?.centavos) }
        listOf("", ",50", "1,234", "12.34", "1.23,00", "abc", "-5", "1,2,3", "12345678901").forEach { assertNull(it, Money.parseReais(it)) }
    }

    @Test
    fun keypadEntry() {
        var m = Money.zero()
        listOf(1, 2, 9, 9, 0).forEach { m = m.typed(it) }
        assertEquals(12990L, m.centavos)
        assertEquals(1299L, m.backspace().centavos)
    }

    /** Spoken amounts (docs/06 §4); the iOS kit is held to the same table. */
    @Test
    fun spokenAmounts() {
        mapOf(
            12990L to "cento e vinte e nove reais e noventa centavos", 100L to "um real", 1L to "um centavo", 0L to "zero real",
            10000L to "cem reais", 10100L to "cento e um reais", 99L to "noventa e nove centavos", 2000L to "vinte reais",
            100000L to "mil reais", 110000L to "mil e cem reais", 102000L to "mil e vinte reais", 123456L to "mil duzentos e trinta e quatro reais e cinquenta e seis centavos",
            200000000L to "dois milhões de reais", 100000000L to "um milhão de reais", 250000000L to "dois milhões e quinhentos mil reais",
            99999999L to "novecentos e noventa e nove mil novecentos e noventa e nove reais e noventa e nove centavos", 1400L to "catorze reais",
            -500L to "menos cinco reais",
        ).forEach { (c, want) -> assertEquals(want, Money(c).spoken()) }
    }

    @Test
    fun wording() {
        val today = java.time.LocalDate.of(2026, 10, 31)
        val w = br.com.gooners.pay.core.wording.Wording
        assertEquals("hoje", w.day(today, today))
        assertEquals("amanhã", w.day("2026-11-01", today))
        assertEquals("ontem", w.day("2026-10-30", today))
        assertEquals("28/11", w.day("2026-11-28", today))
        assertEquals("04/01/2027", w.day("2027-01-04", today))
        assertEquals("Compra na B3", w.entry("investment_buy"))
        assertEquals("something new", w.entry("something_new"))
        assertTrue(w.calm(422, "insufficient funds: the wallet holds less than 10").startsWith("Saldo insuficiente."))
        assertTrue(w.calm(0, null).contains("Nada foi enviado"))
    }
}

