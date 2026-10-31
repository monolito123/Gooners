package br.com.gooners.pay.core

import br.com.gooners.pay.core.api.GoonersPayApi
import br.com.gooners.pay.core.api.Session
import br.com.gooners.pay.core.checkout.CheckoutController
import br.com.gooners.pay.core.checkout.CheckoutState
import br.com.gooners.pay.core.checkout.CryptoChoice
import br.com.gooners.pay.core.checkout.InMemoryMethods
import br.com.gooners.pay.core.checkout.PayMethod
import br.com.gooners.pay.core.nostr.NostrKeys
import br.com.gooners.pay.core.sandbox.SandboxCardReader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

/** The two-tap checkout of docs/06 §5, against a scripted platform. */
class CheckoutTest {
    private val server = MockWebServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val seen = CopyOnWriteArrayList<String>()
    @Volatile private var cancelFails = false

    @After
    fun stop() {
        scope.cancel()
        server.close()
    }

    private fun intent(status: String, extra: String = "") =
        """{"id":"pi_1","status":"$status","amount":12990,"merchant_id":"mer_1","channel":"crypto"$extra}"""

    private fun platform(): GoonersPayApi.Authed {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val line = "${request.method} ${request.url.encodedPath}"
                seen += line + " " + request.body?.utf8().orEmpty()
                val body = when (line) {
                    "POST /v1/payment-intents" -> intent("requires_payment_method")
                    "POST /v1/payment-intents/pi_1/confirm" -> intent("requires_action",
                        ""","next_action":{"type":"crypto_transfer","asset":"USDT","network":"tron","address":"TQ1","amount":"24.054000","uri":"tron:TQ1?amount=24.054","expires_at":"2026-10-31T12:15:00Z"}""")
                    "GET /v1/payment-intents/pi_1" -> intent("captured", ""","receipt":{"claim_url":"https://r.example/c#k=1"}""")
                    "POST /v1/terminal/authorizations" ->
                        """{"status":"approved","payment_intent_id":"pi_1","card":{"brand":"visa","last4":"1111"},"settlement":{"mode":"instant","net_available":12576}}"""
                    "POST /v1/payment-intents/pi_1/cancel" -> if (cancelFails) return MockResponse.Builder().code(503).body("{}").build() else intent("canceled")
                    else -> return MockResponse.Builder().code(404).body("{}").build()
                }
                return MockResponse.Builder().code(200).body(body).build()
            }
        }
        server.start()
        val api = GoonersPayApi(server.url("/").toString(), OkHttpClient())
        val session = Session("tok", "DPoP", 3600, "mer_1", "dev_1", "T0000001", "acc_1")
        return api.Authed({ NostrKeys.generate() }, SoftwareSigner(), session)
    }

    private fun controller(authed: () -> GoonersPayApi.Authed, memory: InMemoryMethods = InMemoryMethods(), crypto: CryptoChoice? = CryptoChoice()) =
        CheckoutController(authed, { SandboxCardReader(ByteArray(32)) }, { "000001" }, scope, pixPollMillis = 20,
            memory = memory, cryptoOffer = { crypto }, autoReturnMillis = 300)

    @Test
    fun theLastMethodComesFirst() {
        val memory = InMemoryMethods()
        val c = controller({ error("offline") }, memory, crypto = null)
        assertEquals(listOf(PayMethod.CREDIT, PayMethod.DEBIT, PayMethod.PIX), c.methods())
        assertNull((c.state.value as CheckoutState.Entering).repeat)
        listOf(5, 0, 0).forEach(c::digit)
        c.charge()
        c.choose(PayMethod.PIX)
        assertEquals(PayMethod.PIX, memory.last)
        c.nextSale()
        assertEquals(CheckoutState.Entering(Money.zero(), PayMethod.PIX), c.state.value)
        assertEquals(listOf(PayMethod.PIX, PayMethod.CREDIT, PayMethod.DEBIT), c.methods())
        // Crypto appears only where the merchant takes it, and a remembered method that went away is dropped.
        memory.last = PayMethod.CRYPTO
        assertEquals(listOf(PayMethod.CREDIT, PayMethod.DEBIT, PayMethod.PIX), c.methods())
        assertEquals(listOf(PayMethod.CRYPTO, PayMethod.CREDIT, PayMethod.DEBIT, PayMethod.PIX), controller({ error("offline") }, memory).methods())
        // Quick amounts replace what was typed.
        c.nextSale()
        c.set(Money(5_000))
        assertEquals(Money(5_000), (c.state.value as CheckoutState.Entering).amount)
    }

    @Test
    fun aCryptoSaleReturnsToTheKeypadAndCanBeCancelled() = runBlocking {
        val authed = platform()
        val c = controller({ authed })
        listOf(1, 2, 9, 9, 0).forEach(c::digit)
        c.charge()
        assertEquals(PayMethod.CRYPTO, (c.state.value as CheckoutState.ChoosingMethod).methods.last())
        c.choose(PayMethod.CRYPTO)
        val qr = withTimeout(5_000) { c.state.first { it is CheckoutState.CryptoQr } } as CheckoutState.CryptoQr
        assertEquals("24.054000", qr.units)
        assertEquals("tron:TQ1?amount=24.054", qr.uri)
        val paid = withTimeout(5_000) { c.state.first { it is CheckoutState.Approved } } as CheckoutState.Approved
        assertEquals(300L, paid.returnsInMillis)
        assertEquals(PayMethod.CRYPTO, paid.paidWith)
        assertEquals("USDT (Tron)", paid.method)
        // Nobody touches the phone: the keypad is back, ready to repeat the method with a long press.
        val back = withTimeout(5_000) { c.state.first { it is CheckoutState.Entering } } as CheckoutState.Entering
        assertEquals(PayMethod.CRYPTO, back.repeat)

        // One tap: a long press on Cobrar repeats crypto.
        listOf(1, 2, 9, 9, 0).forEach(c::digit)
        c.repeatLast()
        val again = withTimeout(5_000) { c.state.first { it is CheckoutState.Approved } } as CheckoutState.Approved
        c.stay() // the cashier is about to cancel: the result stays on screen
        delay(500)
        assertEquals(again.copy(returnsInMillis = null), c.state.value)
        // Crypto goes back only to an address the customer gives: the app says how, and asks nothing of the API.
        c.cancelSale()
        assertEquals(CheckoutState.Cancelled(again.amount, false, CheckoutController.CRYPTO_RETURN), c.state.value)
        assertTrue(seen.toString(), seen.none { it.startsWith("POST /v1/refunds") || it.endsWith("/cancel") })
    }

    @Test
    fun aCardSaleIsCancelledAndAFailedCancellationIsOfferedAgain() = runBlocking {
        val authed = platform()
        val c = controller({ authed })
        listOf(1, 2, 9, 9, 0).forEach(c::digit)
        c.charge()
        c.choose(PayMethod.CREDIT, installments = 3)
        val paid = withTimeout(5_000) { c.state.first { it is CheckoutState.Approved } } as CheckoutState.Approved
        assertEquals("Visa •••• 1111 · 3×", paid.method)
        assertEquals(PayMethod.CREDIT, paid.paidWith)
        assertTrue(seen.toString(), seen.any { it.startsWith("POST /v1/payment-intents ") && "\"installments\":{\"count\":3,\"type\":\"merchant\"}" in it })
        c.stay()
        cancelFails = true
        c.cancelSale()
        val failed = withTimeout(5_000) { c.state.first { it is CheckoutState.Cancelled } } as CheckoutState.Cancelled
        assertTrue(!failed.done && failed.sale == paid.copy(returnsInMillis = null))
        cancelFails = false
        c.cancelSale() // "Tentar de novo"
        val done = withTimeout(5_000) { c.state.first { it is CheckoutState.Cancelled && it.done } } as CheckoutState.Cancelled
        assertEquals("Venda cancelada. O cliente não será cobrado.", done.message)
        assertTrue(seen.toString(), seen.count { it.startsWith("POST /v1/payment-intents/pi_1/cancel") } == 2)
    }
}
