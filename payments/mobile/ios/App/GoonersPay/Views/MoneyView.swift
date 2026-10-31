import GoonersPayKit
import SwiftUI

struct MoneyView: View {
    @Environment(AppModel.self) private var model
    @State private var amount = ""
    @State private var keyType = "cpf"
    @State private var key = ""
    /// Progressive disclosure: the payout form opens from the balance's one action.
    @State private var payingOut = false

    private static let keyTypes = ["cpf", "cnpj", "email", "phone", "evp"]
    private static let keyTypeNames = ["cpf": "CPF", "cnpj": "CNPJ", "email": "E-mail", "phone": "Telefone", "evp": "Aleatória"]

    var body: some View {
        let today = Wording.today()
        List {
            // One number first (docs/06 §6).
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Disponível agora").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textSecondary)
                    Text(model.balance.map { Money($0.available).format() } ?? "—")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Theme.positive)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .accessibilityLabel(model.balance.map { "Disponível agora: " + Money($0.available).spoken() } ?? "Carregando")
                    if !payingOut && model.quote == nil {
                        Button("Sacar por Pix") { payingOut = true }.buttonStyle(.primary).disabled((model.balance?.available ?? 0) <= 0)
                    }
                }
                .padding(.vertical, 4)
            }
            if payingOut || model.quote != nil { payout }
            if let b = model.balance {
                Section("A receber") {
                    LabeledContent("Total", value: Money(b.pending).format()).bold()
                    // Time, not jargon: "amanhã", "28/11", never "D+30".
                    ForEach(b.pendingByDate ?? [], id: \.self) { d in
                        LabeledContent(Wording.day(d.date, today: today).capitalizedFirst, value: Money(d.amount).format())
                    }
                    if (b.pendingByDate ?? []).isEmpty { Text("Nada a receber por enquanto.").foregroundStyle(Theme.textSecondary) }
                    if let held = b.held, held > 0 {
                        Text("Retido para análise: \(Money(held).format()). Seu dinheiro está seguro; avisamos quando for liberado.")
                            .font(.footnote).foregroundStyle(Theme.warning)
                    }
                    if let r = b.reserved, r > 0 { LabeledContent("Reserva de garantia", value: Money(r).format()).foregroundStyle(Theme.textSecondary) }
                }
            }
            Section {
                if model.settlements.isEmpty {
                    Text("O extrato de um dia sai depois da 1h do dia seguinte.").font(.footnote).foregroundStyle(Theme.textSecondary)
                }
                ForEach(model.settlements) { s in
                    Button { model.openStatement(s) } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(Wording.day(s.date, today: today).capitalizedFirst)
                                Text("\(s.transactionCount ?? 0) vendas · conferir ›").font(.footnote).foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text(Money(s.net ?? 0).format()).monospacedDigit().bold()
                        }
                    }
                    .foregroundStyle(Theme.textPrimary)
                }
            } header: {
                Text("Extratos diários")
            } footer: {
                Text("Assinados pela goonersPAY e conferidos neste aparelho contra a raiz pública do dia.")
            }
            Section("Movimentações") {
                ForEach(model.entries, id: \.self) { e in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(Wording.entry(e.type))
                            Text(Wording.day(e.postedAt, today: today) + " " + e.postedAt.dropFirst(11).prefix(5))
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        Text((e.direction == "credit" ? "+" : "−") + Money(e.amount).format())
                            .monospacedDigit()
                            .foregroundStyle(e.direction == "credit" ? Theme.positive : Theme.textPrimary)
                    }
                }
            }
        }
        .refreshable { model.refreshMoney() }
        .onAppear { model.refreshMoney() }
        .sheet(isPresented: Binding(get: { model.statement != nil }, set: { if !$0 { model.statement = nil } })) {
            if let s = model.statement { StatementView(statement: s) }
        }
    }

    /// Prices before commitment: the fee and what arrives, then Face ID.
    @ViewBuilder private var payout: some View {
        Section("Sacar por Pix") {
            if let q = model.quote {
                LabeledContent("Saque", value: Money(q.amount).format())
                LabeledContent("Tarifa", value: Money(q.feeTotal).format())
                LabeledContent("Chega na conta", value: Money(q.netToDestination).format()).bold()
                Text("Para \(model.destination?.key ?? "").").font(.footnote).foregroundStyle(Theme.textSecondary)
                Countdown(expiresAt: q.expiresAt)
                Button("Confirmar saque") { model.confirmPayout() }.buttonStyle(.primary).disabled(model.busy)
                Button("Desistir", role: .cancel) { model.cancelQuote() }
            } else {
                TextField("Valor (ex.: 150,00)", text: $amount).keyboardType(.decimalPad)
                Picker("Tipo de chave", selection: $keyType) {
                    ForEach(Self.keyTypes, id: \.self) { Text(Self.keyTypeNames[$0] ?? $0).tag($0) }
                }
                TextField("Chave Pix", text: $key)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(keyType == "email" ? .emailAddress : keyType == "phone" ? .phonePad : .default)
                let parsed = Money.parseReais(amount)
                Button("Ver tarifa e valor final") { if let parsed { model.quotePayout(parsed, keyType: keyType, key: key) } }
                    .buttonStyle(.primary)
                    .disabled(model.busy || parsed == nil || parsed?.isZero == true || key.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Fechar", role: .cancel) { payingOut = false }
            }
            if let last = model.lastPayout { Text(last).foregroundStyle(Theme.positive) }
        }
    }
}

extension String {
    /// "amanhã" → "Amanhã".
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// A day's statement and what the phone checked about it (docs/03 §6.5).
struct StatementView: View {
    let statement: Statement
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let c = statement.check
        NavigationStack {
            List {
                Section {
                    Text(c.ok ? "Conferido: este extrato está na raiz pública do dia." : "Não conferiu. Não use este extrato e fale com o suporte.")
                        .bold()
                        .foregroundStyle(c.ok ? Theme.positive : Theme.critical)
                    ForEach([("Assinado pela goonersPAY", c.statementSigned), ("É desta loja", c.forThisMerchant),
                             ("Totais batem com as vendas", c.totalsAddUp), ("Resumo (hash) confere", c.commitmentMatches),
                             ("Raiz pública do dia assinada", c.rootSigned), ("Incluído na raiz pública", c.inPublicRoot)], id: \.0) { label, ok in
                        Label(label, systemImage: ok ? "checkmark.circle" : "xmark.octagon")
                            .foregroundStyle(ok ? Theme.textPrimary : Theme.critical)
                    }
                }
                Section("Totais") {
                    LabeledContent("Bruto", value: Money(statement.gross).format())
                    LabeledContent("Tarifas", value: Money(statement.fees).format())
                    if statement.refunds > 0 { LabeledContent("Estornos", value: Money(statement.refunds).format()) }
                    if statement.chargebacks > 0 { LabeledContent("Contestações", value: Money(statement.chargebacks).format()) }
                    LabeledContent("Líquido", value: Money(statement.net).format()).bold()
                }
                Section("Vendas") {
                    ForEach(statement.lines, id: \.receiptEventId) { l in
                        LabeledContent(Money(l.amount).format(), value: "tarifa " + Money(l.fee).format())
                    }
                }
            }
            .navigationTitle("Extrato de \(statement.date)")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fechar") { dismiss() } } }
        }
    }
}
