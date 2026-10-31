import Foundation

/// The words the apps use for money (docs/06 §6): time instead of jargon, the ledger in the
/// merchant's terms, and errors that say what happened, what it means for the money and what
/// to do next. The Android core has the same table (Wording.kt); the tests hold both to it.
public enum Wording {
    private static let brasilia = TimeZone(identifier: "America/Sao_Paulo")!

    /// The calendar day in Brasília of a date.
    public static func today(_ now: Date = Date()) -> DateComponents {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = brasilia
        return cal.dateComponents([.year, .month, .day], from: now)
    }

    /// "hoje", "amanhã", "ontem", "28/11", or "28/11/2027" outside this year, for "2026-11-28".
    public static func day(_ iso: String, today: DateComponents) -> String {
        let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let ty = today.year, let tm = today.month, let td = today.day else { return iso }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let d = cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2])),
              let t = cal.date(from: DateComponents(year: ty, month: tm, day: td)) else { return iso }
        switch cal.dateComponents([.day], from: t, to: d).day {
        case 0: return "hoje"
        case 1: return "amanhã"
        case -1: return "ontem"
        default:
            let dm = String(format: "%02d/%02d", p[2], p[1])
            return p[0] == ty ? dm : dm + "/\(p[0])"
        }
    }

    private static let entries: [String: String] = [
        "card_capture": "Venda no cartão", "card_capture_reversal": "Venda no cartão desfeita", "pix_received": "Pix recebido",
        "refund": "Estorno", "pix_refund_send": "Estorno por Pix", "pix_refund_confirm": "Estorno por Pix confirmado",
        "pix_refund_returned": "Estorno por Pix devolvido", "pix_med_return": "Devolução Pix (MED)", "chargeback": "Contestação",
        "chargeback_won": "Contestação ganha", "payout_send": "Saque por Pix", "payout_confirm": "Saque confirmado",
        "payout_returned": "Saque devolvido", "scheme_settlement": "Liquidação da bandeira", "crypto_settle": "Pagamento em cripto",
        "crypto_deposit": "Depósito em cripto", "crypto_sale": "Venda de cripto", "crypto_withdrawal": "Envio de cripto",
        "crypto_withdrawal_reversed": "Envio de cripto devolvido", "conversion": "Conversão", "fx_credit": "Recebido do exterior",
        "international_payout": "Pagamento no exterior", "international_payout_reversed": "Pagamento no exterior devolvido",
        "investment_buy": "Compra na B3", "investment_settlement": "Liquidação na B3",
    ]

    /// A ledger entry's type in the merchant's words; an unknown type reads as its code.
    public static func entry(_ type: String) -> String { entries[type] ?? type.replacingOccurrences(of: "_", with: " ") }

    /// An API failure as a calm sentence.
    public static func calm(status: Int, detail: String?) -> String {
        let d = detail ?? ""
        switch status {
        case 0: return "Sem conexão com a goonersPAY. Nada foi enviado. Confira a internet e tente de novo."
        case 401: return "A sessão deste aparelho terminou. Nada mudou. Abra o app de novo."
        case 403: return "Este aparelho não pode fazer isso. Peça ao dono da loja."
        case 410: return "A cotação expirou. O preço anterior não vale mais: peça outra."
        default: break
        }
        if d.contains("insufficient funds") || d.contains("holds less than") { return "Saldo insuficiente. Nada foi cobrado. Use um valor menor." }
        switch status {
        case 422: return "Algo no pedido não confere: \(d)"
        case 409: return "Não foi possível agora: \(d)"
        case 503: return "Um parceiro não respondeu. Nenhum dinheiro saiu. Tente de novo em instantes."
        default: return "A goonersPAY não concluiu o pedido. Nada foi cobrado. Tente de novo. (HTTP \(status))"
        }
    }
}
