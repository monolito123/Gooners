import Foundation

/// The sounds of a sale (docs/06 §7), synthesized so the app ships no audio files: a short
/// click when the card is read, two rising notes on approval, one low note on a decline.
public enum Tone: Sendable, CaseIterable, Hashable {
    case cardRead, approved, declined

    /// Mono samples in −1…1 at sampleRate.
    public func samples(sampleRate: Double = 44_100) -> [Float] {
        switch self {
        case .cardRead:
            Self.note(2_000, seconds: 0.03, rate: sampleRate, gain: 0.3)
        case .approved: // C6 then G6: up a fifth reads as "done"
            Self.note(1_046.5, seconds: 0.12, rate: sampleRate) + Self.silence(0.03, rate: sampleRate) + Self.note(1_568, seconds: 0.16, rate: sampleRate)
        case .declined: // A3, low and short: noticed without alarm
            Self.note(220, seconds: 0.35, rate: sampleRate)
        }
    }

    /// A sine with a 5 ms attack and a 40 ms release, so it starts and ends without a click.
    static func note(_ frequency: Double, seconds: Double, rate: Double, gain: Float = 0.5) -> [Float] {
        let n = Int(seconds * rate)
        let attack = max(1, Int(0.005 * rate)), release = max(1, Int(0.04 * rate))
        return (0..<n).map { i in
            var envelope = 1.0
            if i < attack { envelope = Double(i) / Double(attack) }
            if i >= n - release { envelope = min(envelope, Double(n - 1 - i) / Double(release)) }
            return Float(sin(2 * Double.pi * frequency * Double(i) / rate) * envelope) * gain
        }
    }

    static func silence(_ seconds: Double, rate: Double) -> [Float] { Array(repeating: 0, count: Int(seconds * rate)) }
}
