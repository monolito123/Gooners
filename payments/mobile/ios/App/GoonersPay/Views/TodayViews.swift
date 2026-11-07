import Charts
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

/// A sales chart (docs/06 §8): bars for the series it is about, a line for what it is compared
/// with, one y axis with clean ticks and a hairline grid. Touching or dragging picks a bucket,
/// with a selection tick, and the readout above shows every series there; VoiceOver reads each
/// bar with its values, and Swift Charts adds the audio graph.
struct SalesChart: View {
    let view: Today.SalesView
    @State private var selected: String?

    private struct Point: Identifiable {
        let id: Int
        let label: String
        let value: Double
        let compare: Double?
    }

    private var hasCompare: Bool { view.compare.count == view.buckets.count }
    private var unit: String { view.labels.first?.hasSuffix("h") == true ? "hora" : "dia" }

    var body: some View {
        let points = view.buckets.indices.map { i in
            Point(id: i, label: view.labels[i], value: Double(view.buckets[i]) / 100, compare: hasCompare ? Double(view.compare[i]) / 100 : nil)
        }
        let top = Double(view.ticks.last ?? 100) / 100
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.lg) {
                LegendKey(color: Theme.chartFocus, line: false, label: view.focusName)
                if hasCompare { LegendKey(color: Theme.chartCompare, line: true, label: view.compareName) }
            }
            readout
            Chart {
                ForEach(points) { p in
                    BarMark(x: .value("Quando", p.label), y: .value("Vendas", p.value), width: .ratio(0.62))
                        .foregroundStyle(Theme.chartFocus.opacity(selected == nil || selected == p.label ? 1 : 0.55))
                        .cornerRadius(4)
                        .accessibilityLabel(view.spoken[p.id])
                        .accessibilityValue(spokenValues(p.id))
                }
                if hasCompare {
                    ForEach(points) { p in
                        LineMark(x: .value("Quando", p.label), y: .value("Vendas", p.compare ?? 0), series: .value("Série", "compare"))
                            .foregroundStyle(Theme.chartCompare)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                            .accessibilityHidden(true)
                    }
                }
                if let selected {
                    RuleMark(x: .value("Quando", selected))
                        .foregroundStyle(Theme.textSecondary.opacity(0.6))
                        .lineStyle(StrokeStyle(lineWidth: 1))
                        .accessibilityHidden(true)
                }
            }
            .chartYScale(domain: 0...top)
            .chartYAxis {
                AxisMarks(position: .leading, values: view.ticks.map { Double($0) / 100 }) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 1)).foregroundStyle(Theme.chartGrid)
                    AxisValueLabel {
                        if let reais = value.as(Double.self) { Text(Today.compact(Int64((reais * 100).rounded()))) }
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: view.axis.map { view.labels[$0] }) { _ in AxisValueLabel() }
            }
            .chartLegend(.hidden)
            .chartXSelection(value: $selected)
            .sensoryFeedback(.selection, trigger: selected)
            .frame(height: 200)
        }
    }

    /// Values lead, names follow.
    @ViewBuilder private var readout: some View {
        if let selected, let i = view.labels.firstIndex(of: selected) {
            VStack(alignment: .leading, spacing: 2) {
                Text(view.spoken[i]).font(.caption).foregroundStyle(Theme.textSecondary)
                HStack(spacing: Space.md) {
                    Text(Money(view.buckets[i]).format()).font(.subheadline.weight(.semibold)).monospacedDigit()
                    if hasCompare {
                        LegendKey(color: Theme.chartCompare, line: true, label: "")
                        Text(Money(view.compare[i]).format() + " " + view.compareName).font(.caption).monospacedDigit().foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .frame(minHeight: 40, alignment: .leading)
            .accessibilityHidden(true)
        } else {
            Text("Toque ou arraste no gráfico para ver cada \(unit)")
                .font(.caption).foregroundStyle(Theme.textSecondary)
                .frame(minHeight: 40, alignment: .leading)
                .accessibilityHidden(true)
        }
    }

    private func spokenValues(_ i: Int) -> String {
        "\(view.focusName) \(Money(view.buckets[i]).spoken())" + (hasCompare ? "; \(view.compareName) \(Money(view.compare[i]).spoken())" : "")
    }
}

/// A legend key: a block for bars, a short stroke for a line.
struct LegendKey: View {
    let color: Color
    let line: Bool
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            if line {
                Capsule().fill(color).frame(width: 16, height: 2)
            } else {
                RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 10, height: 10)
            }
            if !label.isEmpty { Text(label).font(.caption).foregroundStyle(Theme.textSecondary) }
        }
        .accessibilityHidden(true)
    }
}

/// How customers paid: a thin bar split by method in a fixed order, then the list that names them.
struct MethodMix: View {
    let view: Today.SalesView

    var body: some View {
        let parts = view.byMethod
        let total = CGFloat(Swift.max(1, parts.reduce(0) { $0 + $1.gross }))
        VStack(alignment: .leading, spacing: Space.sm) {
            GeometryReader { g in
                let room: CGFloat = g.size.width - CGFloat(Swift.max(0, parts.count - 1)) * 2
                HStack(spacing: 2) {
                    ForEach(parts.indices, id: \.self) { i in
                        let w: CGFloat = Swift.max(4, room * CGFloat(parts[i].gross) / total)
                        Rectangle().fill(Theme.method(parts[i].method)).frame(width: w)
                    }
                }
            }
            .frame(height: 8)
            .clipShape(Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(parts.indices.map { "\(Today.method(parts[$0].method)) \(view.shares[$0])%" }.joined(separator: ", "))
            ForEach(parts.indices, id: \.self) { i in
                let p = parts[i]
                HStack(spacing: Space.sm) {
                    RoundedRectangle(cornerRadius: 3).fill(Theme.method(p.method)).frame(width: 12, height: 12).accessibilityHidden(true)
                    Text(Today.method(p.method))
                    Spacer()
                    Text(Money(p.gross).format()).monospacedDigit()
                    Text("\(view.shares[i])%").monospacedDigit().foregroundStyle(Theme.textSecondary).frame(minWidth: 44, alignment: .trailing)
                }
                .font(.subheadline)
            }
        }
    }
}

/// The sales section (docs/06 §6): what was sold and what the merchant keeps, against what it is
/// compared with, the shape of the period, how customers paid and what still waits. While the
/// next period loads the section stays, dimmed, so nothing jumps.
struct SalesSection: View {
    let view: Today.SalesView
    var refreshing = false

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: Space.md) {
                Kpi(label: "Vendido", value: Money(view.gross).format(), lead: true, spoken: Money(view.gross).spoken()) { delta }
                HStack(alignment: .top, spacing: Space.lg) {
                    Kpi(label: "Você recebe", value: Money(view.net).format(), color: Theme.positive, spoken: Money(view.net).spoken()) {
                        Text(view.fees > 0 ? "\(Money(view.fees).format()) de taxas" : "Sem taxas").font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    Kpi(label: "Vendas", value: String(view.sales))
                    Kpi(label: "Ticket médio", value: Money(view.averageTicket).format(), spoken: Money(view.averageTicket).spoken())
                }
                if view.sales > 0 || view.compare.contains(where: { $0 > 0 }) {
                    Overline(text: view.buckets.count == 24 ? "Por hora" : "Por dia").padding(.top, Space.xs)
                    SalesChart(view: view)
                }
                if view.sales > 0 {
                    Overline(text: "Como pagaram").padding(.top, Space.xs)
                    MethodMix(view: view)
                } else {
                    Text(view.empty).font(.subheadline).foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.vertical, Space.xs)
            .opacity(refreshing ? 0.5 : 1)
            if view.waitingCount > 0 {
                Label {
                    HStack {
                        Text(view.waitingCount == 1 ? "1 cobrança aguardando" : "\(view.waitingCount) cobranças aguardando").font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(Money(view.waitingAmount).format()).monospacedDigit()
                    }
                } icon: {
                    Image(systemName: AppIcon.clock).foregroundStyle(Theme.warning)
                }
            }
        } header: {
            HStack {
                Text(view.title)
                Spacer()
                Text(view.range).textCase(nil)
            }
        }
    }

    @ViewBuilder private var delta: some View {
        if let change = view.change {
            let c = view.changeSign > 0 ? Theme.positive : view.changeSign < 0 ? Theme.critical : Theme.textSecondary
            HStack(spacing: Space.xs) {
                if view.changeSign != 0 { Image(systemName: view.changeSign > 0 ? AppIcon.up : AppIcon.down).font(.caption.weight(.bold)) }
                Text(change).font(.subheadline.weight(.semibold)).monospacedDigit()
                Text(view.versus).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            .foregroundStyle(c)
        } else {
            let at = view.compareName.hasSuffix("passado") ? "no" : view.compareName.hasSuffix("passada") ? "na" : "nos"
            Text("Sem vendas \(at) \(view.compareName) para comparar").font(.caption).foregroundStyle(Theme.textSecondary)
        }
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
