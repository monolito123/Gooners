import Foundation

/// The words and figures of the "Hoje" card (docs/06 §6), the same in both apps and the web
/// console: how customers paid, each payment's state as a word (the colour only repeats it),
/// the mix in whole percent, and the change against the same weekday last week. The Android
/// core has the same functions (Today.kt); the tests hold both to the same cases.
public enum Today {
    /// How a state reads: the tone picks the chip's colour role.
    public enum Tone: Sendable { case positive, attention, alert, info, neutral }

    private static let methods = ["credit": "Crédito", "debit": "Débito", "prepaid": "Pré-pago", "card": "Cartão", "pix": "Pix", "crypto": "Cripto"]

    /// A payment method in the merchant's words; an unknown one reads as its code.
    public static func method(_ code: String) -> String { methods[code] ?? code.replacingOccurrences(of: "_", with: " ") }

    /// The chart colour family of a method: credit, debit, pix, crypto, or other.
    public static func chart(_ code: String) -> String { ["credit", "debit", "pix", "crypto"].contains(code) ? code : "other" }

    private static let statuses: [String: (String, Tone)] = [
        "captured": ("Paga", .positive), "partially_refunded": ("Estorno parcial", .attention), "refunded": ("Estornada", .info),
        "requires_payment_method": ("Aguardando", .attention), "requires_action": ("Aguardando", .attention), "processing": ("Aguardando", .attention),
        "failed": ("Recusada", .alert), "canceled": ("Cancelada", .neutral),
    ]

    /// A payment's state as a word and a tone.
    public static func status(_ code: String) -> (label: String, tone: Tone) {
        statuses[code] ?? (code.replacingOccurrences(of: "_", with: " "), .neutral)
    }

    /// Each part's share in whole percent, adding up to exactly 100 (largest remainder), in
    /// the order given. All zeros stay zeros.
    public static func shares(_ parts: [Int64]) -> [Int] {
        let total = parts.reduce(0, +)
        guard total > 0 else { return parts.map { _ in 0 } }
        let exact = parts.map { Double($0) * 100 / Double(total) }
        var out = exact.map { Int($0) }
        let left = 100 - out.reduce(0, +)
        let order = exact.indices.sorted { a, b in
            let ra = exact[a] - Double(out[a]), rb = exact[b] - Double(out[b])
            return ra != rb ? ra > rb : a < b
        }
        for i in order.prefix(left) { out[i] += 1 }
        return out
    }

    /// "+50%", "−12,5%" (a true minus sign), "0%"; nil when there is nothing to compare with.
    public static func change(_ pct: Double?) -> String? {
        guard let pct else { return nil }
        let a = abs(pct)
        let n = a == a.rounded(.down) ? String(Int64(a)) : String(format: "%.1f", a).replacingOccurrences(of: ".", with: ",")
        return pct > 0 ? "+\(n)%" : pct < 0 ? "−\(n)%" : "0%"
    }

    private static let weekdays = ["domingo passado", "segunda passada", "terça passada", "quarta passada", "quinta passada", "sexta passada", "sábado passado"]

    /// "vs. sexta passada até agora" for today; "vs. domingo passado" for a past day.
    public static func versus(_ lastWeekDate: String, today: Bool) -> String {
        let p = lastWeekDate.prefix(10).split(separator: "-").compactMap { Int($0) }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard p.count == 3, let d = cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return "vs. semana passada" }
        return "vs. " + weekdays[cal.component(.weekday, from: d) - 1] + (today ? " até agora" : "")
    }

    /// The hour that sold the most, or nil on a day with no sales.
    public static func peakHour(_ hourly: [Int64]) -> Int? {
        guard let max = hourly.max(), max > 0 else { return nil }
        return hourly.firstIndex(of: max)
    }
}
