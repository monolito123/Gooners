import Foundation
import Observation

/// How the customer pays.
public enum PayMethod: String, Sendable, CaseIterable, Codable {
    case credit, debit, pix, crypto

    public var label: String {
        switch self {
        case .credit: "Crédito"
        case .debit: "Débito"
        case .pix: "Pix"
        case .crypto: "Cripto"
        }
    }
}

/// Remembers the last method, so the sheet puts it first and a long press repeats it (docs/06 §5).
@MainActor public protocol MethodMemory: AnyObject {
    var last: PayMethod? { get set }
}

@MainActor public final class InMemoryMethods: MethodMemory {
    public var last: PayMethod?
    public init(_ last: PayMethod? = nil) { self.last = last }
}

/// The stablecoin and network a crypto charge asks for.
public struct CryptoChoice: Sendable, Equatable {
    public var asset: String
    public var network: String
    public init(asset: String = "USDT", network: String = "tron") {
        self.asset = asset
        self.network = network
    }
    public var label: String { "\(asset) (\(network.prefix(1).uppercased() + network.dropFirst()))" }
}

/// A crypto charge on screen: send exactly units of asset on network to address before expiresAt.
public struct CryptoCharge: Sendable, Equatable {
    public var intentID: String
    public var asset: String
    public var network: String
    public var units: String
    public var address: String
    public var memo: String?
    public var uri: String
    public var expiresAt: String
}

/// An approved sale. returnsIn: the keypad comes back by itself after this long (nil: it
/// waits, as when the sale was held and the message needs reading).
public struct Sale: Sendable, Equatable {
    public var amount: Money
    public var method: String
    public var claimURL: String?
    public var netAvailable: Int64?
    public var instant: Bool
    public var held = false
    public var intentID = ""
    public var paidWith: PayMethod = .credit
    public var returnsIn: Duration?
}

/// What the checkout screen shows (docs/05 §3.3). Every state is a value tests can compare.
public enum CheckoutState: Sendable, Equatable {
    /// The keypad. repeat is the method a long press on Cobrar starts.
    case entering(Money, repeat: PayMethod? = nil)
    /// The method sheet, the last method first.
    case choosingMethod(Money, methods: [PayMethod])
    case waitingForCard(Money, readerName: String)
    case authorizing(Money)
    case pixQR(Money, intentID: String, brCode: String)
    case cryptoQR(Money, CryptoCharge)
    case approved(Sale)
    /// "Cancelar venda" is on its way.
    case undoing(Money)
    /// The outcome of "Cancelar venda"; when it failed, sale is the sale to try again.
    case cancelled(Money, done: Bool, message: String, sale: Sale?)
    case declined(Money, message: String)

    public var amount: Money {
        switch self {
        case let .entering(m, _), let .choosingMethod(m, _), let .waitingForCard(m, _), let .authorizing(m), let .pixQR(m, _, _),
             let .cryptoQR(m, _), let .undoing(m), let .cancelled(m, _, _, _), let .declined(m, _): m
        case let .approved(s): s.amount
        }
    }

    public var isFinal: Bool {
        switch self {
        case .approved, .declined, .cancelled: true
        default: false
        }
    }
}

/// Issues the terminal's trace numbers, 000001..999999; the app persists the counter.
public protocol StanSource: Sendable {
    func next() -> String
}

/// Runs one sale at a time: the keypad, then a card through the reader and
/// POST /v1/terminal/authorizations, or a dynamic Pix QR or a crypto transfer polled until it
/// is paid. Two taps from amount to payment, one with a long press (docs/06 §5).
@MainActor @Observable
public final class CheckoutController {
    public private(set) var state: CheckoutState = .entering(.zero)

    private let api: @MainActor () throws -> GoonersPayAPI.Authed
    private let reader: @MainActor () throws -> CardReader
    private let stan: StanSource
    private let pixPoll: Duration
    /// The device's journal: each sale writes tap_started and auth_result (docs/03 §7.1).
    private let journal: @MainActor () -> Journal?
    /// Scores each tap on the phone (docs/07 §3).
    private let risk: RiskMonitor
    @ObservationIgnored private let memory: MethodMemory
    /// Nil when the merchant does not take crypto.
    @ObservationIgnored private let cryptoOffer: @MainActor () -> CryptoChoice?
    /// After an approval the keypad returns by itself (docs/06 §5).
    private let autoReturn: Duration
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var autoTask: Task<Void, Never>?

    public init(api: @escaping @MainActor () throws -> GoonersPayAPI.Authed, reader: @escaping @MainActor () throws -> CardReader,
                stan: StanSource, pixPoll: Duration = .seconds(2), journal: @escaping @MainActor () -> Journal? = { nil },
                risk: RiskMonitor = RiskMonitor(), memory: MethodMemory = InMemoryMethods(),
                cryptoOffer: @escaping @MainActor () -> CryptoChoice? = { nil }, autoReturn: Duration = .seconds(4)) {
        self.api = api
        self.reader = reader
        self.stan = stan
        self.pixPoll = pixPoll
        self.journal = journal
        self.risk = risk
        self.memory = memory
        self.cryptoOffer = cryptoOffer
        self.autoReturn = autoReturn
        state = entering()
    }

    private func entering(_ amount: Money = .zero) -> CheckoutState {
        let last = memory.last.flatMap { methods().contains($0) ? $0 : nil }
        return .entering(amount, repeat: last)
    }

    /// The methods this phone offers, the last one used first.
    public func methods() -> [PayMethod] {
        let all = PayMethod.allCases.filter { $0 != .crypto || cryptoOffer() != nil }
        guard let last = memory.last, all.contains(last) else { return all }
        return [last] + all.filter { $0 != last }
    }

    private func log(_ type: String, _ intentID: String, _ amount: Money, _ extra: [String: String] = [:]) {
        var fields: [String: JSONValue] = ["payment_intent_id": .string(intentID), "amount": Journal.amount(amount)]
        for (k, v) in extra { fields[k] = .string(v) }
        journal()?.append(type, fields: fields)
    }

    /// Cancels a card intent nothing was sent for (the reader failed, the cashier went back).
    /// Once an authorization was sent its outcome may be unknown, and the platform's reversal
    /// handles it; the app never cancels then.
    private func abandon(_ intentID: String?, sent: Bool) {
        guard let intentID, !sent else { return }
        risk.cancelled()
        guard let authed = try? api() else { return }
        Task { _ = try? await authed.cancel(intentID) }
    }

    public func digit(_ d: Int) { edit { $0.typed(d) } }
    public func backspace() { edit { $0.backspace() } }
    /// A quick amount: replaces what was typed.
    public func set(_ amount: Money) { edit { (0...Money.maxKeypad).contains(amount.centavos) ? amount : $0 } }

    private func edit(_ f: (Money) -> Money) {
        if case let .entering(m, last) = state {
            risk.typing()
            state = .entering(f(m), repeat: last)
        }
    }

    /// Tap 1: Cobrar opens the method sheet.
    public func charge() {
        if case let .entering(m, _) = state, !m.isZero { state = .choosingMethod(m, methods: methods()) }
    }

    /// A long press on Cobrar: the last method straight away, one tap in all.
    public func repeatLast() {
        guard case let .entering(m, last?) = state, !m.isZero else { return }
        state = .choosingMethod(m, methods: methods())
        choose(last)
    }

    /// Tap 2: the method. Credit in parcelas when installments > 1.
    public func choose(_ method: PayMethod, installments: Int = 1) {
        guard case .choosingMethod = state else { return }
        memory.last = method
        switch method {
        case .credit: card(.credit, installments: installments)
        case .debit: card(.debit)
        case .pix: pix()
        case .crypto: crypto()
        }
    }

    public func back() {
        task?.cancel()
        var id: String?
        if case let .pixQR(_, intentID, _) = state { id = intentID }
        if case let .cryptoQR(_, c) = state { id = c.intentID }
        if let id {
            // The customer left: cancel the charge, so a late payment of an abandoned QR is refused.
            log("auth_result", id, state.amount, ["result": "canceled"])
            if let authed = try? api() { Task { _ = try? await authed.cancel(id) } }
        }
        switch state {
        case .approved, .undoing, .cancelled: state = entering()
        default: state = entering(state.amount)
        }
    }

    public func nextSale() {
        task?.cancel()
        autoTask?.cancel()
        risk.cleared()
        state = entering()
    }

    /// Re-reads the methods on offer (the merchant changed a setting); a sale in progress is left alone.
    public func refresh() {
        if case let .entering(m, _) = state { state = entering(m) }
    }

    /// Keeps the result on screen: the cashier is reading it or about to cancel.
    public func stay() {
        autoTask?.cancel()
        if case var .approved(s) = state, s.returnsIn != nil {
            s.returnsIn = nil
            state = .approved(s)
        }
    }

    private func approved(_ sale: Sale) {
        var s = sale
        if !s.held { s.returnsIn = autoReturn }
        state = .approved(s)
        guard let wait = s.returnsIn else { return }
        let shown = s
        autoTask?.cancel()
        autoTask = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard let self, !Task.isCancelled, case let .approved(now) = self.state, now == shown else { return }
            self.nextSale()
        }
    }

    /// "Cancelar venda" on the result screen, instead of a confirmation on every right sale
    /// (docs/06 §5): a card sale is reversed before clearing; a Pix or crypto sale, which
    /// cannot be reversed, is refunded to the payer.
    public func cancelSale() {
        let sale: Sale
        switch state {
        case let .approved(s): sale = s
        case let .cancelled(_, _, _, s?): sale = s
        default: return
        }
        autoTask?.cancel()
        state = .undoing(sale.amount)
        task = Task {
            do {
                let a = try api()
                let message: String
                switch sale.paidWith {
                case .credit, .debit:
                    _ = try await a.cancel(sale.intentID)
                    message = "Venda cancelada. O cliente não será cobrado."
                case .pix:
                    _ = try await a.refund(sale.intentID, amount: sale.amount.centavos)
                    message = "Venda cancelada. O valor volta ao cliente por Pix."
                case .crypto:
                    _ = try await a.refund(sale.intentID, amount: sale.amount.centavos)
                    message = "Venda cancelada. O valor volta ao cliente."
                }
                state = .cancelled(sale.amount, done: true, message: message, sale: nil)
            } catch is CancellationError {
            } catch {
                state = .cancelled(sale.amount, done: false,
                                   message: "Não foi possível cancelar agora. A venda continua valendo; tente de novo em instantes.", sale: sale)
            }
        }
    }

    public func card(_ application: EmvApplication, installments: Int = 1) {
        guard case let .choosingMethod(amount, _) = state else { return }
        task = Task {
            var intentID: String?
            var sent = false
            do {
                let authed = try api()
                guard let terminal = await authed.session.terminalId else {
                    return fail(amount, "Este aparelho não tem terminal de cartão. Nenhum valor foi cobrado. Use Pix.")
                }
                let parcelas = installments > 1 && application == .credit ? Installments(count: installments) : nil
                let intent = try await authed.createIntent(IntentCreate(amount: amount.centavos, channel: "card_present", installments: parcelas))
                intentID = intent.id
                let r = try reader()
                state = .waitingForCard(amount, readerName: r.name)
                let card = try await r.read(amount: amount, application: application)
                try Task.checkCancellation()
                let report = risk.tapped(amount)
                state = .authorizing(amount)
                let stanValue = stan.next()
                let tap = journal()?.append("tap_started", fields: ["payment_intent_id": .string(intent.id), "amount": Journal.amount(amount),
                                                                   "terminal_id": .string(terminal), "stan": .string(stanValue)])
                sent = true
                let result = try await authed.authorize(TerminalAuthorization(
                    paymentIntentId: intent.id, terminalId: terminal, stan: stanValue, emvApplication: application.rawValue,
                    localTime: Self.utcNow(), sred: Sred(format: card.format, ksn: card.ksn, ciphertext: card.ciphertext.base64EncodedString()),
                    journalEventId: tap?.id, deviceRisk: DeviceRisk(score: Double(report.milli) / 1000, model: report.model, signals: report.signals)))
                risk.result(result.status)
                log("auth_result", intent.id, amount, ["result": Self.journalResult(result.status), "stan": stanValue])
                guard !Task.isCancelled else { return }
                switch Self.outcome(amount, result) {
                case var .approved(s):
                    s.intentID = intent.id
                    s.paidWith = application == .debit ? .debit : .credit
                    s.method = [s.method.isEmpty ? nil : s.method, parcelas.map { "\($0.count)×" }].compactMap { $0 }.joined(separator: " · ")
                    approved(s)
                case let other:
                    state = other
                }
            } catch is CancellationError {
                abandon(intentID, sent: sent)
            } catch let e as APIError {
                abandon(intentID, sent: sent)
                fail(amount, e.status == 409 ? e.message : "A goonersPAY não autorizou agora. Nenhum valor foi cobrado. Tente de novo ou use Pix.")
            } catch {
                abandon(intentID, sent: sent)
                fail(amount, sent ? "Sem resposta da goonersPAY. Se o cartão foi cobrado, a cobrança é desfeita sozinha. Tente de novo."
                     : "Sem conexão com a goonersPAY. Nenhum valor foi cobrado. Confira a internet e tente de novo.")
            }
        }
    }

    public func pix() {
        guard case let .choosingMethod(amount, _) = state else { return }
        task = Task {
            do {
                let authed = try api()
                let created = try await authed.createIntent(IntentCreate(amount: amount.centavos, paymentMethodTypes: ["pix"]))
                let confirmed = try await authed.confirmPix(created.id)
                guard let code = confirmed.nextAction?.brCode else {
                    return fail(amount, "O Pix não está disponível agora. Nenhum valor foi cobrado. Use o cartão.")
                }
                let decoded = try BrCode.decode(code) // a corrupt or foreign code is never shown to the customer
                if let a = decoded.amount, a != amount.decimal() { return fail(amount, "O QR Code não confere com o valor. Nenhum valor foi cobrado.") }
                try Task.checkCancellation()
                state = .pixQR(amount, intentID: created.id, brCode: code)
                try await awaitPayment(authed, created.id, amount, label: "Pix", method: .pix,
                                       expired: "O Pix expirou sem pagamento. Nenhum valor entrou. Gere um novo QR Code.")
            } catch is CancellationError {
            } catch {
                fail(amount, "Não foi possível gerar o Pix agora. Nenhum valor foi cobrado. Tente de novo.")
            }
        }
    }

    /// A crypto charge: the customer sends a stablecoin; the merchant receives reais (docs/09).
    public func crypto() {
        guard case let .choosingMethod(amount, _) = state, let choice = cryptoOffer() else { return }
        task = Task {
            do {
                let authed = try api()
                let created = try await authed.createIntent(IntentCreate(amount: amount.centavos, channel: "crypto"))
                let a = try await authed.confirmCrypto(created.id, asset: choice.asset, network: choice.network).nextAction
                guard let a, a.type == "crypto_transfer", let address = a.address, let units = a.amount else {
                    return fail(amount, "Cripto não está disponível agora. Nenhum valor foi cobrado. Use Pix ou cartão.")
                }
                try Task.checkCancellation()
                state = .cryptoQR(amount, CryptoCharge(intentID: created.id, asset: a.asset ?? choice.asset, network: a.network ?? choice.network,
                                                       units: units, address: address, memo: a.memo, uri: a.uri ?? address, expiresAt: a.expiresAt ?? ""))
                try await awaitPayment(authed, created.id, amount, label: choice.label, method: .crypto,
                                       expired: "A cobrança em cripto expirou sem pagamento. Nenhum valor entrou. Gere outra.")
            } catch is CancellationError {
            } catch {
                fail(amount, "Não foi possível gerar a cobrança em cripto agora. Nenhum valor foi cobrado. Tente de novo.")
            }
        }
    }

    private func awaitPayment(_ authed: GoonersPayAPI.Authed, _ id: String, _ amount: Money, label: String, method: PayMethod, expired: String) async throws {
        while true {
            try await Task.sleep(for: pixPoll)
            let pi = try await authed.intent(id)
            switch pi.status {
            case "captured":
                log("auth_result", id, amount, ["result": "approved"])
                approved(Sale(amount: amount, method: label, claimURL: pi.receipt?.claimUrl, netAvailable: nil, instant: true, intentID: id, paidWith: method))
                return
            case "canceled", "failed":
                log("auth_result", id, amount, ["result": "canceled"])
                return fail(amount, expired)
            default:
                continue
            }
        }
    }

    private func fail(_ amount: Money, _ message: String) {
        if !Task.isCancelled { state = .declined(amount, message: message) }
    }

    nonisolated static func utcNow() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date())
    }

    /// The journal's result values (nostr/schemas/kind-7714).
    public nonisolated static func journalResult(_ status: String) -> String {
        switch status {
        case "approved": "approved"
        case "timeout": "timeout"
        default: "declined"
        }
    }

    public nonisolated static func outcome(_ amount: Money, _ r: TerminalResult) -> CheckoutState {
        switch r.status {
        case "approved":
            let method = [r.card?.brand.map { $0.prefix(1).uppercased() + $0.dropFirst() }, r.card?.last4.map { "•••• " + $0 }]
                .compactMap { $0 }.joined(separator: " ")
            return .approved(Sale(amount: amount, method: method, claimURL: r.receipt?.claimQr, netAvailable: r.settlement?.netAvailable,
                                  instant: r.settlement?.mode == "instant", held: r.settlement?.held == true))
        case "timeout": return .declined(amount, message: "Tempo esgotado. Nenhum valor foi cobrado. Aproxime o cartão de novo.")
        case "pin_required": return .declined(amount, message: "Este cartão pede senha. Nenhum valor foi cobrado. Use o débito com senha ou Pix.")
        default: return .declined(amount, message: r.customerMessage ?? "Pagamento recusado pelo banco do cliente. Nenhum valor foi cobrado. Tente outro cartão ou Pix.")
        }
    }
}
