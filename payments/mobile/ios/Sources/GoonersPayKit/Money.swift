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

    /// The amount as words, for VoiceOver: "cento e vinte e nove reais e noventa centavos"
    /// (docs/06 §4). Digits read one by one are easy to mishear at a counter.
    public func spoken() -> String {
        if centavos < 0 { return "menos " + Money(-centavos).spoken() }
        let reais = centavos / 100, cents = centavos % 100
        var parts: [String] = []
        if reais == 1 { parts.append("um real") } else if reais > 0 {
            parts.append(Words.number(reais) + (reais % 1_000_000 == 0 ? " de reais" : " reais"))
        }
        if cents == 1 { parts.append("um centavo") } else if cents > 0 { parts.append(Words.number(cents) + " centavos") }
        return parts.isEmpty ? "zero real" : parts.joined(separator: " e ")
    }

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

/// Brazilian Portuguese number words, masculine (reais, centavos).
enum Words {
    private static let units = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
                                "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
    private static let tens = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
    private static let hundreds = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
    private static let scales = [("", ""), ("mil", "mil"), ("milhão", "milhões"), ("bilhão", "bilhões")]

    /// 0...999.
    private static func group(_ n: Int) -> String {
        if n < 20 { return units[n] }
        if n < 100 { return tens[n / 10] + (n % 10 != 0 ? " e " + units[n % 10] : "") }
        if n == 100 { return "cem" }
        return hundreds[n / 100] + (n % 100 != 0 ? " e " + group(n % 100) : "")
    }

    static func number(_ n: Int64) -> String {
        precondition((0...999_999_999_999).contains(n))
        if n == 0 { return "zero" }
        var groups: [Int] = [] // lowest first
        var rest = n
        while rest > 0 { groups.append(Int(rest % 1000)); rest /= 1000 }
        let parts = groups.enumerated().filter { $0.element != 0 }.reversed().map { ($0.offset, $0.element) }
        var out = ""
        for (i, (scale, g)) in parts.enumerated() {
            let words: String
            if scale == 1 && g == 1 { words = "mil" } // "mil", never "um mil"
            else if scale == 0 { words = group(g) }
            else { words = group(g) + " " + (g == 1 ? scales[scale].0 : scales[scale].1) }
            if i > 0 {
                // "mil e cem", "mil e vinte", "dois milhões e quinhentos mil"; else just a space.
                out += (i == parts.count - 1 && (g < 100 || g % 100 == 0)) ? " e " : " "
            }
            out += words
        }
        return out
    }
}
