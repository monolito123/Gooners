import GoonersPayKit
import SwiftUI
import UIKit

/// Crypto, accounts abroad and B3 (docs/09): what the merchant holds, in reais, and how to
/// receive from abroad; buying and selling quote before they commit.
struct AssetsView: View {
    @Environment(AppModel.self) private var model
    @State private var side = "buy"
    @State private var asset = "USDT"
    @State private var amount = ""

    private static let assets = ["USDT", "USDC", "BTC", "ETH", "USD", "EUR", "GBP"]

    var body: some View {
        let today = Wording.today()
        List {
            Section("Cripto") {
                let crypto = model.holdings.filter { $0.kind == "crypto" }
                if crypto.isEmpty {
                    Text("Sem cripto. Ative \"Aceitar cripto\" em Ajustes para receber em USDT, ou compre abaixo.").foregroundStyle(Theme.textSecondary)
                }
                ForEach(crypto) { h in
                    LabeledContent("\(units(h.amount)) \(h.asset)", value: h.valueBrl.map { "≈ " + Money($0).format() } ?? "sem cotação")
                }
            }
            convert
            Section {
                ForEach(model.accounts) { acc in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Conta em \(acc.currency)").font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(units(acc.amount)) \(acc.currency)").font(.headline).monospacedDigit()
                        }
                        // Progressive disclosure: the bank details one tap down.
                        DisclosureGroup("Dados para receber do exterior") {
                            let r = acc.receive
                            LabeledContent("Titular", value: r.holder)
                            LabeledContent("Banco", value: r.bank)
                            if let v = r.iban { LabeledContent("IBAN", value: v) }
                            if let v = r.bic { LabeledContent("BIC/SWIFT", value: v) }
                            if let v = r.routingNumber { LabeledContent("Routing (ABA)", value: v) }
                            if let v = r.accountNumber { LabeledContent("Conta", value: v) }
                            if let v = r.sortCode { LabeledContent("Sort code", value: v) }
                            LabeledContent("Referência (obrigatória)", value: r.reference).bold()
                            Button("Copiar referência") { UIPasteboard.general.string = r.reference }.buttonStyle(.secondary)
                        }
                    }
                }
            } header: {
                Text("Contas internacionais")
            } footer: {
                Text("Receba de clientes no exterior em dólar, euro ou libra. Converter para reais tem IOF de 0,38%.")
            }
            Section("Investimentos B3") {
                if model.portfolio.positions.isEmpty {
                    Text("Sem posições. Compre ações, FIIs e ETFs pelo console do parceiro.").foregroundStyle(Theme.textSecondary)
                }
                ForEach(model.portfolio.positions) { p in
                    HStack {
                        VStack(alignment: .leading) {
                            Text("\(p.ticker) · \(p.quantity)").bold()
                            Text(p.name ?? "").font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text(p.value.map { Money($0).format() } ?? "—").monospacedDigit()
                            if let r = p.result {
                                Text((r >= 0 ? "+" : "") + Money(r).format()).font(.footnote).monospacedDigit()
                                    .foregroundStyle(r >= 0 ? Theme.positive : Theme.critical)
                            }
                        }
                    }
                }
                ForEach(model.portfolio.orders.filter { $0.status != "settled" }) { o in
                    Text("\(o.side == "buy" ? "Compra" : "Venda") de \(o.quantity) \(o.ticker): liquida \(Wording.day(o.settlesOn ?? "", today: today))")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .refreshable { model.refreshAssets() }
        .onAppear { model.refreshAssets() }
    }

    /// Buy or sell: the price, fee and IOF before any commitment, valid for the countdown.
    @ViewBuilder private var convert: some View {
        Section("Comprar ou vender") {
            if let q = model.conversion {
                Text((q.side == "buy" ? "Você recebe " : "Você vende ") + "\(units(q.amount)) \(q.asset)").font(.headline)
                LabeledContent("Preço por \(q.asset)", value: priceText(q.price))
                LabeledContent("Valor", value: Money(q.brlUnits).format())
                LabeledContent("Tarifa", value: Money(q.fee).format())
                if let tax = q.tax, tax > 0 { LabeledContent("IOF", value: Money(tax).format()) }
                LabeledContent(q.side == "buy" ? "Sai da conta" : "Entra na conta", value: Money(q.total).format()).bold()
                Countdown(expiresAt: q.expiresAt)
                Button("Confirmar") { model.confirmConversion() }.buttonStyle(.primary).disabled(model.busy)
                Button("Desistir", role: .cancel) { model.cancelConversion() }
            } else {
                Picker("Operação", selection: $side) {
                    Text("Comprar com reais").tag("buy")
                    Text("Vender por reais").tag("sell")
                }
                .pickerStyle(.segmented)
                Picker("Ativo", selection: $asset) {
                    ForEach(Self.assets, id: \.self) { Text($0).tag($0) }
                }
                TextField(side == "buy" ? "Quanto em reais (ex.: 150,00)" : "Quanto em \(asset)", text: $amount).keyboardType(.decimalPad)
                Button("Ver cotação") { model.quoteConversion(side: side, asset: asset, amount: amount) }
                    .buttonStyle(.primary)
                    .disabled(model.busy || amount.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let done = model.conversionDone { Text(done).foregroundStyle(Theme.positive) }
        }
    }

    private func units(_ s: String) -> String { s.replacingOccurrences(of: ".", with: ",") }

    /// "352453.50" as "R$ 352.453,50"; small prices keep four decimals ("R$ 5,4123").
    private func priceText(_ price: String) -> String {
        guard let p = Decimal(string: price) else { return price }
        if p >= 100 {
            var cents = p * 100
            var rounded = Decimal()
            NSDecimalRound(&rounded, &cents, 0, .bankers)
            return Money(NSDecimalNumber(decimal: rounded).int64Value).format()
        }
        var v = p
        var r = Decimal()
        NSDecimalRound(&r, &v, 4, .bankers)
        let s = NSDecimalNumber(decimal: r).stringValue
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        let frac = parts.count > 1 ? String(parts[1]) : ""
        return "R$\u{00A0}" + String(parts[0]) + "," + frac.padding(toLength: 4, withPad: "0", startingAt: 0)
    }
}
