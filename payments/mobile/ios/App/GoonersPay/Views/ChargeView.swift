import GoonersPayKit
import SwiftUI
import UIKit

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
        case let .entering(amount, last):
            AmountText(amount: amount)
            if amount.isZero { QuickAmounts { co.set($0) } }
            Spacer()
            KeypadView(onDigit: co.digit, onBackspace: co.backspace)
            ChargeButton(enabled: !amount.isZero, repeating: last, charge: co.charge, repeatLast: co.repeatLast)
        case let .choosingMethod(amount, methods):
            MethodSheet(amount: amount, methods: methods, sandboxReader: model.sandboxReader, choose: { co.choose($0, installments: $1) }, back: co.back)
        case let .waitingForCard(amount, readerName):
            AmountText(amount: amount)
            Spacer().frame(height: 24)
            TapTarget()
            Text("Aproxime o cartão").font(.title2)
            Text(readerName).foregroundStyle(Theme.textSecondary)
            Spacer()
            Button("Cancelar") { co.back() }.frame(minHeight: Theme.touchMin)
        case let .authorizing(amount):
            Waiting(amount: amount, title: "Autorizando…", detail: "Não remova o cartão ainda.")
            CardDetected() // a light tick when the card is read (docs/06 §7)
        case let .pixQR(amount, _, brCode):
            AmountText(amount: amount)
            Text("Peça ao cliente para ler o QR com o app do banco.").foregroundStyle(Theme.textSecondary)
            QRCodeView(text: brCode, label: "QR Code Pix de \(amount.spoken())")
            ProgressView("Aguardando o pagamento. A tela muda sozinha quando cair.")
            Spacer()
            Button("Cancelar") { co.back() }.frame(minHeight: Theme.touchMin)
        case let .cryptoQR(amount, c):
            AmountText(amount: amount)
            Text("Peça ao cliente para ler com a carteira dele e enviar exatamente:").foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
            Text("\(c.units.replacingOccurrences(of: ".", with: ",")) \(c.asset)").font(.title2.bold()).monospaced()
            Text("Na rede \(c.network.capitalized). Outra rede ou outro valor não é reconhecido.")
                .font(.footnote).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
            QRCodeView(text: c.uri, label: "QR Code da cobrança em \(c.asset)")
            if let memo = c.memo { Text("Memo: \(memo)").monospaced() }
            Countdown(expiresAt: c.expiresAt)
            ProgressView("Aguardando a transferência. Você recebe em reais.")
            Spacer()
            if model.isSandbox { Button("Simular pagamento (sandbox)") { model.simulateCrypto(c.intentID) }.buttonStyle(.secondary) }
            Button("Cancelar") { co.back() }.frame(minHeight: Theme.touchMin)
        case let .approved(sale):
            ApprovedView(sale: sale, stay: co.stay, next: co.nextSale, cancel: co.cancelSale)
        case let .undoing(amount):
            Waiting(amount: amount, title: "Cancelando a venda…", detail: nil)
        case let .cancelled(amount, done, message, sale):
            Text(done ? "Venda cancelada" : sale == nil ? "Venda mantida" : "Não foi possível cancelar").font(.largeTitle.bold())
                .foregroundStyle(done || sale == nil ? Theme.textPrimary : Theme.critical)
            AmountText(amount: amount)
            Text(message).multilineTextAlignment(.center)
            Spacer()
            if !done, sale != nil { Button("Tentar de novo") { co.cancelSale() }.buttonStyle(.primary) }
            if done { Button("Nova venda") { co.nextSale() }.buttonStyle(.primary) } else { Button("Voltar ao teclado") { co.nextSale() }.frame(minHeight: Theme.touchMin) }
        case let .declined(amount, message):
            DeclinedView(amount: amount, message: message, retry: co.back, next: co.nextSale)
        }
    }

    private func announce(_ s: CheckoutState) {
        switch s {
        case let .approved(sale): AccessibilityNotification.Announcement("Aprovado, \(sale.amount.spoken())").post()
        case let .declined(_, message): AccessibilityNotification.Announcement("Não aprovado. \(message)").post()
        case let .cancelled(_, _, message, _): AccessibilityNotification.Announcement(message).post()
        default: break
        }
    }
}

/// The amount: tabular figures so digits do not jump while typing, shrinking to a 32 pt floor
/// instead of truncating, and spoken as words to VoiceOver (docs/06 §4).
struct AmountText: View {
    let amount: Money
    var scale: CGFloat = 1

    var body: some View {
        Text(amount.format())
            .font(.system(size: 56, weight: .bold, design: .rounded))
            .monospacedDigit()
            .minimumScaleFactor(32.0 / 56.0)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .scaleEffect(scale)
            .accessibilityLabel(amount.spoken())
            .accessibilityAddTraits(.updatesFrequently)
    }
}

/// Cobrar: a tap opens the method sheet; a long press repeats the last method, one tap in all.
private struct ChargeButton: View {
    let enabled: Bool
    let repeating: PayMethod?
    let charge: @MainActor () -> Void
    let repeatLast: @MainActor () -> Void
    @State private var longPressed = 0

    var body: some View {
        VStack(spacing: 6) {
            Text("Cobrar")
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: Theme.ctaHeight)
                .foregroundStyle(Theme.onAction)
                .background(Theme.action.opacity(enabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: 14))
                .contentShape(Rectangle())
                .onTapGesture { if enabled { charge() } }
                .onLongPressGesture(minimumDuration: 0.5) {
                    guard enabled, repeating != nil else { return }
                    longPressed += 1
                    repeatLast()
                }
                .sensoryFeedback(.impact(weight: .medium), trigger: longPressed)
                .accessibilityElement()
                .accessibilityLabel("Cobrar")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { if enabled { charge() } }
                .accessibilityActions {
                    if let m = repeating, enabled { Button("Cobrar direto no \(m.label)") { repeatLast() } }
                }
            if let m = repeating, enabled {
                Text("Segure Cobrar para ir direto ao \(m.label)").font(.footnote).foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

/// The amounts a counter types most, one tap each.
private struct QuickAmounts: View {
    let set: @MainActor (Money) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach([1_000, 2_000, 5_000, 10_000] as [Int64], id: \.self) { c in
                Button(Money(c).format().replacingOccurrences(of: ",00", with: "")) { set(Money(c)) }
                    .buttonStyle(.bordered)
                    .frame(minHeight: Theme.touchMin)
            }
        }
    }
}

/// The method sheet: the last method first, under the thumb, and the only filled button;
/// parcelas 1× unless the cashier taps another, and only for credit (docs/06 §5).
private struct MethodSheet: View {
    let amount: Money
    let methods: [PayMethod]
    let sandboxReader: SandboxCardReader?
    let choose: @MainActor (PayMethod, Int) -> Void
    let back: @MainActor () -> Void
    @State private var parcelas = 1

    private func label(_ m: PayMethod) -> String {
        switch m {
        case .credit: parcelas > 1 ? "Crédito em \(parcelas)×" : "Crédito"
        case .crypto: "Cripto (USDT)"
        default: m.label
        }
    }

    var body: some View {
        AmountText(amount: amount)
        Text("Como o cliente vai pagar?").foregroundStyle(Theme.textSecondary)
        if let sandboxReader { TestCardPicker(reader: sandboxReader) }
        Spacer()
        if methods.contains(.credit) {
            Text("Parcelas no crédito").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach([1, 2, 3, 4, 6, 10, 12], id: \.self) { n in
                        let label = n == 1 ? "À vista" : "\(n)× \(Money(amount.centavos / Int64(n)).format())"
                        Button(label) { parcelas = n }
                            .buttonStyle(.bordered)
                            .tint(parcelas == n ? Theme.action : Theme.textSecondary)
                            .accessibilityAddTraits(parcelas == n ? .isSelected : [])
                    }
                }
            }
        }
        ForEach(Array(methods.enumerated()), id: \.element) { i, m in
            if i == 0 {
                Button(label(m)) { choose(m, parcelas) }.buttonStyle(.primary)
            } else {
                Button(label(m)) { choose(m, parcelas) }.buttonStyle(.secondary)
            }
        }
        Button("Voltar") { back() }.frame(minHeight: Theme.touchMin)
    }
}

/// Where to tap the card, pulsing unless the system asks for less motion.
private struct TapTarget: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Circle()
            .stroke(Theme.action, lineWidth: 4)
            .frame(width: 140, height: 140)
            .overlay(Text("Aproxime\naqui").multilineTextAlignment(.center).font(.headline).foregroundStyle(Theme.action))
            .scaleEffect(pulse && !reduceMotion ? 1.12 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = true }
            .accessibilityLabel("Área do cartão")
    }
}

/// The check draws in 400 ms and the amount scales 1.0 → 1.04 → 1.0 (motion.approve,
/// docs/06 §7), with the success haptic; with Reduce Motion it cross-fades instead.
private struct ApprovedView: View {
    let sale: Sale
    let stay: @MainActor () -> Void
    let next: @MainActor () -> Void
    let cancel: @MainActor () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn: CGFloat = 0
    @State private var scale: CGFloat = 1
    @State private var shownAt = Date()
    @State private var appeared = false

    var body: some View {
        CheckMark(progress: drawn)
            .fill(Theme.positive)
            .frame(width: 80, height: 80)
            .accessibilityHidden(true)
        Text("Aprovado").font(.largeTitle.bold()).foregroundStyle(Theme.positive)
        AmountText(amount: sale.amount, scale: scale)
        Text(sale.method).foregroundStyle(Theme.textSecondary)
        if sale.held {
            Text("Valor retido para análise de segurança. Seu dinheiro está seguro; você é avisado quando for liberado.")
                .multilineTextAlignment(.center).foregroundStyle(Theme.warning)
        } else if let net = sale.netAvailable {
            Text((sale.instant ? "Disponível agora: " : "Você recebe: ") + Money(net).format()).bold()
        }
        if let claimURL = sale.claimURL {
            Text("Recibo para o cliente. Toque no código para mantê-lo na tela.").font(.footnote).foregroundStyle(Theme.textSecondary)
            QRCodeView(text: claimURL, label: "QR Code do recibo", size: 180)
                .onTapGesture { stay() }
                .accessibilityAction(named: "Manter na tela") { stay() }
        }
        Spacer()
        if let wait = sale.returnsIn {
            // The 4 s before the keypad comes back, drawn so it is never a surprise.
            TimelineView(.animation) { t in
                let total = Double(wait.components.seconds) + Double(wait.components.attoseconds) / 1e18
                ProgressView(value: max(0, 1 - t.date.timeIntervalSince(shownAt) / total))
            }
            Text("Volta para o teclado sozinho").font(.footnote).foregroundStyle(Theme.textSecondary)
        }
        Button("Nova venda") { next() }.buttonStyle(.primary)
        Button("Cancelar venda", role: .destructive) { cancel() }.frame(minHeight: Theme.touchMin)
            .sensoryFeedback(.success, trigger: appeared)
            .onAppear {
                appeared = true
                shownAt = Date()
                if reduceMotion {
                    drawn = 1
                } else {
                    withAnimation(.easeOut(duration: 0.4)) { drawn = 1 }
                    withAnimation(.easeOut(duration: 0.12).delay(0.4)) { scale = 1.04 }
                    withAnimation(.easeIn(duration: 0.16).delay(0.52)) { scale = 1 }
                }
            }
    }
}

private struct CheckMark: Shape {
    var progress: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in r: CGRect) -> Path {
        var p = Path()
        p.addEllipse(in: r.insetBy(dx: 3, dy: 3))
        var check = Path()
        check.move(to: CGPoint(x: r.width * 0.28, y: r.height * 0.52))
        check.addLine(to: CGPoint(x: r.width * 0.44, y: r.height * 0.68))
        check.addLine(to: CGPoint(x: r.width * 0.74, y: r.height * 0.36))
        p.addPath(check.trimmedPath(from: 0, to: progress))
        return p.strokedPath(StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
    }
}

/// Declined: the amount shakes 2 pt once, with the error haptic (docs/06 §7).
private struct DeclinedView: View {
    let amount: Money
    let message: String
    let retry: @MainActor () -> Void
    let next: @MainActor () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shakes: CGFloat = 0

    var body: some View {
        Text("Não aprovado").font(.largeTitle.bold()).foregroundStyle(Theme.critical)
        AmountText(amount: amount)
            .modifier(Shake(travel: reduceMotion ? 0 : 2, shakes: shakes))
            .sensoryFeedback(.error, trigger: shakes)
            .onAppear { withAnimation(.linear(duration: 0.2)) { shakes = 1 } }
        Text(message).multilineTextAlignment(.center)
        Spacer()
        Button("Tentar de novo") { retry() }.buttonStyle(.primary)
        Button("Nova venda") { next() }.frame(minHeight: Theme.touchMin)
    }
}

private struct Shake: GeometryEffect {
    var travel: CGFloat
    var shakes: CGFloat
    var animatableData: CGFloat {
        get { shakes }
        set { shakes = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: travel * sin(shakes * .pi * 4), y: 0))
    }
}

/// A light tick, once, when the card has been read.
private struct CardDetected: View {
    @State private var read = false

    var body: some View {
        Color.clear.frame(height: 0)
            .sensoryFeedback(.impact(weight: .light), trigger: read)
            .onAppear { read = true }
            .accessibilityHidden(true)
    }
}

/// How long a crypto charge or a quote is still valid.
struct Countdown: View {
    let expiresAt: String

    var body: some View {
        if let end = ISO8601DateFormatter().date(from: expiresAt) {
            TimelineView(.periodic(from: .now, by: 1)) { t in
                let s = max(0, Int(end.timeIntervalSince(t.date)))
                Text(s > 0 ? String(format: "Vale por %d:%02d", s / 60, s % 60) : "Expirou: peça outra")
                    .font(.footnote).foregroundStyle(Theme.textSecondary).monospacedDigit()
            }
        }
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
