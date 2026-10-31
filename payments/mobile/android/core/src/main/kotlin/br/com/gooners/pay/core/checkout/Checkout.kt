package br.com.gooners.pay.core.checkout

import br.com.gooners.pay.core.Money
import br.com.gooners.pay.core.api.ApiException
import br.com.gooners.pay.core.api.DeviceRisk
import br.com.gooners.pay.core.api.GoonersPayApi
import br.com.gooners.pay.core.api.Installments
import br.com.gooners.pay.core.api.IntentCreate
import br.com.gooners.pay.core.api.Sred
import br.com.gooners.pay.core.api.TerminalAuthorization
import br.com.gooners.pay.core.api.TerminalResult
import br.com.gooners.pay.core.journal.Journal
import br.com.gooners.pay.core.pix.BrCode
import br.com.gooners.pay.core.risk.RiskMonitor
import br.com.gooners.pay.core.sandbox.CardReader
import br.com.gooners.pay.core.sandbox.EmvApplication
import br.com.gooners.pay.core.sandbox.base64Ciphertext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.OffsetDateTime
import java.time.ZoneOffset

/** How the customer pays. */
enum class PayMethod(val label: String) { CREDIT("Crédito"), DEBIT("Débito"), PIX("Pix"), CRYPTO("Cripto") }

/** Remembers the last method, so the sheet puts it first and a long press repeats it (docs/06 §5). */
interface MethodMemory {
    var last: PayMethod?
}

class InMemoryMethods(override var last: PayMethod? = null) : MethodMemory

/** The stablecoin and network a crypto charge asks for. */
data class CryptoChoice(val asset: String = "USDT", val network: String = "tron") {
    val label: String get() = "$asset (${network.replaceFirstChar { it.uppercase() }})"
}

/** What the checkout screen shows (docs/05 §2.3). Every state is a value that tests can compare. */
sealed interface CheckoutState {
    /** The keypad. repeat is the method a long press on Cobrar starts. */
    data class Entering(val amount: Money = Money.zero(), val repeat: PayMethod? = null) : CheckoutState
    /** The method sheet, the last method first. */
    data class ChoosingMethod(val amount: Money, val methods: List<PayMethod>) : CheckoutState
    data class WaitingForCard(val amount: Money, val readerName: String) : CheckoutState
    data class Authorizing(val amount: Money) : CheckoutState
    data class PixQr(val amount: Money, val intentId: String, val brCode: String) : CheckoutState
    /** Send exactly units of asset on network to address before expiresAt. */
    data class CryptoQr(
        val amount: Money, val intentId: String, val asset: String, val network: String, val units: String,
        val address: String, val memo: String?, val uri: String, val expiresAt: String,
    ) : CheckoutState
    /**
     * returnsInMillis: the keypad comes back by itself after this long (null: it waits, as
     * when the sale was held and the message needs reading).
     */
    data class Approved(
        val amount: Money, val method: String, val claimUrl: String?, val netAvailable: Long?, val instant: Boolean, val held: Boolean = false,
        val intentId: String = "", val paidWith: PayMethod = PayMethod.CREDIT, val returnsInMillis: Long? = null,
    ) : CheckoutState
    /** "Cancelar venda" is on its way. */
    data class Undoing(val amount: Money) : CheckoutState
    /** The outcome of "Cancelar venda"; when it failed, sale is the sale to try again. */
    data class Cancelled(val amount: Money, val done: Boolean, val message: String, val sale: Approved? = null) : CheckoutState
    data class Declined(val amount: Money, val message: String) : CheckoutState
    /**
     * A crypto payment arrived and the platform is checking who sent it (docs/09 §6.5): the
     * sale is neither done nor lost. The cashier goes on; the sale shows in Vendas once cleared.
     */
    data class Reviewing(val amount: Money, val message: String) : CheckoutState
}

/** Issues the terminal's trace numbers, 000001..999999; the app persists the counter. */
fun interface StanSource {
    fun next(): String
}

/**
 * Runs one sale at a time: the keypad, then a card through the reader and
 * POST /v1/terminal/authorizations, or a dynamic Pix QR or a crypto transfer polled until it
 * is paid. Two taps from amount to payment, one with a long press (docs/06 §5).
 */
class CheckoutController(
    private val api: () -> GoonersPayApi.Authed,
    private val reader: () -> CardReader,
    private val stan: StanSource,
    private val scope: CoroutineScope,
    private val pixPollMillis: Long = 2_000,
    /** The device's journal: each sale writes tap_started and auth_result (docs/03 §7.1). */
    private val journal: () -> Journal? = { null },
    /** Scores each tap on the phone (docs/07 §3). */
    private val risk: RiskMonitor = RiskMonitor(),
    private val memory: MethodMemory = InMemoryMethods(),
    /** Null when the merchant does not take crypto. */
    private val cryptoOffer: () -> CryptoChoice? = { null },
    /** After an approval the keypad returns by itself (docs/06 §5). */
    private val autoReturnMillis: Long = 4_000,
) {
    private val _state = MutableStateFlow<CheckoutState>(entering())
    val state: StateFlow<CheckoutState> = _state.asStateFlow()
    private var job: Job? = null
    private var autoReturn: Job? = null

    private fun entering(amount: Money = Money.zero()) = CheckoutState.Entering(amount, memory.last?.takeIf { it in methods() })

    /** The methods this phone offers, the last one used first. */
    fun methods(): List<PayMethod> {
        val all = PayMethod.entries.filter { it != PayMethod.CRYPTO || cryptoOffer() != null }
        val last = memory.last?.takeIf { it in all } ?: return all
        return listOf(last) + (all - last)
    }

    fun digit(d: Int) = edit { it.typed(d) }
    fun backspace() = edit { it.backspace() }

    /** A quick amount: replaces what was typed. */
    fun set(amount: Money) = edit { if (amount.centavos in 0..Money.MAX_KEYPAD) amount else it }

    private fun edit(f: (Money) -> Money) {
        val s = _state.value
        if (s is CheckoutState.Entering) {
            risk.typing()
            _state.value = s.copy(amount = f(s.amount))
        }
    }

    /** Tap 1: Cobrar opens the method sheet. */
    fun charge() {
        val s = _state.value
        if (s is CheckoutState.Entering && !s.amount.isZero) _state.value = CheckoutState.ChoosingMethod(s.amount, methods())
    }

    /** A long press on Cobrar: the last method straight away, one tap in all. */
    fun repeatLast() {
        val s = _state.value as? CheckoutState.Entering ?: return
        val last = s.repeat ?: return
        if (s.amount.isZero) return
        _state.value = CheckoutState.ChoosingMethod(s.amount, methods())
        choose(last)
    }

    /** Tap 2: the method. Credit in parcelas when installments > 1. */
    fun choose(method: PayMethod, installments: Int = 1) {
        if (_state.value !is CheckoutState.ChoosingMethod) return
        memory.last = method
        when (method) {
            PayMethod.CREDIT -> card(EmvApplication.CREDIT, installments)
            PayMethod.DEBIT -> card(EmvApplication.DEBIT)
            PayMethod.PIX -> pix()
            PayMethod.CRYPTO -> crypto()
        }
    }

    fun back() {
        job?.cancel()
        val s = _state.value
        if (s is CheckoutState.PixQr || s is CheckoutState.CryptoQr) {
            // The customer left: cancel the charge, so a late payment of an abandoned QR is refused.
            val id = if (s is CheckoutState.PixQr) s.intentId else (s as CheckoutState.CryptoQr).intentId
            log("auth_result", id, amountOf(s), "result" to "canceled")
            scope.launch { runCatching { api().cancel(id) } }
        }
        _state.value = entering(amountOf(s))
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
        autoReturn?.cancel()
        risk.cleared()
        _state.value = entering()
    }

    /** Re-reads the methods on offer (the merchant changed a setting); a sale in progress is left alone. */
    fun refresh() {
        val s = _state.value
        if (s is CheckoutState.Entering) _state.value = entering(s.amount)
    }

    /** Keeps the result on screen: the cashier is reading it or about to cancel. */
    fun stay() {
        autoReturn?.cancel()
        val s = _state.value
        if (s is CheckoutState.Approved && s.returnsInMillis != null) _state.value = s.copy(returnsInMillis = null)
    }

    private fun approved(a: CheckoutState.Approved) {
        val r = if (a.held) a else a.copy(returnsInMillis = autoReturnMillis)
        _state.value = r
        if (r.returnsInMillis != null) {
            autoReturn?.cancel()
            autoReturn = scope.launch {
                delay(autoReturnMillis)
                if (_state.value == r) nextSale()
            }
        }
    }

    /**
     * "Cancelar venda" on the result screen, instead of a confirmation on every right sale
     * (docs/06 §5): a card sale is reversed before clearing; a Pix or crypto sale, which
     * cannot be reversed, is refunded to the payer.
     */
    fun cancelSale() {
        val sale = when (val s = _state.value) {
            is CheckoutState.Approved -> s
            is CheckoutState.Cancelled -> s.sale ?: return
            else -> return
        }
        autoReturn?.cancel()
        if (sale.paidWith == PayMethod.CRYPTO) {
            // Crypto goes back only to an address the customer gives, and its price has moved.
            _state.value = CheckoutState.Cancelled(sale.amount, false, CRYPTO_RETURN)
            return
        }
        _state.value = CheckoutState.Undoing(sale.amount)
        job = scope.launch {
            try {
                val a = api()
                val message = when (sale.paidWith) {
                    PayMethod.CREDIT, PayMethod.DEBIT -> {
                        a.cancel(sale.intentId)
                        "Venda cancelada. O cliente não será cobrado."
                    }
                    PayMethod.PIX -> {
                        a.refund(sale.intentId, sale.amount.centavos)
                        "Venda cancelada. O valor volta ao cliente por Pix."
                    }
                    PayMethod.CRYPTO -> CRYPTO_RETURN
                }
                _state.value = CheckoutState.Cancelled(sale.amount, true, message)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.value = CheckoutState.Cancelled(sale.amount, false,
                    "Não foi possível cancelar agora. A venda continua valendo; tente de novo em instantes.", sale)
            }
        }
    }

    fun card(application: EmvApplication, installments: Int = 1) {
        val s = _state.value as? CheckoutState.ChoosingMethod ?: return
        val amount = s.amount
        job = scope.launch {
            var intentId: String? = null
            var sent = false
            try {
                val authed = api()
                val terminal = authed.session.terminalId
                    ?: return@launch fail(amount, "Este aparelho não tem terminal de cartão. Nenhum valor foi cobrado. Use Pix.")
                val parcelas = installments.takeIf { it > 1 && application == EmvApplication.CREDIT }?.let { Installments(it) }
                val intent = authed.createIntent(IntentCreate(amount = amount.centavos, channel = "card_present", installments = parcelas))
                intentId = intent.id
                val r = reader()
                _state.value = CheckoutState.WaitingForCard(amount, r.name)
                val card = r.read(amount, application)
                // Posture reads files (root, hooks): off the main thread.
                val report = withContext(Dispatchers.Default) { risk.tapped(amount) }
                _state.value = CheckoutState.Authorizing(amount)
                val stanValue = stan.next()
                val tap = journal()?.let { runCatching { it.append("tap_started", JsonObject(mapOf("payment_intent_id" to JsonPrimitive(intent.id),
                    "amount" to Journal.amount(amount.centavos), "terminal_id" to JsonPrimitive(terminal), "stan" to JsonPrimitive(stanValue)))) }.getOrNull() }
                sent = true
                val result = authed.authorize(TerminalAuthorization(intent.id, terminal, stanValue, application.wire,
                    OffsetDateTime.now(ZoneOffset.UTC).withNano(0).toString(), Sred(card.format, card.ksn, card.base64Ciphertext()), tap?.id,
                    DeviceRisk(report.milli / 1000.0, report.model, report.signals)))
                risk.result(result.status)
                log("auth_result", intent.id, amount, "result" to journalResult(result.status), "stan" to stanValue)
                when (val o = outcome(amount, result)) {
                    is CheckoutState.Approved -> approved(o.copy(intentId = intent.id,
                        paidWith = if (application == EmvApplication.DEBIT) PayMethod.DEBIT else PayMethod.CREDIT,
                        method = listOfNotNull(o.method.ifEmpty { null }, parcelas?.let { "${it.count}×" }).joinToString(" · ")))
                    else -> _state.value = o
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                abandon(intentId, sent)
                throw e
            } catch (e: ApiException) {
                abandon(intentId, sent)
                fail(amount, e.problem?.detail?.takeIf { e.status == 409 }
                    ?: "A goonersPAY não autorizou agora. Nenhum valor foi cobrado. Tente de novo ou use Pix.")
            } catch (e: Exception) {
                abandon(intentId, sent)
                fail(amount, if (sent) "Sem resposta da goonersPAY. Se o cartão foi cobrado, a cobrança é desfeita sozinha. Tente de novo."
                else "Sem conexão com a goonersPAY. Nenhum valor foi cobrado. Confira a internet e tente de novo.")
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
        risk.cancelled()
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
                val code = confirmed.nextAction?.brCode ?: return@launch fail(amount, "O Pix não está disponível agora. Nenhum valor foi cobrado. Use o cartão.")
                val decoded = BrCode.decode(code) // a corrupt or foreign code is never shown to the customer
                if (decoded.amount != null && decoded.amount != amount.decimal()) return@launch fail(amount, "O QR Code não confere com o valor. Nenhum valor foi cobrado.")
                _state.value = CheckoutState.PixQr(amount, created.id, code)
                awaitPayment(authed, created.id, amount, "Pix", PayMethod.PIX, "O Pix expirou sem pagamento. Nenhum valor entrou. Gere um novo QR Code.")
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                fail(amount, "Não foi possível gerar o Pix agora. Nenhum valor foi cobrado. Tente de novo.")
            }
        }
    }

    /** A crypto charge: the customer sends a stablecoin; the merchant receives reais (docs/09). */
    fun crypto() {
        val s = _state.value as? CheckoutState.ChoosingMethod ?: return
        val choice = cryptoOffer() ?: return
        val amount = s.amount
        job = scope.launch {
            try {
                val authed = api()
                val created = authed.createIntent(IntentCreate(amount = amount.centavos, channel = "crypto"))
                val a = authed.confirmCrypto(created.id, choice.asset, choice.network).nextAction
                if (a?.type != "crypto_transfer" || a.address == null || a.amount == null) {
                    return@launch fail(amount, "Cripto não está disponível agora. Nenhum valor foi cobrado. Use Pix ou cartão.")
                }
                _state.value = CheckoutState.CryptoQr(amount, created.id, a.asset ?: choice.asset, a.network ?: choice.network, a.amount,
                    a.address, a.memo, a.uri ?: a.address, a.expiresAt.orEmpty())
                awaitPayment(authed, created.id, amount, choice.label, PayMethod.CRYPTO, "A cobrança em cripto expirou sem pagamento. Nenhum valor entrou. Gere outra.")
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                fail(amount, "Não foi possível gerar a cobrança em cripto agora. Nenhum valor foi cobrado. Tente de novo.")
            }
        }
    }

    private suspend fun awaitPayment(authed: GoonersPayApi.Authed, id: String, amount: Money, label: String, method: PayMethod, expired: String) {
        while (true) {
            delay(pixPollMillis)
            val pi = authed.intent(id)
            when (pi.status) {
                "captured" -> {
                    log("auth_result", id, amount, "result" to "approved")
                    approved(CheckoutState.Approved(amount, label, pi.receipt?.claimUrl, null, true, intentId = id, paidWith = method))
                    return
                }
                "canceled", "failed" -> {
                    log("auth_result", id, amount, "result" to "canceled")
                    return fail(amount, expired)
                }
                "processing" -> if (method == PayMethod.CRYPTO) {
                    log("auth_result", id, amount, "result" to "under_review")
                    _state.value = CheckoutState.Reviewing(amount, CRYPTO_REVIEW)
                    return
                }
            }
        }
    }

    private fun fail(amount: Money, message: String) {
        _state.value = CheckoutState.Declined(amount, message)
    }

    companion object {
        const val CRYPTO_REVIEW = "O pagamento chegou e passa por uma verificação de segurança. A venda entra no saldo assim que ela terminar; acompanhe em Vendas. Pode seguir atendendo."
        const val CRYPTO_RETURN = "Venda em cripto não se desfaz pelo app. A venda continua valendo: para devolver, peça o endereço da carteira do cliente e envie pelo console (Cripto › Enviar)."

        /** The journal's result values (nostr/schemas/kind-7714). */
        fun journalResult(status: String): String = when (status) {
            "approved" -> "approved"
            "timeout" -> "timeout"
            else -> "declined"
        }

        fun outcome(amount: Money, r: TerminalResult): CheckoutState = when (r.status) {
            "approved" -> CheckoutState.Approved(amount, listOfNotNull(r.card?.brand?.replaceFirstChar { it.uppercase() }, r.card?.last4?.let { "•••• $it" }).joinToString(" "),
                r.receipt?.claimQr, r.settlement?.netAvailable, r.settlement?.mode == "instant", r.settlement?.held == true)
            "timeout" -> CheckoutState.Declined(amount, "Tempo esgotado. Nenhum valor foi cobrado. Aproxime o cartão de novo.")
            "pin_required" -> CheckoutState.Declined(amount, "Este cartão pede senha. Nenhum valor foi cobrado. Use o débito com senha ou Pix.")
            else -> CheckoutState.Declined(amount, r.customerMessage ?: "Pagamento recusado pelo banco do cliente. Nenhum valor foi cobrado. Tente outro cartão ou Pix.")
        }

        private fun amountOf(s: CheckoutState): Money = when (s) {
            is CheckoutState.Entering -> s.amount
            is CheckoutState.ChoosingMethod -> s.amount
            is CheckoutState.WaitingForCard -> s.amount
            is CheckoutState.Authorizing -> s.amount
            is CheckoutState.PixQr -> s.amount
            is CheckoutState.CryptoQr -> s.amount
            is CheckoutState.Approved -> Money.zero()
            is CheckoutState.Undoing -> Money.zero()
            is CheckoutState.Cancelled -> Money.zero()
            is CheckoutState.Declined -> s.amount
            is CheckoutState.Reviewing -> Money.zero()
        }
    }
}
