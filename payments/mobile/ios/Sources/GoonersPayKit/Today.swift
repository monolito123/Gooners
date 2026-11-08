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

    // MARK: charts

    /// Methods in a fixed order, so each keeps its place and colour from one day to the next.
    private static let order = ["credit", "debit", "prepaid", "card", "pix", "crypto"]

    public static func ordered(_ parts: [MethodTotal]) -> [MethodTotal] {
        parts.sorted { a, b in
            let ia = order.firstIndex(of: a.method) ?? order.count, ib = order.firstIndex(of: b.method) ?? order.count
            return ia != ib ? ia < ib : a.method < b.method
        }
    }

    /// An axis label: "R$ 900", "R$ 2,5 mil", "R$ 12 mil", "R$ 1,3 mi". Whole numbers from ten
    /// up, one decimal below, rounded half up on whole centavos so every platform agrees.
    public static func compact(_ centavos: Int64) -> String {
        let c = Swift.max(0, centavos)
        let reais = (c + 50) / 100
        if reais < 1_000 { return "R$ \(reais)" }
        if reais < 1_000_000 { return "R$ " + tenths((c + 5_000) / 10_000, whole: reais >= 10_000) + " mil" }
        return "R$ " + tenths((c + 5_000_000) / 10_000_000, whole: reais >= 10_000_000) + " mi"
    }

    private static func tenths(_ t: Int64, whole: Bool) -> String {
        if whole { return String((t + 5) / 10) }
        return t % 10 == 0 ? String(t / 10) : "\(t / 10),\(t % 10)"
    }

    /// The y-axis lines from 0 up to the first clean step at or above max, three steps at most:
    /// steps of 1, 2, 2.5 or 5 times a power of ten, in whole reais.
    public static func ticks(_ max: Int64) -> [Int64] {
        if max <= 0 { return [0, 10_000] }
        let raw = (max + 2) / 3
        var p: Int64 = 100 // R$ 1: no step smaller
        while p * 10 <= raw { p *= 10 }
        let step = [10, 20, 25, 50, 100].map { Int64($0) * p / 10 }.first { $0 >= raw && $0 >= 100 } ?? p * 10
        let n = (max + step - 1) / step
        return (0...n).map { $0 * step }
    }

    /// Which buckets get an x-axis label: every one up to 8, else about six, the last always.
    public static func axis(_ n: Int) -> [Int] {
        if n <= 8 { return Array(0..<n) }
        if n == 24 { return [0, 6, 12, 18, 23] }
        let step = (n - 1 + 4) / 5
        var out = Array(stride(from: 0, to: n - 1 - step / 2, by: step))
        out.append(n - 1)
        return out
    }

    private static let weekdayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]

    private static func ddMM(_ iso: String) -> String {
        let p = iso.prefix(10).split(separator: "-")
        return p.count == 3 ? "\(p[2])/\(p[1])" : iso
    }

    private static func weekday(_ iso: String) -> String? {
        let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard p.count == 3, let d = cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return nil }
        return weekdayNames[cal.component(.weekday, from: d) - 1]
    }

    /// A chart, ready to draw: a day by hour or a period by day, against what it is compared with.
    public struct SalesView: Sendable, Equatable {
        public var title: String
        public var range: String
        public var gross: Int64
        public var net: Int64
        public var fees: Int64
        public var refunded: Int64
        public var sales: Int64
        public var averageTicket: Int64
        /// "+50%", or nil when there is nothing to compare with.
        public var change: String?
        public var changeSign: Int
        public var versus: String
        /// The two series, for the legend and the readout.
        public var focusName: String
        public var compareName: String
        public var buckets: [Int64]
        /// As long as buckets; empty when there is no comparison.
        public var compare: [Int64]
        /// Short labels ("11h", "05/11") and spoken ones ("11h às 12h", "quarta, 05/11").
        public var labels: [String]
        public var spoken: [String]
        public var axis: [Int]
        public var ticks: [Int64]
        public var byMethod: [MethodTotal]
        public var shares: [Int]
        public var waitingCount: Int64
        public var waitingAmount: Int64
        public var empty: String
    }

    private static func sign(_ pct: Double?) -> Int {
        guard let pct, pct != 0 else { return 0 }
        return pct > 0 ? 1 : -1
    }

    /// A day by hour, against the same weekday last week.
    public static func dayView(_ d: DaySummary, today: Bool) -> SalesView {
        let buckets = d.hourly.isEmpty ? Array(repeating: Int64(0), count: 24) : d.hourly
        let compare = (d.lastWeek?.hourly).flatMap { $0.count == buckets.count ? $0 : nil } ?? []
        let parts = ordered(d.byMethod)
        let pct = d.lastWeek?.changePct
        let vs = d.lastWeek.map { versus($0.date, today: today) } ?? "vs. semana passada"
        var name = vs.hasPrefix("vs. ") ? String(vs.dropFirst(4)) : vs
        if name.hasSuffix(" até agora") { name = String(name.dropLast(10)) }
        return SalesView(
            title: today ? "Hoje" : "Dia", range: ddMM(d.date),
            gross: d.gross, net: d.net, fees: d.fees, refunded: d.refunded, sales: d.sales, averageTicket: d.averageTicket,
            change: change(pct), changeSign: sign(pct), versus: vs,
            focusName: today ? "Hoje" : ddMM(d.date), compareName: name,
            buckets: buckets, compare: compare,
            labels: buckets.indices.map { "\($0)h" }, spoken: buckets.indices.map { "\($0)h às \(($0 + 1) % 24)h" },
            axis: axis(buckets.count), ticks: ticks(Swift.max(buckets.max() ?? 0, compare.max() ?? 0)),
            byMethod: parts, shares: shares(parts.map(\.gross)),
            waitingCount: d.waiting.count, waitingAmount: d.waiting.amount,
            empty: today ? "Nenhuma venda ainda hoje. A primeira aparece aqui na hora." : "Nenhuma venda neste dia.")
    }

    /// A period by day, against the period just before; today is YYYY-MM-DD in Brasília.
    public static func periodView(_ p: PeriodSummary, today: String) -> SalesView {
        let endsToday = p.to == today
        let buckets = p.daily.map(\.gross)
        let compare = p.previous.daily.count == buckets.count ? p.previous.daily : []
        let parts = ordered(p.byMethod)
        let pct = p.previous.changePct
        return SalesView(
            title: endsToday ? "Últimos \(p.days) dias" : "\(p.days) dias", range: "\(ddMM(p.from)) a \(ddMM(p.to))",
            gross: p.gross, net: p.net, fees: p.fees, refunded: p.refunded, sales: p.sales, averageTicket: p.averageTicket,
            change: change(pct), changeSign: sign(pct), versus: "vs. os \(p.days) dias anteriores" + (endsToday ? " até agora" : ""),
            focusName: "Estes \(p.days) dias", compareName: "\(p.days) dias anteriores",
            buckets: buckets, compare: compare,
            labels: p.daily.map { ddMM($0.date) }, spoken: p.daily.map { d in weekday(d.date).map { "\($0), \(ddMM(d.date))" } ?? ddMM(d.date) },
            axis: axis(buckets.count), ticks: ticks(Swift.max(buckets.max() ?? 0, compare.max() ?? 0)),
            byMethod: parts, shares: shares(parts.map(\.gross)),
            waitingCount: 0, waitingAmount: 0, empty: "Nenhuma venda nestes \(p.days) dias.")
    }
}
