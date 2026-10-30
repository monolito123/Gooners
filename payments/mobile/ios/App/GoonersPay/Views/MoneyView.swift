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
    }
}
