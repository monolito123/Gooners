import GoonersPayKit
import SwiftUI

struct ChargeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let co = model.checkout
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 16) {
                    content(co)
                }
                .padding()
                .frame(minHeight: geo.size.height)
            }
        }
        .background(Theme.canvas)
        .onChange(of: co.state) { _, new in announce(new) }
    }

    @ViewBuilder
    private func content(_ co: CheckoutController) -> some View {
        switch co.state {
        case let .entering(amount):
            AmountText(amount: amount)
            Spacer()
            KeypadView(onDigit: co.digit, onBackspace: co.backspace)
            Button("Cobrar") { co.charge() }.buttonStyle(.primary).disabled(amount.isZero)
        case let .choosingMethod(amount):
            AmountText(amount: amount)
            Text("Como o cliente vai pagar?").foregroundStyle(Theme.textSecondary)
            if let reader = model.sandboxReader { TestCardPicker(reader: reader) }
            Spacer()
            Button("Crédito") { co.card(.credit) }.buttonStyle(.primary)
            Button("Débito") { co.card(.debit) }.buttonStyle(.primary)
            Button("Pix") { co.pix() }.buttonStyle(.primary)
            Button("Voltar") { co.back() }.frame(minHeight: Theme.touchMin)
        case let .waitingForCard(amount, readerName):
            Waiting(amount: amount, title: "Aproxime o cartão", detail: readerName)
        case let .authorizing(amount):
            Waiting(amount: amount, title: "Autorizando…", detail: nil)
        case let .pixQR(amount, _, brCode):
            AmountText(amount: amount)
            Text("Peça ao cliente para ler o QR com o app do banco.").foregroundStyle(Theme.textSecondary)
            QRCodeView(text: brCode, label: "QR Code Pix de \(amount.format())")
            ProgressView("Aguardando o pagamento…")
            Spacer()
            Button("Cancelar") { co.back() }.frame(minHeight: Theme.touchMin)
        case let .approved(amount, method, claimURL, netAvailable, instant):
            Text("Aprovado").font(.largeTitle.bold()).foregroundStyle(Theme.positive)
            AmountText(amount: amount)
            Text(method).foregroundStyle(Theme.textSecondary)
            if let net = netAvailable {
                Text((instant ? "Disponível agora: " : "Você recebe: ") + Money(net).format())
            }
            if let claimURL {
                Text("Recibo para o cliente:").foregroundStyle(Theme.textSecondary)
                QRCodeView(text: claimURL, label: "QR Code do recibo", size: 180)
            }
            Spacer()
            Button("Nova venda") { co.nextSale() }.buttonStyle(.primary)
        case let .declined(amount, message):
            Text("Não aprovado").font(.largeTitle.bold()).foregroundStyle(Theme.critical)
            AmountText(amount: amount)
            Text(message).multilineTextAlignment(.center)
            Spacer()
            Button("Tentar de novo") { co.back() }.buttonStyle(.primary)
            Button("Nova venda") { co.nextSale() }.frame(minHeight: Theme.touchMin)
        }
    }

    private func announce(_ s: CheckoutState) {
        switch s {
        case let .approved(amount, _, _, _, _): AccessibilityNotification.Announcement("Aprovado, \(amount.format())").post()
        case let .declined(_, message): AccessibilityNotification.Announcement("Não aprovado. \(message)").post()
        default: break
        }
    }
}

private struct AmountText: View {
    let amount: Money

    var body: some View {
        Text(amount.format())
            .font(.system(size: 48, weight: .bold, design: .rounded))
            .monospacedDigit()
            .minimumScaleFactor(0.5)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .accessibilityAddTraits(.updatesFrequently)
    }
}

private struct Waiting: View {
    let amount: Money
    let title: String
    let detail: String?

    var body: some View {
        AmountText(amount: amount)
        Spacer().frame(height: 32)
        ProgressView().controlSize(.large)
        Text(title).font(.title2)
        if let detail { Text(detail).foregroundStyle(Theme.textSecondary) }
        Spacer()
    }
}

private struct TestCardPicker: View {
    let reader: SandboxCardReader
    @State private var card: SandboxCardReader.TestCard = .visaCredit

    var body: some View {
        Picker("Cartão de teste", selection: $card) {
            ForEach(SandboxCardReader.TestCard.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .onAppear { card = reader.card }
        .onChange(of: card) { _, c in reader.card = c }
    }
}

struct KeypadView: View {
    let onDigit: @MainActor (Int) -> Void
    let onBackspace: @MainActor () -> Void

    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(keys, id: \.self) { k in
                Button {
                    switch k {
                    case "⌫": onBackspace()
                    case "00": onDigit(0); onDigit(0)
                    default: onDigit(Int(k)!)
                    }
                } label: {
                    Text(k).font(.system(size: 28, weight: .medium, design: .rounded))
                        .frame(maxWidth: .infinity, minHeight: Theme.keypadKey)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                }
                .foregroundStyle(Theme.textPrimary)
                .accessibilityLabel(k == "⌫" ? "Apagar" : k)
            }
        }
        .frame(maxWidth: 420)
    }
}
