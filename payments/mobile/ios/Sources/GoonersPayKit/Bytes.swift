import Crypto
import Foundation

private let hexDigits = Array("0123456789abcdef".utf8)

extension Data {
    /// Lowercase hex.
    public var hex: String {
        var out = [UInt8]()
        out.reserveCapacity(count * 2)
        for b in self {
            out.append(hexDigits[Int(b >> 4)])
            out.append(hexDigits[Int(b & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Parses even-length hex; nil on anything else.
    public init?(hex: String) {
        let chars = Array(hex.utf8)
        guard chars.count % 2 == 0 else { return nil }
        func nibble(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: c - 48
            case 97...102: c - 87
            case 65...70: c - 55
            default: nil
            }
        }
        var out = Data(capacity: chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
            i += 2
        }
        self = out
    }

    /// base64url without padding (JWS, DPoP).
    public var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public init?(base64URL s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }

    /// Bytes from the system's cryptographic random generator.
    public static func random(_ n: Int) -> Data {
        var g = SystemRandomNumberGenerator()
        return Data((0..<n).map { _ in UInt8.random(in: .min ... .max, using: &g) })
    }
}

public func sha256(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }

public func sha256(_ text: String) -> Data { sha256(Data(text.utf8)) }

/// A JSON string literal with the escaping of JavaScript's JSON.stringify and of the platform:
/// \" \\ \n \r \t \b \f as short escapes, other control characters as \u00xx, the rest raw.
func jsonString(_ s: String) -> String {
    var out = "\""
    for u in s.unicodeScalars {
        switch u {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        default:
            if u.value < 0x20 {
                out += "\\u00" + String(hexDigits[Int(u.value >> 4)].char) + String(hexDigits[Int(u.value & 0xf)].char)
            } else {
                out.unicodeScalars.append(u)
            }
        }
    }
    return out + "\""
}

private extension UInt8 {
    var char: Character { Character(Unicode.Scalar(self)) }
}
