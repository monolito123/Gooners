import Foundation

/// Reads a Pix BR Code (EMV MPM, BCB Manual de Padrões para Iniciação do Pix). The app shows
/// the code the platform returns as a QR; decoding it checks the CRC and that the amount is
/// what the cashier typed before the customer sees it.
public struct BrCode: Sendable, Equatable {
    public enum Failure: Error { case noCRC, crcMismatch, truncated, badFormat, notPix }

    public var dynamic: Bool
    public var url: String?
    public var key: String?
    public var amount: String?
    public var merchantName: String
    public var merchantCity: String

    private static let gui = "br.gov.bcb.pix"

    public static func crc16(_ s: String) -> String {
        var crc: UInt16 = 0xFFFF
        for b in s.utf8 {
            crc ^= UInt16(b) << 8
            for _ in 0..<8 { crc = crc & 0x8000 != 0 ? (crc << 1) ^ 0x1021 : crc << 1 }
        }
        let h = String(crc, radix: 16, uppercase: true)
        return String(repeating: "0", count: 4 - h.count) + h
    }

    /// Fields by ID; lengths count characters, as the BR Code is built from them.
    private static func fields(_ s: String) throws -> [String: String] {
        let c = Array(s)
        var out = [String: String]()
        var i = 0
        while i < c.count {
            guard i + 4 <= c.count, let len = Int(String(c[i + 2..<i + 4])) else { throw Failure.truncated }
            guard i + 4 + len <= c.count else { throw Failure.truncated }
            out[String(c[i..<i + 2])] = String(c[i + 4..<i + 4 + len])
            i += 4 + len
        }
        return out
    }

    public static func decode(_ code: String) throws -> BrCode {
        let c = Array(code)
        guard c.count > 8, String(c[c.count - 8..<c.count - 4]) == "6304" else { throw Failure.noCRC }
        guard crc16(String(c[0..<c.count - 4])) == String(c[c.count - 4..<c.count]).uppercased() else { throw Failure.crcMismatch }
        let f = try fields(code)
        guard f["00"] == "01" else { throw Failure.badFormat }
        guard let account = f["26"] else { throw Failure.notPix }
        let mai = try fields(account)
        guard mai["00"]?.lowercased() == gui else { throw Failure.notPix }
        return BrCode(dynamic: f["01"] == "12", url: mai["25"], key: mai["01"], amount: f["54"], merchantName: f["59"] ?? "", merchantCity: f["60"] ?? "")
    }
}
