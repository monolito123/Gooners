package br.com.gooners.pay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
