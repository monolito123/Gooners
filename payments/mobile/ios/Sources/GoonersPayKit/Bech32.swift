import Foundation

/// BIP-173 bech32 as NIP-19 uses it (npub, nsec).
public enum Bech32 {
    public enum Failure: Error { case wrongPrefix, invalidCharacter, badChecksum, invalidPadding, badLength }

    private static let charset = Array("qpzry9x8gf2tvdw0s3jn54khce6mua7l".utf8)
    private static let gen: [UInt32] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

    private static func polymod(_ values: [UInt8]) -> UInt32 {
        var chk: UInt32 = 1
        for v in values {
            let b = chk >> 25
            chk = (chk & 0x1ffffff) << 5 ^ UInt32(v)
            for i in 0..<5 where (b >> i) & 1 == 1 { chk ^= gen[i] }
        }
        return chk
    }

    private static func hrpExpand(_ hrp: String) -> [UInt8] {
        let h = Array(hrp.utf8)
        return h.map { $0 >> 5 } + [0] + h.map { $0 & 31 }
    }

    private static func convertBits(_ data: [UInt8], from: Int, to: Int, pad: Bool) throws -> [UInt8] {
        var acc = 0, bits = 0
        var out = [UInt8]()
        let maxv = (1 << to) - 1
        for b in data {
            acc = (acc << from) | Int(b)
            bits += from
            while bits >= to {
                bits -= to
                out.append(UInt8((acc >> bits) & maxv))
            }
        }
        if pad {
            if bits > 0 { out.append(UInt8((acc << (to - bits)) & maxv)) }
        } else if bits >= from || ((acc << (to - bits)) & maxv) != 0 {
            throw Failure.invalidPadding
        }
        return out
    }

    public static func encode(hrp: String, data: Data) -> String {
        let values = try! convertBits(Array(data), from: 8, to: 5, pad: true)
        let checksum = polymod(hrpExpand(hrp) + values + [0, 0, 0, 0, 0, 0]) ^ 1
        var out = Array(hrp.utf8) + [UInt8(ascii: "1")]
        out += values.map { charset[Int($0)] }
        out += (0..<6).map { charset[Int((checksum >> (5 * (5 - UInt32($0)))) & 31)] }
        return String(decoding: out, as: UTF8.self)
    }

    /// Decodes and checks the checksum; returns the payload bytes.
    public static func decode(hrp expected: String, _ s: String) throws -> Data {
        let lower = s.lowercased()
        guard lower.hasPrefix(expected + "1") else { throw Failure.wrongPrefix }
        let data = try lower.utf8.dropFirst(expected.utf8.count + 1).map { c -> UInt8 in
            guard let i = charset.firstIndex(of: c) else { throw Failure.invalidCharacter }
            return UInt8(i)
        }
        guard data.count >= 6, polymod(hrpExpand(expected) + data) == 1 else { throw Failure.badChecksum }
        return Data(try convertBits(Array(data.dropLast(6)), from: 5, to: 8, pad: false))
    }

    public static func npub(_ pubkeyHex: String) throws -> String {
        guard let b = Data(hex: pubkeyHex), b.count == 32 else { throw Failure.badLength }
        return encode(hrp: "npub", data: b)
    }

    public static func nsec(_ secret: Data) -> String {
        precondition(secret.count == 32)
        return encode(hrp: "nsec", data: secret)
    }
}
