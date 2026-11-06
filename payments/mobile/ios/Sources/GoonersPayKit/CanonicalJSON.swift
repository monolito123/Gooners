import Foundation

/// A JSON value with integers only, as canonical JSON allows (docs/03 §2.2).
public indirect enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case int(Int64)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let i = try? c.decode(Int64.self) {
            self = .int(i)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSONValue].self) {
            self = .array(a)
        } else {
            self = .object(try c.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(b): try c.encode(b)
        case let .int(i): try c.encode(i)
        case let .string(s): try c.encode(s)
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }

    /// Keys sorted, no whitespace, NIP-01 string escaping: the same bytes in Swift, Kotlin,
    /// Go and JavaScript (conformance vectors, canonical_json).
    public var canonical: String {
        switch self {
        case .null: "null"
        case let .bool(b): b ? "true" : "false"
        case let .int(i): String(i)
        case let .string(s): jsonString(s)
        case let .array(a): "[" + a.map(\.canonical).joined(separator: ",") + "]"
        case let .object(o):
            "{" + o.keys.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
                .map { jsonString($0) + ":" + o[$0]!.canonical }.joined(separator: ",") + "}"
        }
    }
}
