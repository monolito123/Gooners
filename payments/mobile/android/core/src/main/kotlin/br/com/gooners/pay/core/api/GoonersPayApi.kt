package br.com.gooners.pay.core.api

import br.com.gooners.pay.core.auth.Dpop
import br.com.gooners.pay.core.auth.Nip98
import br.com.gooners.pay.core.auth.P256Signer
import br.com.gooners.pay.core.journal.Journal
import br.com.gooners.pay.core.journal.JournalStatus
import br.com.gooners.pay.core.nostr.Event
import br.com.gooners.pay.core.nostr.NostrKeys
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.CertificatePinner
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import java.util.concurrent.TimeUnit

/** An error answer from the platform (RFC 9457 Problem Details). */
class ApiException(val status: Int, val problem: Problem?) :
    Exception("HTTP $status ${problem?.code.orEmpty()}: ${problem?.detail ?: problem?.title.orEmpty()}")

/** Seconds since the epoch; replaced in tests. */
fun interface Clock {
    fun now(): Long
}

val SystemClock = Clock { System.currentTimeMillis() / 1000 }

private val JSON = "application/json".toMediaType()

/**
 * The platform's merchant-app API (docs/02 §3.2, §8.2). Enrollment uses a single-use code,
 * login a NIP-98 event signed by the device key, and every later call a session token bound
 * to the hardware DPoP key. The app never holds an API key.
 */
class GoonersPayApi(
    baseUrl: String,
    private val http: OkHttpClient = defaultClient(),
    private val clock: Clock = SystemClock,
) {
    val baseUrl: String = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

    private suspend fun <T> send(
        method: String, path: String, body: String?, headers: Map<String, String>, out: KSerializer<T>,
    ): T = withContext(Dispatchers.IO) {
        // OkHttp refuses a POST without a body: a bodiless call (cancel, enrollment code) sends an empty one.
        val payload = body?.toRequestBody(JSON) ?: if (method == "POST" || method == "PUT") ByteArray(0).toRequestBody(null) else null
        val rb = Request.Builder().url(baseUrl + path).method(method, payload)
        headers.forEach { (k, v) -> rb.header(k, v) }
        if (method == "POST") rb.header("Idempotency-Key", UUID.randomUUID().toString())
        http.newCall(rb.build()).execute().use { resp ->
            val text = resp.body.string()
            if (!resp.isSuccessful) {
                throw ApiException(resp.code, runCatching { json.decodeFromString(Problem.serializer(), text) }.getOrNull())
            }
            json.decodeFromString(out, text)
        }
    }

    // ---- enrollment and login (no session yet) ----

    suspend fun lookupEnrollment(code: String): Enrollment =
        send("GET", "/v1/enrollment", null, mapOf("Authorization" to "Enrollment $code"), Enrollment.serializer())

    suspend fun enroll(code: String, body: DeviceCreate): Device =
        send("POST", "/v1/enrollment", json.encodeToString(DeviceCreate.serializer(), body), mapOf("Authorization" to "Enrollment $code"), Device.serializer())

    /** POST /v1/auth/nostr: the body is sent exactly as its hash was signed. */
    suspend fun login(device: NostrKeys, dpop: P256Signer, deviceId: String? = null, attestation: JsonObject? = null): Session {
        val body = json.encodeToString(LoginBody.serializer(), LoginBody(dpop.publicJwk, deviceId, attestation))
        val event = Nip98.event(device, "POST", "$baseUrl/v1/auth/nostr", body.toByteArray(Charsets.UTF_8), clock.now())
        return send("POST", "/v1/auth/nostr", body, mapOf("Authorization" to Nip98.header(event)), Session.serializer())
    }

    // ---- calls with a session ----

    /**
     * A logged-in device: renews its session by logging in again when it expires. The device
     * key is asked for only to sign that login and wiped right after, so between logins it can
     * stay wrapped behind the user's biometrics (docs/05 §2.6).
     */
    inner class Authed(
        private val deviceKey: suspend () -> NostrKeys,
        private val dpop: P256Signer,
        initial: Session,
        /** Runs while the device key is unwrapped for a login: signs pending journal entries. */
        private val onKey: (NostrKeys) -> Unit = {},
    ) {
        private val mutex = Mutex()
        @Volatile var session: Session = initial
            private set
        private var expiresAt = clock.now() + initial.expiresIn

        private suspend fun current(): Session = mutex.withLock {
            if (clock.now() >= expiresAt - 30) {
                val key = deviceKey()
                try {
                    session = login(key, dpop, session.deviceId)
                    runCatching { onKey(key) }
                } finally {
                    key.wipe()
                }
                expiresAt = clock.now() + session.expiresIn
            }
            session
        }

        private suspend fun <T> call(method: String, path: String, body: String?, out: KSerializer<T>): T {
            suspend fun attempt(s: Session): T {
                val proof = Dpop.proof(dpop, method, baseUrl + path, s.token, clock.now())
                return send(method, path, body, mapOf("Authorization" to "DPoP ${s.token}", "DPoP" to proof), out)
            }
            return try {
                attempt(current())
            } catch (e: ApiException) {
                if (e.status != 401) throw e
                mutex.withLock { expiresAt = 0 } // the session was revoked or expired early: log in again once
                attempt(current())
            }
        }

        suspend fun merchant(): Merchant = call("GET", "/v1/merchants/${session.merchantId}", null, Merchant.serializer())

        suspend fun createIntent(req: IntentCreate): PaymentIntent =
            call("POST", "/v1/payment-intents", json.encodeToString(IntentCreate.serializer(), req), PaymentIntent.serializer())

        suspend fun intent(id: String): PaymentIntent = call("GET", "/v1/payment-intents/$id", null, PaymentIntent.serializer())

        suspend fun confirmPix(id: String): PaymentIntent = call("POST", "/v1/payment-intents/$id/confirm", """{"payment_method_type":"pix"}""", PaymentIntent.serializer())

        suspend fun cancel(id: String): PaymentIntent = call("POST", "/v1/payment-intents/$id/cancel", null, PaymentIntent.serializer())

        suspend fun confirmCrypto(id: String, asset: String, network: String): PaymentIntent =
            call("POST", "/v1/payment-intents/$id/confirm", json.encodeToString(CryptoConfirm.serializer(), CryptoConfirm(asset, network)), PaymentIntent.serializer())

        /** Gives a captured Pix or crypto sale back to the payer ("Cancelar venda"). */
        suspend fun refund(intentId: String, amount: Long): Refund =
            call("POST", "/v1/refunds", json.encodeToString(RefundCreate.serializer(), RefundCreate(intentId, amount)), Refund.serializer())

        /** The sandbox only: the customer's transfer arrives. */
        suspend fun simulateCryptoPayment(id: String): PaymentIntent = call("POST", "/v1/sandbox/crypto/payments/$id", null, PaymentIntent.serializer())

        suspend fun holdings(): Holdings = call("GET", "/v1/holdings", null, Holdings.serializer())

        suspend fun internationalAccounts(): InternationalAccounts = call("GET", "/v1/international/accounts", null, InternationalAccounts.serializer())

        suspend fun portfolio(): Portfolio = call("GET", "/v1/investments/positions", null, Portfolio.serializer())

        suspend fun quoteConversion(req: ConversionRequest): Conversion =
            call("POST", "/v1/conversions", json.encodeToString(ConversionRequest.serializer(), req), Conversion.serializer())

        suspend fun executeConversion(id: String): Conversion = call("POST", "/v1/conversions/$id/execute", null, Conversion.serializer())

        suspend fun authorize(req: TerminalAuthorization): TerminalResult =
            call("POST", "/v1/terminal/authorizations", json.encodeToString(TerminalAuthorization.serializer(), req), TerminalResult.serializer())

        suspend fun balance(): Balance = call("GET", "/v1/accounts/${session.accountId}/balance", null, Balance.serializer())

        suspend fun entries(limit: Int = 20): Entries = call("GET", "/v1/accounts/${session.accountId}/entries?limit=$limit", null, Entries.serializer())

        suspend fun quote(amount: Long, destination: PixDestination): Quote =
            call("POST", "/v1/payouts/quotes", json.encodeToString(QuoteRequest.serializer(), QuoteRequest(session.accountId, amount, destination = destination)), Quote.serializer())

        suspend fun payout(quoteId: String): Payout = call("POST", "/v1/payouts", json.encodeToString(PayoutRequest.serializer(), PayoutRequest(quoteId)), Payout.serializer())

        suspend fun uploadJournal(entries: List<Event>): JournalStatus =
            call("POST", "/v1/terminal/journal", json.encodeToString(JournalUpload.serializer(), JournalUpload(entries)), JournalStatus.serializer())

        suspend fun journalState(): JournalStatus = call("GET", "/v1/terminal/journal", null, JournalStatus.serializer())

        /** The merchant's daily statements, newest day first (docs/03 §6). */
        suspend fun settlements(limit: Int = 30): Settlements = call("GET", "/v1/settlements?limit=$limit", null, Settlements.serializer())

        /** The signed kind 7713 statement of a settlement. */
        suspend fun statement(settlementId: String): Event = call("GET", "/v1/settlements/$settlementId/statement", null, Event.serializer())

        /** A receipt's inclusion proof in its statement and the statement's in the public root. */
        suspend fun proof(settlementId: String, receiptEventId: String): InclusionProof =
            call("GET", "/v1/settlements/$settlementId/proofs/$receiptEventId", null, InclusionProof.serializer())

        /** The day's public transparency root (kind 7715). Public: anyone can fetch it. */
        suspend fun transparencyRoot(date: String): TransparencyRoot = call("GET", "/v1/transparency/$date", null, TransparencyRoot.serializer())

        /** Fetches a settlement's statement and its day's public root, and checks them on the phone. */
        suspend fun verifiedStatement(settlement: Settlement, platformKeys: Set<String> = emptySet()): br.com.gooners.pay.core.statements.Statement =
            br.com.gooners.pay.core.statements.Statement.verify(statement(settlement.id), transparencyRoot(settlement.date).event, session.merchantId, platformKeys)

        /** Uploads the journal's signed entries; null when there was nothing to send. */
        suspend fun syncJournal(journal: Journal): JournalStatus? {
            val entries = journal.toUpload()
            if (entries.isEmpty()) return null
            return uploadJournal(entries).also { journal.record(entries, it) }
        }

        suspend fun createEnrollmentCode(): EnrollmentCode = call("POST", "/v1/merchants/${session.merchantId}/enrollment-codes", null, EnrollmentCode.serializer())

        suspend fun registerDevice(body: DeviceCreate): Device =
            call("POST", "/v1/merchants/${session.merchantId}/devices", json.encodeToString(DeviceCreate.serializer(), body), Device.serializer())
    }

    companion object {
        /**
         * The app's HTTP client. [pins] are "sha256/<base64 SPKI hash>" values for [host]: the
         * platform's current key and a backup, so a user-installed or mis-issued certificate
         * authority cannot read the app's traffic. No pins, no pinning (the sandbox).
         */
        fun defaultClient(host: String? = null, pins: List<String> = emptyList()): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS) // a card authorization may take the host's full timeout
            .followRedirects(false)
            .followSslRedirects(false)
            .apply {
                if (host != null && pins.isNotEmpty()) {
                    certificatePinner(CertificatePinner.Builder().apply { pins.forEach { add(host, it) } }.build())
                }
            }
            .build()
    }
}
