import GoonersPayKit
import SwiftUI

// The "Hoje" section of Dinheiro (docs/06 §6) and the small parts the screens share: a small
// caps label over a figure, status chips whose word carries the meaning, and the day's charts
// in the chart colours of the tokens. The words and figures come from the kit (Today.swift),
// the same as the Android app and the web console.

private let brasilia = TimeZone(identifier: "America/Sao_Paulo")!

/// A small caps label over a figure.
struct Overline: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.scale(TypeScale.overline))
            .tracking(TypeScale.overline.tracking * TypeScale.overline.size)
            .foregroundStyle(Theme.textSecondary)
    }
}

/// A key figure: a label, the number, and an optional line under it.
struct Kpi<Below: View>: View {
    let label: String
    let value: String
    var lead = false
    var color = Theme.textPrimary
    var spoken: String?
    @ViewBuilder var below: () -> Below

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Overline(text: label)
            Text(value)
                .font(lead ? Font.scale(TypeScale.kpi) : Font.scale(TypeScale.title).monospacedDigit())
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .accessibilityLabel(spoken.map { "\(label): \($0)" } ?? "\(label): \(value)")
            below()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension Kpi where Below == EmptyView {
    init(label: String, value: String, lead: Bool = false, color: Color = Theme.textPrimary, spoken: String? = nil) {
        self.init(label: label, value: value, lead: lead, color: color, spoken: spoken) { EmptyView() }
    }
}

extension Theme {
    /// The colour of a chip's tone.
    static func tone(_ t: Today.Tone) -> Color {
        switch t {
        case .positive: positive
        case .attention: warning
        case .alert: critical
        case .info: info
        case .neutral: textSecondary
        }
    }
}

/// A payment's state: a dot and a word on a raised pill.
struct StatusChip: View {
    let status: String
    var body: some View {
        let (label, tone) = Today.status(status)
        HStack(spacing: 6) {
            Circle().fill(Theme.tone(tone)).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(label).font(.scale(TypeScale.caption).weight(.semibold))
        }
        .foregroundStyle(Theme.tone(tone))
        .padding(.horizontal, 10)
        .padding(.vertical, 2)
        .background(Theme.surfaceRaised, in: Capsule())
    }
}

/// The day's sales per hour as bars; empty hours keep a short baseline so the day's shape reads.
struct HourlyBars: View {
    let hourly: [Int64]

    var body: some View {
        let top = CGFloat(Swift.max(hourly.max() ?? 0, 1))
        let peak = Today.peakHour(hourly)
        VStack(spacing: Space.xs) {
            GeometryReader { g in
                let scale: CGFloat = (g.size.height - 4) / top
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(hourly.indices, id: \.self) { i in
                        let v = CGFloat(hourly[i])
                        let h: CGFloat = v > 0 ? Swift.max(3, v * scale) : 2
                        RoundedRectangle(cornerRadius: 2)
                            .fill(v > 0 ? Theme.actionText : Theme.border)
                            .frame(height: h)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .frame(height: 64)
            HStack {
                ForEach(["0h", "6h", "12h", "18h", "23h"], id: \.self) { t in
                    Text(t).font(.scale(TypeScale.caption)).foregroundStyle(Theme.textSecondary)
                    if t != "23h" { Spacer() }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(peak.map { "Vendas por hora; o pico foi às \($0)h, com \(Money(hourly[$0]).format())" } ?? "Sem vendas por hora")
    }
}

/// How customers paid: one bar split by method, then a legend with amounts and shares.
struct MethodMix: View {
    let parts: [MethodTotal]

    var body: some View {
        let shares = Today.shares(parts.map(\.gross))
        let total = CGFloat(Swift.max(1, parts.reduce(0) { $0 + $1.gross }))
        VStack(alignment: .leading, spacing: Space.sm) {
            GeometryReader { g in
                let room: CGFloat = g.size.width - CGFloat(parts.count - 1) * 2
                HStack(spacing: 2) {
                    ForEach(parts, id: \.self) { p in
                        let w: CGFloat = Swift.max(4, room * CGFloat(p.gross) / total)
                        Rectangle().fill(Theme.method(p.method)).frame(width: w)
                    }
                }
            }
            .frame(height: 12)
            .background(Theme.surfaceRaised)
            .clipShape(Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(parts.indices.map { "\(Today.method(parts[$0].method)) \(shares[$0])%" }.joined(separator: ", "))
            ForEach(parts.indices, id: \.self) { i in
                let p = parts[i]
                HStack(spacing: Space.sm) {
                    RoundedRectangle(cornerRadius: 3).fill(Theme.method(p.method)).frame(width: 12, height: 12).accessibilityHidden(true)
                    Text(Today.method(p.method))
                    Spacer()
                    Text(Money(p.gross).format()).monospacedDigit()
                    Text("\(shares[i])%").monospacedDigit().foregroundStyle(Theme.textSecondary).frame(minWidth: 44, alignment: .trailing)
                }
                .font(.subheadline)
            }
        }
    }
}

/// Today in one section (docs/06 §6): what was sold and what the merchant keeps, against the
/// same weekday last week, the shape of the day, how customers paid and what still waits.
struct TodaySection: View {
    let day: DaySummary

    var body: some View {
        let isToday = day.date == todayISO()
        Section {
            VStack(alignment: .leading, spacing: Space.md) {
                Kpi(label: "Vendido", value: Money(day.gross).format(), lead: true, spoken: Money(day.gross).spoken()) { delta(isToday) }
                HStack(alignment: .top, spacing: Space.lg) {
                    Kpi(label: "Você recebe", value: Money(day.net).format(), color: Theme.positive, spoken: Money(day.net).spoken()) {
                        Text(day.fees > 0 ? "\(Money(day.fees).format()) de taxas" : "Sem taxas").font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    Kpi(label: "Vendas", value: String(day.sales))
                    Kpi(label: "Ticket médio", value: Money(day.averageTicket).format(), spoken: Money(day.averageTicket).spoken())
                }
                if day.sales > 0 {
                    Overline(text: "Por hora").padding(.top, Space.xs)
                    HourlyBars(hourly: day.hourly)
                    Overline(text: "Como pagaram").padding(.top, Space.xs)
                    MethodMix(parts: day.byMethod)
                } else {
                    Text(isToday ? "Nenhuma venda ainda hoje. A primeira aparece aqui na hora." : "Nenhuma venda neste dia.")
                        .font(.subheadline).foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.vertical, Space.xs)
            if day.waiting.count > 0 {
                Label {
                    HStack {
                        Text(day.waiting.count == 1 ? "1 cobrança aguardando" : "\(day.waiting.count) cobranças aguardando").font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(Money(day.waiting.amount).format()).monospacedDigit()
                    }
                } icon: {
                    Image(systemName: AppIcon.clock).foregroundStyle(Theme.warning)
                }
            }
        } header: {
            HStack {
                Text(isToday ? "Hoje" : "Dia")
                Spacer()
                Text(longDay(day.date)).textCase(nil)
            }
        }
    }

    @ViewBuilder private func delta(_ isToday: Bool) -> some View {
        if let lw = day.lastWeek, let change = Today.change(lw.changePct), let pct = lw.changePct {
            let c = pct > 0 ? Theme.positive : pct < 0 ? Theme.critical : Theme.textSecondary
            HStack(spacing: Space.xs) {
                if pct != 0 { Image(systemName: pct > 0 ? AppIcon.up : AppIcon.down).font(.caption.weight(.bold)) }
                Text(change).font(.subheadline.weight(.semibold)).monospacedDigit()
                Text(Today.versus(lw.date, today: isToday)).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            .foregroundStyle(c)
        } else {
            Text("Sem vendas no mesmo dia da semana passada").font(.caption).foregroundStyle(Theme.textSecondary)
        }
    }

    private func todayISO() -> String {
        let t = Wording.today()
        return String(format: "%04d-%02d-%02d", t.year ?? 0, t.month ?? 0, t.day ?? 0)
    }

    private func longDay(_ iso: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "pt_BR")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: iso) else { return iso }
        f.dateFormat = "EEEE, d 'de' MMMM"
        return f.string(from: d)
    }
}

/// The day's latest payments with their state.
struct RecentSalesSection: View {
    let rows: [RecentPayment]

    var body: some View {
        Section("Últimas vendas") {
            ForEach(rows) { p in
                HStack(spacing: Space.md) {
                    Circle().fill(Theme.surfaceRaised).frame(width: 36, height: 36)
                        .overlay(Circle().fill(Theme.method(p.method)).frame(width: 10, height: 10))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.card ?? Today.method(p.method)).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text([time(p.createdAt), p.card != nil ? Today.method(p.method) : nil].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Money(p.amount).format()).monospacedDigit()
                        StatusChip(status: p.status)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func time(_ iso: String) -> String? {
        let parse = ISO8601DateFormatter()
        guard let d = parse.date(from: iso) else { return nil }
        let f = DateFormatter()
        f.timeZone = brasilia
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}
