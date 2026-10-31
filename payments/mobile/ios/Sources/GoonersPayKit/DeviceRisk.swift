import Foundation

/// The phone's half of the fraud shield (docs/07 §3): signals only the phone sees, scored by a
/// model compiled into the app. Raw observations never leave the phone; the authorization
/// carries the score, the model's name and at most five signal codes (§3.5).
///
/// The platform knows the model and recomputes the score from the codes, so a tampered app
/// gains nothing by reporting a low score with them (§3.8). The conformance vectors hold this
/// core, the Android core and the platform to the same numbers.
public enum DeviceModel {
    public static let name = "gp-device-1"
    public static let maxSignals = 5

    /// Weights in thousandths (docs/07 §3.3).
    public static let weights: [String: Int] = [
        // Device posture
        "hooking": 700, "root_indicators": 600, "debugger": 600, "emulator": 500, "overlay_active": 400,
        "accessibility_service": 350, "screen_captured": 300, "adb_enabled": 200, "developer_options": 100,
        // Relay timing (from the reader's kernel)
        "apdu_rtt_p99_exceeded": 500,
        // Interaction
        "fast_amount_to_tap": 250, "cancelled_taps": 200, "repeated_amount": 150, "just_under_limit": 150,
        // Session
        "decline_streak": 350, "tap_burst": 300,
    ]

    /// A noisy OR in integer thousandths: each signal, heaviest first (ties by name), keeps
    /// (1000 - weight)/1000 of the remaining "clean" mass, truncated at every step. Unknown
    /// codes weigh nothing. Returns the score and the heaviest `maxSignals` codes.
    public static func score<S: Sequence>(_ signals: S) -> (milli: Int, signals: [String]) where S.Element == String {
        var seen = Set<String>()
        let known = signals.filter { weights[$0] != nil && seen.insert($0).inserted }
            .sorted { (weights[$0]!, $1) > (weights[$1]!, $0) }
        var clean = 1000
        for s in known { clean = clean * (1000 - weights[s]!) / 1000 }
        return (1000 - clean, Array(known.prefix(maxSignals)))
    }
}

/// Device posture the app reads from the OS (debugger, jailbreak, screen capture…); the core
/// cannot see it.
public protocol PostureSource: Sendable {
    func signals() -> Set<String>
}

struct NoPosture: PostureSource {
    func signals() -> Set<String> { [] }
}

/// What goes into the authorization request.
public struct DeviceRiskReport: Sendable, Equatable {
    public var milli: Int
    public var model: String
    public var signals: [String]
}

/// Watches the sales on this phone for the interaction and session signals of docs/07 §3.3,
/// adds the posture signals and scores each tap. Thread-safe.
public final class RiskMonitor: @unchecked Sendable {
    public static let window: TimeInterval = 600
    /// Faster than a cashier types an amount and a customer presents a card.
    public static let fastTap: TimeInterval = 1.5
    public static let cancelledTaps = 3
    /// More taps than a till can take: card-testing scripts.
    public static let burstTaps = 8
    public static let burstWindow: TimeInterval = 120
    public static let declineStreak = 3
    /// The contactless limit without cardholder verification in Brazil, centavos.
    public static let noCVMLimit: Int64 = 200_00

    private let posture: PostureSource
    private let clock: @Sendable () -> TimeInterval
    private let lock = NSLock()
    private var typingStartedAt: TimeInterval?
    private var taps: [(at: TimeInterval, centavos: Int64)] = []
    private var cancels: [TimeInterval] = []
    private var results: [String] = []

    public init(posture: PostureSource? = nil, clock: @escaping @Sendable () -> TimeInterval = { Date().timeIntervalSince1970 }) {
        self.posture = posture ?? NoPosture()
        self.clock = clock
    }

    /// The cashier typed a digit of a new amount.
    public func typing() {
        lock.withLock { if typingStartedAt == nil { typingStartedAt = clock() } }
    }

    /// A new sale starts: its amount-to-tap time counts from its own first digit.
    public func cleared() {
        lock.withLock { typingStartedAt = nil }
    }

    /// A sale was abandoned before its card was sent.
    public func cancelled() {
        lock.withLock {
            cancels.append(clock())
            typingStartedAt = nil
        }
    }

    /// A card was read for `amount`: the report to send with its authorization.
    public func tapped(_ amount: Money) -> DeviceRiskReport {
        let posture = posture.signals()
        return lock.withLock {
            let now = clock()
            taps.removeAll { now - $0.at > Self.window }
            cancels.removeAll { now - $0 > Self.window }
            var signals = posture
            if let t = typingStartedAt, now - t < Self.fastTap { signals.insert("fast_amount_to_tap") }
            if cancels.count >= Self.cancelledTaps { signals.insert("cancelled_taps") }
            if taps.count >= 2, taps.suffix(2).allSatisfy({ $0.centavos == amount.centavos }) { signals.insert("repeated_amount") }
            if amount.centavos >= Self.noCVMLimit * 95 / 100, amount.centavos < Self.noCVMLimit { signals.insert("just_under_limit") }
            if taps.filter({ now - $0.at <= Self.burstWindow }).count + 1 >= Self.burstTaps { signals.insert("tap_burst") }
            if results.count >= Self.declineStreak, results.allSatisfy({ $0 == "declined" || $0 == "pin_required" }) { signals.insert("decline_streak") }
            taps.append((now, amount.centavos))
            typingStartedAt = nil
            let s = DeviceModel.score(signals)
            return DeviceRiskReport(milli: s.milli, model: DeviceModel.name, signals: s.signals)
        }
    }

    /// The authorization's status (approved, declined, pin_required, timeout).
    public func result(_ status: String) {
        lock.withLock {
            results.append(status)
            if results.count > Self.declineStreak { results.removeFirst(results.count - Self.declineStreak) }
        }
    }
}
