import Foundation
import P256K

/// A Nostr event (NIP-01).
public struct NostrEvent: Codable, Sendable, Equatable {
    public var id: String
    public var pubkey: String
    public var createdAt: Int64
    public var kind: Int
    public var tags: [[String]]
    public var content: String
    public var sig: String

    public init(id: String = "", pubkey: String = "", createdAt: Int64, kind: Int, tags: [[String]], content: String, sig: String = "") {
        self.id = id
        self.pubkey = pubkey
        self.createdAt = createdAt
        self.kind = kind
        self.tags = tags
        self.content = content
        self.sig = sig
    }

    // Keys are matched after the decoder's snake_case conversion (see GoonersPayAPI.decoder).
    enum CodingKeys: String, CodingKey { case id, pubkey, createdAt, kind, tags, content, sig }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        pubkey = try c.decodeIfPresent(String.self, forKey: .pubkey) ?? ""
        createdAt = try c.decode(Int64.self, forKey: .createdAt)
        kind = try c.decode(Int.self, forKey: .kind)
        tags = try c.decode([[String]].self, forKey: .tags)
        content = try c.decode(String.self, forKey: .content)
        sig = try c.decodeIfPresent(String.self, forKey: .sig) ?? ""
    }

    /// The NIP-01 commitment [0, pubkey, created_at, kind, tags, content], escaped exactly as
    /// the platform and JSON.stringify do.
    public func serialize() -> String {
        "[0," + jsonString(pubkey) + ",\(createdAt),\(kind),[" +
            tags.map { "[" + $0.map(jsonString).joined(separator: ",") + "]" }.joined(separator: ",") +
            "]," + jsonString(content) + "]"
    }

    /// The event as JSON in NIP-01 field order (the body of a NIP-98 header).
    public func json() -> String {
        "{\"id\":" + jsonString(id) + ",\"pubkey\":" + jsonString(pubkey) + ",\"created_at\":\(createdAt),\"kind\":\(kind),\"tags\":[" +
            tags.map { "[" + $0.map(jsonString).joined(separator: ",") + "]" }.joined(separator: ",") +
            "],\"content\":" + jsonString(content) + ",\"sig\":" + jsonString(sig) + "}"
    }

    public func computeID() -> String { sha256(serialize()).hex }

    /// Checks the ID and the BIP-340 signature.
    public func verify() -> Bool {
        let computed = computeID()
        guard computed == id, let pub = Data(hex: pubkey), pub.count == 32, let s = Data(hex: sig), s.count == 64,
              let signature = try? P256K.Schnorr.SchnorrSignature(dataRepresentation: s) else { return false }
        var message = Array(Data(hex: computed)!)
        return P256K.Schnorr.XonlyKey(dataRepresentation: pub).isValid(signature, for: &message)
    }

    /// Signs with `keys`; `aux` is BIP-340 auxiliary randomness (fresh when nil).
    public func signed(by keys: NostrKeys, aux: Data? = nil) throws -> NostrEvent {
        var e = self
        e.pubkey = keys.publicKeyHex
        e.id = ""
        e.sig = ""
        e.id = e.computeID()
        e.sig = try keys.signSchnorr(Data(hex: e.id)!, aux: aux ?? .random(32)).hex
        return e
    }

    public func tag(_ name: String) -> [String]? { tags.first { $0.first == name } }
}

/// A secp256k1 key pair. On a phone the secret lives wrapped by the Secure Enclave and is
/// unwrapped only for a signature; this object holds it only while in use. Call `wipe()`.
public final class NostrKeys: @unchecked Sendable {
    public enum Failure: Error { case invalidSecret }

    private var secret: [UInt8]
    private let lock = NSLock()

    /// x-only public key, hex.
    public let publicKeyHex: String

    public init(secret: Data) throws {
        guard secret.count == 32, let k = try? P256K.Schnorr.PrivateKey(dataRepresentation: secret) else { throw Failure.invalidSecret }
        self.secret = Array(secret)
        publicKeyHex = Data(k.xonly.bytes).hex
    }

    deinit { wipe() }

    public var npub: String { try! Bech32.npub(publicKeyHex) }

    public func signSchnorr(_ message32: Data, aux: Data) throws -> Data {
        precondition(message32.count == 32 && aux.count == 32)
        let key = try lock.withLock { try P256K.Schnorr.PrivateKey(dataRepresentation: secret) }
        var message = Array(message32)
        var auxBytes = Array(aux)
        let sig = try auxBytes.withUnsafeMutableBytes { try key.signature(message: &message, auxiliaryRand: $0.baseAddress, strict: true) }
        return sig.dataRepresentation
    }

    public func exportSecret() -> Data { lock.withLock { Data(secret) } }

    public func nsec() -> String { Bech32.nsec(exportSecret()) }

    public func wipe() {
        lock.withLock {
            for i in secret.indices { secret[i] = 0 }
        }
    }

    public static func generate() -> NostrKeys {
        while true {
            if let k = try? NostrKeys(secret: .random(32)) { return k }
        }
    }

    public static func fromNsec(_ nsec: String) throws -> NostrKeys { try NostrKeys(secret: Bech32.decode(hrp: "nsec", nsec)) }
}
