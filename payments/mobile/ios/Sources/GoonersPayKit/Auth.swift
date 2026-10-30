import Crypto
import Foundation

/// NIP-98 (kind 27235): the device signs the exact URL, method and body of its login.
public enum NIP98 {
    public static let kind = 27235

    public static func event(keys: NostrKeys, method: String, url: String, body: Data, createdAt: Int64, aux: Data? = nil) throws -> NostrEvent {
        try NostrEvent(createdAt: createdAt, kind: kind, tags: [["u", url], ["method", method], ["payload", sha256(body).hex]], content: "")
            .signed(by: keys, aux: aux)
    }

    /// The Authorization header value: "Nostr " + base64(event JSON).
    public static func header(_ event: NostrEvent) -> String { "Nostr " + Data(event.json().utf8).base64EncodedString() }
}

/// A P-256 public key as a JSON Web Key.
public struct JWK: Codable, Sendable, Equatable {
    public var kty = "EC"
    public var crv = "P-256"
    public var x: String
    public var y: String

    public init(x: String, y: String) {
        self.x = x
        self.y = y
    }

    /// From an uncompressed point (0x04 ‖ X ‖ Y), what CryptoKit's x963Representation returns.
    public init(x963: Data) {
        precondition(x963.count == 65 && x963.first == 4)
        x = x963.subdata(in: 1..<33).base64URL
        y = x963.subdata(in: 33..<65).base64URL
    }

    /// RFC 7638 thumbprint: SHA-256 of the required members in lexicographic order.
    public func thumbprint() -> String { sha256("{\"crv\":\"\(crv)\",\"kty\":\"\(kty)\",\"x\":\"\(x)\",\"y\":\"\(y)\"}").base64URL }
}

/// Signs with a P-256 key that should never leave secure hardware (the Secure Enclave).
/// `sign` returns the raw 64-byte r‖s signature of SHA-256(data).
public protocol P256Signer: Sendable {
    var publicJWK: JWK { get }
    func sign(_ data: Data) throws -> Data
}

/// A software P-256 key: tests and the simulator, which has no Secure Enclave.
public struct SoftwareP256Signer: P256Signer {
    private let key: P256.Signing.PrivateKey
    public let publicJWK: JWK

    public init(key: P256.Signing.PrivateKey = .init()) {
        self.key = key
        publicJWK = JWK(x963: key.publicKey.x963Representation)
    }

    public func sign(_ data: Data) throws -> Data { try key.signature(for: data).rawRepresentation }
}

/// DPoP proofs (RFC 9449) that bind every request to the device's hardware key.
public enum DPoP {
    public static func proof(signer: P256Signer, method: String, url: String, accessToken: String?, now: Int64,
                             jti: String = Data.random(16).base64URL) throws -> String {
        let j = signer.publicJWK
        let header = "{\"typ\":\"dpop+jwt\",\"alg\":\"ES256\",\"jwk\":{\"kty\":\(jsonString(j.kty)),\"crv\":\(jsonString(j.crv)),\"x\":\(jsonString(j.x)),\"y\":\(jsonString(j.y))}}"
        var claims = "{\"jti\":\(jsonString(jti)),\"htm\":\(jsonString(method)),\"htu\":\(jsonString(htu(url))),\"iat\":\(now)"
        if let t = accessToken { claims += ",\"ath\":" + jsonString(sha256(t).base64URL) }
        claims += "}"
        let input = Data(header.utf8).base64URL + "." + Data(claims.utf8).base64URL
        return input + "." + (try signer.sign(Data(input.utf8))).base64URL
    }

    /// The URL a proof names: no query and no fragment (RFC 9449 §4.2).
    public static func htu(_ url: String) -> String {
        String(url.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]
            .split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
    }
}

/// The merchant root key's device authorization list (kind 17710, docs/03 §4.2).
public enum DeviceList {
    public static let kind = 17710

    public struct Entry: Codable, Sendable, Equatable, Hashable {
        public var pubkeyHex: String
        public var platform: String
        public var label: String

        public init(pubkeyHex: String, platform: String, label: String) {
            self.pubkeyHex = pubkeyHex
            self.platform = platform
            self.label = label
        }
    }

    public static func event(root: NostrKeys, merchantID: String, devices: [Entry], createdAt: Int64, aux: Data? = nil) throws -> NostrEvent {
        precondition((1...20).contains(devices.count), "a device list holds 1 to 20 devices")
        var tags = [["v", "1"], ["merchant", merchantID]]
        for d in devices { tags.append(["device", d.pubkeyHex, d.platform, String(d.label.prefix(40)), String(createdAt)]) }
        return try NostrEvent(createdAt: createdAt, kind: kind, tags: tags, content: "").signed(by: root, aux: aux)
    }
}
