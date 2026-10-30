import GoonersPayKit
import SwiftUI

struct MoneyView: View {
    @Environment(AppModel.self) private var model
    @State private var amount = ""
    @State private var keyType = "cpf"
    @State private var key = ""

    private static let keyTypes = ["cpf", "cnpj", "email", "phone", "evp"]
    private static let keyTypeNames = ["cpf": "CPF", "cnpj": "CNPJ", "email": "E-mail", "phone": "Telefone", "evp": "Aleatória"]

    var body: some View {
        List {
            Section("Disponível") {
                Text(model.balance.map { Money($0.available).format() } ?? "—")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
                if let b = model.balance {
                    LabeledContent("A receber", value: Money(b.pending).format())
                    LabeledContent("Reservado", value: Money(b.reserved ?? 0).format())
                    if let held = b.held, held > 0 {
                        LabeledContent("Retido para análise", value: Money(held).format())
                    }
                    ForEach(b.pendingByDate ?? [], id: \.self) { d in
                        LabeledContent(d.date, value: Money(d.amount).format())
                    }
                }
            }
            Section("Sacar por Pix") {
                if let q = model.quote {
                    LabeledContent("Saque", value: Money(q.amount).format())
                    LabeledContent("Tarifa", value: Money(q.feeTotal).format())
                    LabeledContent("Chega na conta", value: Money(q.netToDestination).format()).bold()
                    Text("Para \(model.destination?.key ?? ""). Válido até \(q.expiresAt).").font(.footnote).foregroundStyle(Theme.textSecondary)
                    Button("Confirmar saque") { model.confirmPayout() }.buttonStyle(.primary).disabled(model.busy)
                    Button("Cancelar", role: .cancel) { model.cancelQuote() }
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
                    Button("Simular saque") { if let parsed { model.quotePayout(parsed, keyType: keyType, key: key) } }
                        .buttonStyle(.primary)
                        .disabled(model.busy || parsed == nil || parsed?.isZero == true || key.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let last = model.lastPayout { Text(last) }
            }
            Section {
                if model.settlements.isEmpty {
                    Text("O extrato de um dia sai depois da 1h do dia seguinte.").font(.footnote).foregroundStyle(Theme.textSecondary)
                }
                ForEach(model.settlements) { s in
                    Button { model.openStatement(s) } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(s.date)
                                Text("\(s.transactionCount ?? 0) vendas").font(.footnote).foregroundStyle(Theme.textSecondary)
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
                            Text(e.type.replacingOccurrences(of: "_", with: " "))
                            Text(e.postedAt.prefix(16).replacingOccurrences(of: "T", with: " ")).font(.footnote).foregroundStyle(Theme.textSecondary)
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
