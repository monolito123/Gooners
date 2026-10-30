import Foundation
import Observation

/// What the checkout screen shows (docs/05 §3.3). Every state is a value tests can compare.
public enum CheckoutState: Sendable, Equatable {
    case entering(Money)
    case choosingMethod(Money)
    case waitingForCard(Money, readerName: String)
    case authorizing(Money)
    case pixQR(Money, intentID: String, brCode: String)
    case approved(Money, method: String, claimURL: String?, netAvailable: Int64?, instant: Bool)
    case declined(Money, message: String)

    public var amount: Money {
        switch self {
        case let .entering(m), let .choosingMethod(m), let .waitingForCard(m, _), let .authorizing(m), let .pixQR(m, _, _),
             let .approved(m, _, _, _, _), let .declined(m, _): m
        }
    }

    public var isFinal: Bool {
        switch self {
        case .approved, .declined: true
        default: false
        }
    }
}

/// Issues the terminal's trace numbers, 000001..999999; the app persists the counter.
public protocol StanSource: Sendable {
    func next() -> String
}

/// Runs one sale at a time: the keypad, then a card through the reader and
/// POST /v1/terminal/authorizations, or a dynamic Pix QR polled until it is paid.
@MainActor @Observable
public final class CheckoutController {
    public private(set) var state: CheckoutState = .entering(.zero)

    private let api: @MainActor () throws -> GoonersPayAPI.Authed
    private let reader: @MainActor () throws -> CardReader
    private let stan: StanSource
    private let pixPoll: Duration
    /// The device's journal: each sale writes tap_started and auth_result (docs/03 §7.1).
    private let journal: @MainActor () -> Journal?
    @ObservationIgnored private var task: Task<Void, Never>?

    public init(api: @escaping @MainActor () throws -> GoonersPayAPI.Authed, reader: @escaping @MainActor () throws -> CardReader,
                stan: StanSource, pixPoll: Duration = .seconds(2), journal: @escaping @MainActor () -> Journal? = { nil }) {
        self.api = api
        self.reader = reader
        self.stan = stan
        self.pixPoll = pixPoll
        self.journal = journal
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
        guard let intentID, !sent, let authed = try? api() else { return }
        Task { _ = try? await authed.cancel(intentID) }
    }

    public func digit(_ d: Int) { edit { $0.typed(d) } }
    public func backspace() { edit { $0.backspace() } }

    private func edit(_ f: (Money) -> Money) {
        if case let .entering(m) = state { state = .entering(f(m)) }
    }

    public func charge() {
        if case let .entering(m) = state, !m.isZero { state = .choosingMethod(m) }
    }

    public func back() {
        task?.cancel()
        if case let .pixQR(amount, intentID, _) = state {
            // The customer left: cancel the charge, so a late payment of an abandoned QR is refused.
            log("auth_result", intentID, amount, ["result": "canceled"])
            if let authed = try? api() { Task { _ = try? await authed.cancel(intentID) } }
        }
        if case .approved = state { state = .entering(.zero) } else { state = .entering(state.amount) }
    }

    public func nextSale() {
        task?.cancel()
        state = .entering(.zero)
    }

    public func card(_ application: EmvApplication) {
        guard case let .choosingMethod(amount) = state else { return }
        task = Task {
            var intentID: String?
            var sent = false
            do {
                let authed = try api()
                guard let terminal = await authed.session.terminalId else { return fail(amount, "Este aparelho não tem terminal. Use Pix.") }
                let intent = try await authed.createIntent(IntentCreate(amount: amount.centavos, channel: "card_present"))
                intentID = intent.id
                let r = try reader()
                state = .waitingForCard(amount, readerName: r.name)
                let card = try await r.read(amount: amount, application: application)
                try Task.checkCancellation()
                state = .authorizing(amount)
                let stanValue = stan.next()
                let tap = journal()?.append("tap_started", fields: ["payment_intent_id": .string(intent.id), "amount": Journal.amount(amount),
                                                                   "terminal_id": .string(terminal), "stan": .string(stanValue)])
                sent = true
                let result = try await authed.authorize(TerminalAuthorization(
                    paymentIntentId: intent.id, terminalId: terminal, stan: stanValue, emvApplication: application.rawValue,
                    localTime: Self.utcNow(), sred: Sred(format: card.format, ksn: card.ksn, ciphertext: card.ciphertext.base64EncodedString()),
                    journalEventId: tap?.id))
                log("auth_result", intent.id, amount, ["result": Self.journalResult(result.status), "stan": stanValue])
                if !Task.isCancelled { state = Self.outcome(amount, result) }
            } catch is CancellationError {
                abandon(intentID, sent: sent)
            } catch let e as APIError {
                abandon(intentID, sent: sent)
                fail(amount, e.status == 409 ? e.message : "Não foi possível autorizar. Tente de novo ou use Pix.")
            } catch {
                abandon(intentID, sent: sent)
                fail(amount, "Sem conexão com a goonersPAY. Tente de novo.")
            }
        }
    }

    public func pix() {
        guard case let .choosingMethod(amount) = state else { return }
        task = Task {
            do {
                let authed = try api()
                let created = try await authed.createIntent(IntentCreate(amount: amount.centavos, paymentMethodTypes: ["pix"]))
                let confirmed = try await authed.confirmPix(created.id)
                guard let code = confirmed.nextAction?.brCode else { return fail(amount, "O Pix não está disponível agora.") }
                let decoded = try BrCode.decode(code) // a corrupt or foreign code is never shown to the customer
                if let a = decoded.amount, a != amount.decimal() { return fail(amount, "O QR Code não confere com o valor.") }
                try Task.checkCancellation()
                state = .pixQR(amount, intentID: created.id, brCode: code)
                while true {
                    try await Task.sleep(for: pixPoll)
                    let pi = try await authed.intent(created.id)
                    switch pi.status {
                    case "captured":
                        log("auth_result", created.id, amount, ["result": "approved"])
                        state = .approved(amount, method: "Pix", claimURL: pi.receipt?.claimUrl, netAvailable: nil, instant: true)
                        return
                    case "canceled", "failed":
                        log("auth_result", created.id, amount, ["result": "canceled"])
                        return fail(amount, "O Pix expirou. Gere um novo QR Code.")
                    default:
                        continue
                    }
                }
            } catch is CancellationError {
            } catch {
                fail(amount, "Não foi possível gerar o Pix. Tente de novo.")
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
            return .approved(amount, method: method, claimURL: r.receipt?.claimQr, netAvailable: r.settlement?.netAvailable,
                             instant: r.settlement?.mode == "instant")
        case "timeout": return .declined(amount, message: "Tempo esgotado. Aproxime o cartão de novo.")
        case "pin_required": return .declined(amount, message: "Este cartão pede senha. Use o débito com senha ou Pix.")
        default: return .declined(amount, message: r.customerMessage ?? "Pagamento recusado. Tente outro cartão.")
        }
    }
}
