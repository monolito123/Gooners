package br.com.gooners.pay.core.wording

import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * The words the apps use for money (docs/06 §6): time instead of jargon, the ledger in the
 * merchant's terms, and errors that say what happened, what it means for the money and what
 * to do next. The iOS kit has the same table (Wording.swift); the tests hold both to it.
 */
object Wording {
    private val dayMonth = DateTimeFormatter.ofPattern("dd/MM")
    private val full = DateTimeFormatter.ofPattern("dd/MM/yyyy")

    /** "hoje", "amanhã", "ontem", "28/11", or "28/11/2027" outside this year. */
    fun day(date: LocalDate, today: LocalDate): String = when (date) {
        today -> "hoje"
        today.plusDays(1) -> "amanhã"
        today.minusDays(1) -> "ontem"
        else -> if (date.year == today.year) date.format(dayMonth) else date.format(full)
    }

    /** "2026-11-28", as the API sends it. */
    fun day(iso: String, today: LocalDate): String = runCatching { day(LocalDate.parse(iso.take(10)), today) }.getOrDefault(iso)

    private val entries = mapOf(
        "card_capture" to "Venda no cartão", "card_capture_reversal" to "Venda no cartão desfeita", "pix_received" to "Pix recebido",
        "refund" to "Estorno", "pix_refund_send" to "Estorno por Pix", "pix_refund_confirm" to "Estorno por Pix confirmado",
        "pix_refund_returned" to "Estorno por Pix devolvido", "pix_med_return" to "Devolução Pix (MED)", "chargeback" to "Contestação",
        "chargeback_won" to "Contestação ganha", "payout_send" to "Saque por Pix", "payout_confirm" to "Saque confirmado",
        "payout_returned" to "Saque devolvido", "scheme_settlement" to "Liquidação da bandeira", "crypto_settle" to "Pagamento em cripto",
        "crypto_deposit" to "Depósito em cripto", "crypto_sale" to "Venda de cripto", "crypto_withdrawal" to "Envio de cripto",
        "crypto_withdrawal_reversed" to "Envio de cripto devolvido", "conversion" to "Conversão", "fx_credit" to "Recebido do exterior",
        "international_payout" to "Pagamento no exterior", "international_payout_reversed" to "Pagamento no exterior devolvido",
        "investment_buy" to "Compra na B3", "investment_settlement" to "Liquidação na B3",
    )

    /** A ledger entry's type in the merchant's words; an unknown type reads as its code. */
    fun entry(type: String): String = entries[type] ?: type.replace('_', ' ')

    /** An API failure as a calm sentence. */
    fun calm(status: Int, detail: String?): String {
        val d = detail.orEmpty()
        return when {
            status == 0 -> "Sem conexão com a goonersPAY. Nada foi enviado. Confira a internet e tente de novo."
            status == 401 -> "A sessão deste aparelho terminou. Nada mudou. Abra o app de novo."
            status == 403 -> "Este aparelho não pode fazer isso. Peça ao dono da loja."
            status == 410 -> "A cotação expirou. O preço anterior não vale mais: peça outra."
            "insufficient funds" in d || "holds less than" in d -> "Saldo insuficiente. Nada foi cobrado. Use um valor menor."
            status == 422 -> "Algo no pedido não confere: $d"
            status == 409 -> "Não foi possível agora: $d"
            status == 503 -> "Um parceiro não respondeu. Nenhum dinheiro saiu. Tente de novo em instantes."
            else -> "A goonersPAY não concluiu o pedido. Nada foi cobrado. Tente de novo. (HTTP $status)"
        }
    }
}
