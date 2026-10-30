package br.com.gooners.pay.core.api

import br.com.gooners.pay.core.auth.Jwk
import br.com.gooners.pay.core.nostr.Event
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// The subset of payments/api/openapi.yaml the merchant app uses.

@Serializable
data class Problem(val type: String = "", val title: String = "", val status: Int = 0, val code: String = "", val detail: String? = null)

@Serializable
data class Enrollment(
    @SerialName("merchant_id") val merchantId: String,
    @SerialName("trade_name") val tradeName: String,
    @SerialName("root_npub") val rootNpub: String? = null,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
data class DeviceCreate(
    @SerialName("device_npub") val deviceNpub: String,
    val platform: String,
    val model: String? = null,
    val attestation: JsonObject? = null,
    @SerialName("authorization_event") val authorizationEvent: Event,
)

@Serializable
data class Device(
    val id: String,
    @SerialName("merchant_id") val merchantId: String,
    @SerialName("device_npub") val deviceNpub: String,
    val platform: String = "",
    val label: String? = null,
    val status: String,
    val capabilities: List<String> = emptyList(),
    @SerialName("terminal_id") val terminalId: String? = null,
)

@Serializable
data class LoginBody(
    @SerialName("dpop_jwk") val dpopJwk: Jwk,
    @SerialName("device_id") val deviceId: String? = null,
    /** Sent with a first login when the platform asks for it (attestation_required). */
    val attestation: JsonObject? = null,
)

@Serializable
data class Session(
    @SerialName("session_token") val token: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("merchant_id") val merchantId: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("terminal_id") val terminalId: String? = null,
    @SerialName("account_id") val accountId: String,
    val scopes: List<String> = emptyList(),
)

@Serializable
data class Merchant(
    val id: String,
    @SerialName("account_id") val accountId: String,
    @SerialName("trade_name") val tradeName: String,
    val status: String,
    @SerialName("root_npub") val rootNpub: String? = null,
)

@Serializable
data class IntentCreate(
    val amount: Long,
    val channel: String? = null,
    @SerialName("payment_method_types") val paymentMethodTypes: List<String>? = null,
    val description: String? = null,
)

@Serializable
data class NextAction(val type: String, val txid: String? = null, @SerialName("br_code") val brCode: String? = null)

@Serializable
data class PaymentIntent(
    val id: String,
    val status: String,
    val amount: Long,
    val currency: String = "BRL",
    @SerialName("merchant_id") val merchantId: String,
    val channel: String = "",
    @SerialName("next_action") val nextAction: NextAction? = null,
    val receipt: ReceiptView? = null,
)

@Serializable
data class Sred(val format: String, val ksn: String, val ciphertext: String)

@Serializable
data class TerminalAuthorization(
    @SerialName("payment_intent_id") val paymentIntentId: String,
    @SerialName("terminal_id") val terminalId: String,
    val stan: String,
    @SerialName("emv_application") val emvApplication: String,
    @SerialName("local_time") val localTime: String,
    val sred: Sred,
    /** The device's tap_started journal entry; the receipt links to it (docs/03 §3.3). */
    @SerialName("journal_event_id") val journalEventId: String? = null,
)

@Serializable
data class CardView(val brand: String = "", val last4: String = "", val funding: String = "")

@Serializable
data class ReceiptView(
    @SerialName("nostr_event_id") val nostrEventId: String? = null,
    @SerialName("claim_qr") val claimQr: String? = null,
    @SerialName("claim_url") val claimUrl: String? = null,
)

@Serializable
data class SettlementView(
    val mode: String = "",
    @SerialName("merchant_discount") val merchantDiscount: Long = 0,
    @SerialName("advance_fee") val advanceFee: Long = 0,
    @SerialName("net_available") val netAvailable: Long = 0,
    @SerialName("settles_on") val settlesOn: String = "",
)

@Serializable
data class TerminalResult(
    val status: String,
    @SerialName("payment_intent_id") val paymentIntentId: String,
    @SerialName("response_code") val responseCode: String? = null,
    @SerialName("authorization_code") val authorizationCode: String? = null,
    val rrn: String? = null,
    @SerialName("decline_code") val declineCode: String? = null,
    @SerialName("customer_message") val customerMessage: String? = null,
    val card: CardView? = null,
    val receipt: ReceiptView? = null,
    val settlement: SettlementView? = null,
)

@Serializable
data class PendingDay(val date: String, val amount: Long)

@Serializable
data class Balance(
    @SerialName("account_id") val accountId: String,
    val available: Long,
    val pending: Long,
    val reserved: Long = 0,
    @SerialName("instant_eligible") val instantEligible: Long = 0,
    @SerialName("pending_by_date") val pendingByDate: List<PendingDay> = emptyList(),
)

@Serializable
data class Entry(
    @SerialName("journal_id") val journalId: String,
    val direction: String,
    val amount: Long,
    val type: String,
    val reference: String = "",
    @SerialName("posted_at") val postedAt: String,
)

@Serializable
data class Entries(val data: List<Entry>, @SerialName("has_more") val hasMore: Boolean = false)

@Serializable
data class PixDestination(val type: String = "pix", @SerialName("key_type") val keyType: String, val key: String)

@Serializable
data class QuoteRequest(
    @SerialName("account_id") val accountId: String,
    val amount: Long,
    val speed: String = "instant",
    val destination: PixDestination,
)

@Serializable
data class Quote(
    val id: String,
    val amount: Long,
    @SerialName("fee_total") val feeTotal: Long,
    @SerialName("net_to_destination") val netToDestination: Long,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
data class PayoutRequest(@SerialName("quote_id") val quoteId: String)

@Serializable
data class Payout(
    val id: String,
    val status: String,
    val amount: Long,
    @SerialName("end_to_end_id") val endToEndId: String? = null,
    val reason: String? = null,
)

@Serializable
data class JournalUpload(val entries: List<Event>)

@Serializable
data class EnrollmentCode(val code: String, @SerialName("merchant_id") val merchantId: String, @SerialName("expires_at") val expiresAt: String)
