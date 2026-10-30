import Foundation

/// An amount in centavos. Formatting does not depend on the device locale: "R$" and a
/// no-break space, "." between thousands, "," before the centavos (conformance vectors, money).
public struct Money: Hashable, Sendable, Comparable, CustomStringConvertible {
    public let centavos: Int64

    public init(_ centavos: Int64) { self.centavos = centavos }

    public static let zero = Money(0)

    /// The keypad stops at R$ 999.999,99, well under the platform's per-payment limit.
    public static let maxKeypad: Int64 = 99_999_999

    public var isZero: Bool { centavos == 0 }

    public func format() -> String {
        let neg = centavos < 0
        let abs = neg ? -centavos : centavos
        let reais = Array(String(abs / 100))
        var grouped = ""
        for (i, c) in reais.enumerated() {
            if i > 0 && (reais.count - i) % 3 == 0 { grouped.append(".") }
            grouped.append(c)
        }
        let cents = abs % 100
        return (neg ? "-" : "") + "R$\u{00A0}" + grouped + "," + (cents < 10 ? "0" : "") + String(cents)
    }

    public var description: String { format() }

    /// The keypad: digits shift in from the right, as on a card terminal.
    public func typed(_ digit: Int) -> Money {
        precondition((0...9).contains(digit))
        let next = centavos * 10 + Int64(digit)
        return next > Money.maxKeypad ? self : Money(next)
    }

    public func backspace() -> Money { Money(centavos / 10) }

    /// API Pix and BR Code form: "129.90".
    public func decimal() -> String {
        let c = centavos % 100
        return "\(centavos / 100)." + (c < 10 ? "0" : "") + String(c)
    }

    /// What a person types: "150", "150,5", "1.234,56". Nil when it is not an amount.
    public static func parseReais(_ s: String) -> Money? {
        let t = s.trimmingCharacters(in: .whitespaces)
        let parts = t.split(separator: ",", omittingEmptySubsequences: false)
        guard parts.count <= 2, let whole = parts.first, !whole.isEmpty else { return nil }
        let groups = whole.split(separator: ".", omittingEmptySubsequences: false)
        let digitsOnly: (Substring) -> Bool = { !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }
        if groups.count == 1 {
            guard digitsOnly(whole), whole.count <= 10 else { return nil }
        } else {
            guard (1...3).contains(groups[0].count), digitsOnly(groups[0]),
                  groups.dropFirst().allSatisfy({ $0.count == 3 && digitsOnly($0) }) else { return nil }
        }
        var cents: Int64 = 0
        if parts.count == 2 {
            let f = parts[1]
            guard (1...2).contains(f.count), digitsOnly(f) else { return nil }
            cents = Int64(f.count == 1 ? f + "0" : String(f))!
        }
        guard let reais = Int64(groups.joined()) else { return nil }
        return Money(reais * 100 + cents)
    }

    public static func < (a: Money, b: Money) -> Bool { a.centavos < b.centavos }
}
