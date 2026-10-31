import Crypto
import Foundation

/// Certificate pinning of the platform's API host: the SHA-256 of the SubjectPublicKeyInfo of
/// its current key and of a backup key, in OkHttp's "sha256/<base64>" form (the same pins the
/// Android app uses). A user-installed or mis-issued authority cannot read the app's traffic.
public struct CertificatePins: Sendable, Equatable {
    public var host: String
    public var pins: Set<String>

    public init(host: String, pins: Set<String>) {
        self.host = host
        self.pins = pins
    }

    public enum KeyType: Sendable { case ec, rsa }

    /// The pin of a public key as Apple's Security framework exports it: the X9.63 point for
    /// EC keys, PKCS#1 RSAPublicKey for RSA (conformance vectors, spki_pins).
    public static func pin(keyType: KeyType, bits: Int, external: Data) -> String? {
        guard let spki = subjectPublicKeyInfo(keyType: keyType, bits: bits, external: external) else { return nil }
        return "sha256/" + Data(SHA256.hash(data: spki)).base64EncodedString()
    }

    static func subjectPublicKeyInfo(keyType: KeyType, bits: Int, external: Data) -> Data? {
        switch (keyType, bits) {
        case (.ec, 256) where external.count == 65:
            return Data(hex: "3059301306072a8648ce3d020106082a8648ce3d030107034200")! + external
        case (.ec, 384) where external.count == 97:
            return Data(hex: "3076301006072a8648ce3d020106052b81040022036200")! + external
        case (.rsa, _):
            let algorithm = der(0x30, Data(hex: "06092a864886f70d0101010500")!)
            return der(0x30, algorithm + der(0x03, Data([0]) + external))
        default:
            return nil
        }
    }

    /// One DER element: tag, length, value.
    private static func der(_ tag: UInt8, _ value: Data) -> Data {
        var out = Data([tag])
        let n = value.count
        if n < 0x80 {
            out.append(UInt8(n))
        } else {
            var len = withUnsafeBytes(of: UInt32(n).bigEndian, Array.init).drop { $0 == 0 }
            if len.isEmpty { len = [0] }
            out.append(0x80 | UInt8(len.count))
            out.append(contentsOf: len)
        }
        return out + value
    }
}
