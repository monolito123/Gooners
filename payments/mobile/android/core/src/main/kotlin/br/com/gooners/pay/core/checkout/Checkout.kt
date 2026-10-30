package br.com.gooners.pay.core.checkout

import br.com.gooners.pay.core.Money
import br.com.gooners.pay.core.api.ApiException
import br.com.gooners.pay.core.api.GoonersPayApi
import br.com.gooners.pay.core.api.IntentCreate
import br.com.gooners.pay.core.api.Sred
import br.com.gooners.pay.core.api.TerminalAuthorization
import br.com.gooners.pay.core.api.TerminalResult
import br.com.gooners.pay.core.journal.Journal
import br.com.gooners.pay.core.pix.BrCode
import br.com.gooners.pay.core.sandbox.CardReader
import br.com.gooners.pay.core.sandbox.EmvApplication
import br.com.gooners.pay.core.sandbox.base64Ciphertext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.OffsetDateTime
import java.time.ZoneOffset

/** What the checkout screen shows (docs/05 §2.3). Every state is a value that tests can compare. */
sealed interface CheckoutState {
    data class Entering(val amount: Money = Money.zero()) : CheckoutState
    data class ChoosingMethod(val amount: Money) : CheckoutState
    data class WaitingForCard(val amount: Money, val readerName: String) : CheckoutState
    data class Authorizing(val amount: Money) : CheckoutState
    data class PixQr(val amount: Money, val intentId: String, val brCode: String) : CheckoutState
    data class Approved(val amount: Money, val method: String, val claimUrl: String?, val netAvailable: Long?, val instant: Boolean) : CheckoutState
    data class Declined(val amount: Money, val message: String) : CheckoutState
}

/** Issues the terminal's trace numbers, 000001..999999; the app persists the counter. */
fun interface StanSource {
    fun next(): String
}

/**
 * Runs one sale at a time: the keypad, then a card through the reader and
 * POST /v1/terminal/authorizations, or a dynamic Pix QR polled until it is paid.
 */
class CheckoutController(
    private val api: () -> GoonersPayApi.Authed,
    private val reader: () -> CardReader,
    private val stan: StanSource,
    private val scope: CoroutineScope,
    private val pixPollMillis: Long = 2_000,
    /** The device's journal: each sale writes tap_started and auth_result (docs/03 §7.1). */
    private val journal: () -> Journal? = { null },
) {
    private val _state = MutableStateFlow<CheckoutState>(CheckoutState.Entering())
    val state: StateFlow<CheckoutState> = _state.asStateFlow()
    private var job: Job? = null

    fun digit(d: Int) = edit { it.typed(d) }
    fun backspace() = edit { it.backspace() }

    private fun edit(f: (Money) -> Money) {
        val s = _state.value
        if (s is CheckoutState.Entering) _state.value = s.copy(amount = f(s.amount))
    }

    fun charge() {
        val s = _state.value
        if (s is CheckoutState.Entering && !s.amount.isZero) _state.value = CheckoutState.ChoosingMethod(s.amount)
    }

    fun back() {
        job?.cancel()
        val s = _state.value
        if (s is CheckoutState.PixQr) {
            // The customer left: cancel the charge, so a late payment of an abandoned QR is refused.
            log("auth_result", s.intentId, s.amount, "result" to "canceled")
            scope.launch { runCatching { api().cancel(s.intentId) } }
        }
        _state.value = CheckoutState.Entering(amountOf(s))
    }

    private fun log(type: String, intentId: String, amount: Money, vararg extra: Pair<String, String>) {
        val j = journal() ?: return
        runCatching {
            j.append(type, JsonObject(mapOf("payment_intent_id" to JsonPrimitive(intentId), "amount" to Journal.amount(amount.centavos)) +
                extra.associate { (k, v) -> k to JsonPrimitive(v) }))
        }
    }

    fun nextSale() {
        job?.cancel()
        _state.value = CheckoutState.Entering()
    }

    fun card(application: EmvApplication) {
        val s = _state.value as? CheckoutState.ChoosingMethod ?: return
        val amount = s.amount
        job = scope.launch {
            var intentId: String? = null
            var sent = false
            try {
                val authed = api()
                val terminal = authed.session.terminalId ?: return@launch fail(amount, "Este aparelho não tem terminal. Use Pix.")
                val intent = authed.createIntent(IntentCreate(amount = amount.centavos, channel = "card_present"))
                intentId = intent.id
                val r = reader()
                _state.value = CheckoutState.WaitingForCard(amount, r.name)
                val card = r.read(amount, application)
                _state.value = CheckoutState.Authorizing(amount)
                val stanValue = stan.next()
                val tap = journal()?.let { runCatching { it.append("tap_started", JsonObject(mapOf("payment_intent_id" to JsonPrimitive(intent.id),
                    "amount" to Journal.amount(amount.centavos), "terminal_id" to JsonPrimitive(terminal), "stan" to JsonPrimitive(stanValue)))) }.getOrNull() }
                sent = true
                val result = authed.authorize(TerminalAuthorization(intent.id, terminal, stanValue, application.wire,
                    OffsetDateTime.now(ZoneOffset.UTC).withNano(0).toString(), Sred(card.format, card.ksn, card.base64Ciphertext()), tap?.id))
                log("auth_result", intent.id, amount, "result" to journalResult(result.status), "stan" to stanValue)
                _state.value = outcome(amount, result)
            } catch (e: kotlinx.coroutines.CancellationException) {
                abandon(intentId, sent)
                throw e
            } catch (e: ApiException) {
                abandon(intentId, sent)
                fail(amount, e.problem?.detail?.takeIf { e.status == 409 } ?: "Não foi possível autorizar. Tente de novo ou use Pix.")
            } catch (e: Exception) {
                abandon(intentId, sent)
                fail(amount, "Sem conexão com a goonersPAY. Tente de novo.")
            }
        }
    }

    /**
     * Cancels a card intent nothing was sent for (the reader failed, the cashier went back).
     * Once an authorization was sent its outcome may be unknown, and the platform's reversal
     * handles it; the app never cancels then.
     */
    private fun abandon(intentId: String?, sent: Boolean) {
        if (intentId == null || sent) return
        scope.launch { runCatching { api().cancel(intentId) } }
    }

    fun pix() {
        val s = _state.value as? CheckoutState.ChoosingMethod ?: return
        val amount = s.amount
        job = scope.launch {
            try {
                val authed = api()
                val created = authed.createIntent(IntentCreate(amount = amount.centavos, paymentMethodTypes = listOf("pix")))
                val confirmed = authed.confirmPix(created.id)
                val code = confirmed.nextAction?.brCode ?: return@launch fail(amount, "O Pix não está disponível agora.")
                val decoded = BrCode.decode(code) // a corrupt or foreign code is never shown to the customer
                if (decoded.amount != null && decoded.amount != amount.decimal()) return@launch fail(amount, "O QR Code não confere com o valor.")
                _state.value = CheckoutState.PixQr(amount, created.id, code)
                while (true) {
                    delay(pixPollMillis)
                    val pi = authed.intent(created.id)
                    when (pi.status) {
                        "captured" -> {
                            log("auth_result", created.id, amount, "result" to "approved")
                            _state.value = CheckoutState.Approved(amount, "Pix", pi.receipt?.claimUrl, null, true)
                            return@launch
                        }
                        "canceled", "failed" -> {
                            log("auth_result", created.id, amount, "result" to "canceled")
                            return@launch fail(amount, "O Pix expirou. Gere um novo QR Code.")
                        }
                    }
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                fail(amount, "Não foi possível gerar o Pix. Tente de novo.")
            }
        }
    }

    private fun fail(amount: Money, message: String) {
        _state.value = CheckoutState.Declined(amount, message)
    }

    companion object {
        /** The journal's result values (nostr/schemas/kind-7714). */
        fun journalResult(status: String): String = when (status) {
            "approved" -> "approved"
            "timeout" -> "timeout"
            else -> "declined"
        }

        fun outcome(amount: Money, r: TerminalResult): CheckoutState = when (r.status) {
            "approved" -> CheckoutState.Approved(amount, listOfNotNull(r.card?.brand?.replaceFirstChar { it.uppercase() }, r.card?.last4?.let { "•••• $it" }).joinToString(" "),
                r.receipt?.claimQr, r.settlement?.netAvailable, r.settlement?.mode == "instant")
            "timeout" -> CheckoutState.Declined(amount, "Tempo esgotado. Aproxime o cartão de novo.")
            "pin_required" -> CheckoutState.Declined(amount, "Este cartão pede senha. Use o débito com senha ou Pix.")
            else -> CheckoutState.Declined(amount, r.customerMessage ?: "Pagamento recusado. Tente outro cartão.")
        }

        private fun amountOf(s: CheckoutState): Money = when (s) {
            is CheckoutState.Entering -> s.amount
            is CheckoutState.ChoosingMethod -> s.amount
            is CheckoutState.WaitingForCard -> s.amount
            is CheckoutState.Authorizing -> s.amount
            is CheckoutState.PixQr -> s.amount
            is CheckoutState.Approved -> Money.zero()
            is CheckoutState.Declined -> s.amount
        }
    }
}
