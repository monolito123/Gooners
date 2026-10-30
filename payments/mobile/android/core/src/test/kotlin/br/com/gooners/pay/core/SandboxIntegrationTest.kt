package br.com.gooners.pay.core

import br.com.gooners.pay.core.api.ApiException
import br.com.gooners.pay.core.api.DeviceCreate
import br.com.gooners.pay.core.api.GoonersPayApi
import br.com.gooners.pay.core.api.PixDestination
import br.com.gooners.pay.core.auth.DeviceList
import br.com.gooners.pay.core.checkout.CheckoutController
import br.com.gooners.pay.core.checkout.CheckoutState
import br.com.gooners.pay.core.journal.Journal
import br.com.gooners.pay.core.journal.MemoryJournalStore
import br.com.gooners.pay.core.nostr.NostrKeys
import br.com.gooners.pay.core.pix.BrCode
import br.com.gooners.pay.core.sandbox.EmvApplication
import br.com.gooners.pay.core.sandbox.SandboxCardReader
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/**
 * The app's protocol against a live sandbox (go run ./cmd/smoke -serve FILE, then
 * GOONERSPAY_SANDBOX=FILE). Skipped when the variable is not set.
 */
class SandboxIntegrationTest {
    @Test fun enrollLoginSellAndPayOut() = runBlocking {
        val file = System.getenv("GOONERSPAY_SANDBOX")
        assumeTrue("GOONERSPAY_SANDBOX not set", file != null)
        val info = Json.parseToJsonElement(File(file!!).readText()).jsonObject
        val base = info["api_url"]!!.jsonPrimitive.content
        val apiKey = info["api_key"]!!.jsonPrimitive.content
        // The partner creates the merchant and its enrollment code (the only steps the app does not do).
        val http = OkHttpClient()
        fun partner(path: String, body: String): kotlinx.serialization.json.JsonObject =
            http.newCall(Request.Builder().url(base + path).header("Authorization", "Bearer $apiKey").header("Idempotency-Key", UUID.randomUUID().toString())
                .post(body.toRequestBody("application/json".toMediaType())).build()).execute().use {
                assertEquals(201, it.code)
                Json.parseToJsonElement(it.body.string()).jsonObject
            }
        val merchantId = partner("/v1/merchants", """{"legal":{"document":{"type":"cnpj","number":"12345678000195"},"legal_name":"Padaria Kotlin Ltda",""" +
            """"trade_name":"Padaria Kotlin","mcc":"5812","city":"Recife"},"settlement":{"default_speed":"instant"}}""")["id"]!!.jsonPrimitive.content
        val code = partner("/v1/merchants/$merchantId/enrollment-codes", "")["code"]!!.jsonPrimitive.content

        // The phone: lookup, root key and device key, device list, enrollment, login.
        val api = GoonersPayApi(base)
        val enrollment = api.lookupEnrollment(code)
        assertEquals(merchantId, enrollment.merchantId)
        val root = NostrKeys.generate()
        val device = NostrKeys.generate()
        val dpop = SoftwareSigner()
        val list = DeviceList.event(root, merchantId, listOf(DeviceList.Entry(device.publicKeyHex, "android", "Caixa 1")), System.currentTimeMillis() / 1000)
        val bound = api.enroll(code, DeviceCreate(device.npub, "android", "JVM test", buildJsonObject { put("type", "none") }, list))
        assertNotNull(bound.terminalId)
        val journal = Journal(MemoryJournalStore(), device.publicKeyHex, root.publicKeyHex, "test")
        journal.append("session_start")
        val authed = api.Authed({ NostrKeys(device.exportSecret()) }, dpop, api.login(device, dpop), onKey = { journal.signPending(it) })
        assertEquals(merchantId, authed.merchant().id)

        // A card sale through the real checkout controller and the sandbox reader.
        val stan = AtomicInteger(0)
        val controller = CheckoutController({ authed }, { SandboxCardReader(info["dev_card_key"]!!.jsonPrimitive.content.hexToBytes()) },
            { (stan.incrementAndGet() % 1_000_000).toString().padStart(6, '0') }, this, pixPollMillis = 200, journal = { journal })
        listOf(1, 2, 9, 9, 0).forEach(controller::digit)
        controller.charge()
        controller.card(EmvApplication.CREDIT)
        val done = withTimeout(30_000) { controller.state.first { it is CheckoutState.Approved || it is CheckoutState.Declined } }
        assertTrue("$done", done is CheckoutState.Approved)
        assertTrue((done as CheckoutState.Approved).claimUrl!!.contains("#k="))

        // Pix: a dynamic QR whose amount the app checks before showing it.
        controller.nextSale()
        listOf(2, 3, 9, 0).forEach(controller::digit)
        controller.charge()
        controller.pix()
        val qr = withTimeout(30_000) { controller.state.first { it is CheckoutState.PixQr || it is CheckoutState.Declined } }
        assertTrue("$qr", qr is CheckoutState.PixQr)
        // A dynamic code may leave the amount to its payload location (the payer's bank fetches it).
        val decoded = BrCode.decode((qr as CheckoutState.PixQr).brCode)
        assertTrue(decoded.dynamic && decoded.url != null && (decoded.amount == null || decoded.amount == "23.90"))
        controller.nextSale()

        // The journal: signed with the key unwrapped for login, uploaded in order, linked from the sale.
        journal.signPending(device)
        val sent = journal.toUpload()
        val synced = authed.syncJournal(journal)!!
        assertEquals("consistent", synced.status)
        assertEquals(journal.lastSeq, synced.head!!.seq)
        assertEquals(sent.size, synced.accepted)
        assertEquals("consistent", authed.journalState().status)
        val tap = sent.first { it.content.contains("\"tap_started\"") }
        val saleId = Json.parseToJsonElement(tap.content).jsonObject["payment_intent_id"]!!.jsonPrimitive.content
        val evidence = http.newCall(Request.Builder().url("$base/v1/payment-intents/$saleId/journal").header("Authorization", "Bearer $apiKey").build())
            .execute().use { Json.parseToJsonElement(it.body.string()).jsonObject["data"]!!.jsonArray.size }
        assertEquals(2, evidence) // tap_started and auth_result: the device's own signed view of the sale

        // Balance and a payout to a Pix key.
        val balance = authed.balance()
        assertTrue(balance.available > 0)
        val quote = authed.quote(minOf(balance.available, 5_000), PixDestination(keyType = "cnpj", key = "12345678000195"))
        assertEquals("paid", authed.payout(quote.id).status)
        assertTrue(authed.entries(5).data.isNotEmpty())

        // The owner's phone adds a cashier phone: the root key signs a newer list naming both.
        val cashier = NostrKeys.generate()
        val cashierDpop = SoftwareSigner()
        val ownerEntry = DeviceList.Entry(device.publicKeyHex, "android", "Caixa 1")
        val both = DeviceList.event(root, merchantId, listOf(ownerEntry, DeviceList.Entry(cashier.publicKeyHex, "ios", "Caixa 2")), System.currentTimeMillis() / 1000 + 1)
        authed.registerDevice(DeviceCreate(cashier.npub, "ios", authorizationEvent = both))
        val cashierAuthed = api.Authed({ NostrKeys(cashier.exportSecret()) }, cashierDpop, api.login(cashier, cashierDpop))
        assertTrue(cashierAuthed.session.terminalId != null && cashierAuthed.session.terminalId != authed.session.terminalId)
        assertEquals(merchantId, cashierAuthed.merchant().id)

        // Dropping it from the list ends its session at once, and it cannot log in again.
        val onlyOwner = DeviceList.event(root, merchantId, listOf(ownerEntry), System.currentTimeMillis() / 1000 + 2)
        authed.registerDevice(DeviceCreate(device.npub, "android", authorizationEvent = onlyOwner))
        val refused = runCatching { cashierAuthed.merchant() }.exceptionOrNull()
        assertEquals(401, (refused as ApiException).status)
        device.wipe()
        root.wipe()
        cashier.wipe()
    }
}
