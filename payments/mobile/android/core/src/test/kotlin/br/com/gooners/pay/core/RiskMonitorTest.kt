package br.com.gooners.pay.core

import br.com.gooners.pay.core.risk.DeviceModel
import br.com.gooners.pay.core.risk.PostureSource
import br.com.gooners.pay.core.risk.RiskMonitor
import br.com.gooners.pay.core.sandbox.SandboxCardReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RiskMonitorTest {
    private var now = 1_000_000L
    private val monitor = RiskMonitor(clock = { now })

    private fun sale(centavos: Long, typingMillis: Long = 5_000): List<String> {
        monitor.typing()
        now += typingMillis
        return monitor.tapped(Money(centavos)).signals
    }

    @Test fun anOrdinarySaleSendsNothing() {
        val r = monitor.tapped(Money(12_90))
        assertEquals(0, r.milli)
        assertEquals(DeviceModel.NAME, r.model)
        assertEquals(emptyList<String>(), sale(45_00))
    }

    @Test fun interactionSignals() {
        assertTrue("fast_amount_to_tap" in sale(10_00, typingMillis = 300))
        assertTrue("just_under_limit" in sale(199_90))
        sale(50_00); sale(50_00)
        assertTrue("repeated_amount" in sale(50_00))
        repeat(3) { monitor.cancelled() }
        assertTrue("cancelled_taps" in sale(12_00))
        now += RiskMonitor.WINDOW_MILLIS + 1 // old cancellations and taps age out
        assertEquals(emptyList<String>(), sale(12_00))
    }

    @Test fun aNewSaleRestartsTheAmountTimer() {
        monitor.typing() // a sale typed and then paid by Pix: no card read
        now += 60_000
        monitor.cleared()
        monitor.typing()
        now += 300
        assertTrue("fast_amount_to_tap" in monitor.tapped(Money(10_00)).signals)
    }

    @Test fun sessionSignals() {
        repeat(3) { sale(10_00L + it); monitor.result("declined") }
        assertTrue("decline_streak" in sale(20_00))
        monitor.result("approved")
        assertTrue("decline_streak" !in sale(21_00))
        repeat(RiskMonitor.BURST_TAPS - 1) { monitor.typing(); now += 2_000; monitor.tapped(Money(30_00L + it)) }
        assertTrue("tap_burst" in monitor.tapped(Money(99_00)).signals)
    }

    @Test fun postureIsScoredWithTheRest() {
        val m = RiskMonitor(PostureSource { setOf("debugger", "root_indicators") }, clock = { now })
        val r = m.tapped(Money(10_00))
        assertEquals(840, r.milli)
        assertEquals(listOf("debugger", "root_indicators"), r.signals)
    }

    @Test fun eachSandboxReaderHasItsOwnCard() {
        val a = SandboxCardReader(ByteArray(32)).panOf(SandboxCardReader.TestCard.VISA_CREDIT)
        val b = SandboxCardReader(ByteArray(32)).panOf(SandboxCardReader.TestCard.VISA_CREDIT)
        assertNotEquals(a, b)
        for (pan in listOf(a, b)) {
            assertEquals(16, pan.length)
            assertTrue(pan.startsWith("411111") && pan.endsWith("1111") && SandboxCardReader.luhn(pan))
        }
        val elo = SandboxCardReader(ByteArray(32)).panOf(SandboxCardReader.TestCard.ELO)
        assertTrue(elo.startsWith("636297") && elo.endsWith("7013") && SandboxCardReader.luhn(elo))
    }
}
