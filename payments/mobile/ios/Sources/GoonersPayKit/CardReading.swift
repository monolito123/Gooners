import Crypto
import Foundation

/// The EMV application the cashier chose (Brazilian combo cards carry both).
public enum EmvApplication: String, Sendable, CaseIterable {
    case credit, debit
}

/// Card data encrypted on the device for the platform's decryptor; the app never sees it in
/// the clear in production.
public struct EncryptedCard: Sendable, Equatable {
    public var format: String
    public var ksn: String
    public var ciphertext: Data
}

/// Where card data comes from. In production this is ProximityReader (Tap to Pay on iPhone)
/// or a PCI PTS reader over Bluetooth: they encrypt inside their secure boundary and the app
/// only forwards the blob (docs/05 §3.2).
public protocol CardReader: Sendable {
    /// Shown on the waiting screen.
    var name: String { get }
    func read(amount: Money, application: EmvApplication) async throws -> EncryptedCard
}

/// Clear card data in the development format: fields and order match the platform's carddata.Card.
public struct DevCard: Sendable, Equatable, Decodable {
    public var pan: String
    public var expiry: String
    public var track2: String?
    public var panSequence: String?
    public var emv: String?
    public var aid: String?
    public var pinBlock: String?

    public init(pan: String, expiry: String, track2: String? = nil, panSequence: String? = nil, emv: String? = nil, aid: String? = nil, pinBlock: String? = nil) {
        self.pan = pan
        self.expiry = expiry
        self.track2 = track2
        self.panSequence = panSequence
        self.emv = emv
        self.aid = aid
        self.pinBlock = pinBlock
    }

    /// JSON in the platform's field order, absent fields left out.
    public func json() -> String {
        let fields: [(String, String?)] = [("pan", pan), ("expiry", expiry), ("track2", track2), ("pan_sequence", panSequence),
                                           ("emv", emv), ("aid", aid), ("pin_block", pinBlock)]
        return "{" + fields.compactMap { k, v in v.map { jsonString(k) + ":" + jsonString($0) } }.joined(separator: ",") + "}"
    }
}

/// carddata.DevFormat: nonce(12) ‖ AES-256-GCM(json(card)) ‖ tag, additional data = KSN.
public enum DevFormat {
    public static let name = "dev-aesgcm-v1"

    public static func encrypt(key: Data, ksn: String, card: DevCard, nonce: Data = .random(12)) throws -> Data {
        precondition(key.count == 32 && nonce.count == 12)
        let box = try AES.GCM.seal(Data(card.json().utf8), using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce), authenticating: Data(ksn.utf8))
        return nonce + box.ciphertext + box.tag
    }

    public static func decrypt(key: Data, ksn: String, blob: Data) throws -> DevCard {
        let box = try AES.GCM.SealedBox(combined: blob)
        let plain = try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: Data(ksn.utf8))
        return try GoonersPayAPI.decoder.decode(DevCard.self, from: plain)
    }
}

/// A sandbox reader: "taps" a scheme test card and encrypts it in the development format, so
/// the whole checkout runs against the sandbox without card hardware. The platform refuses
/// this format in production; the sandbox's key is public.
public final class SandboxCardReader: CardReader, @unchecked Sendable {
    public enum TestCard: String, CaseIterable, Sendable {
        case visaCredit, mastercard, elo

        public var pan: String {
            switch self {
            case .visaCredit: "4111111111111111"
            case .mastercard: "5555555555554444"
            case .elo: "6362970000457013"
            }
        }

        public var aid: String {
            switch self {
            case .visaCredit: "A0000000031010"
            case .mastercard: "A0000000041010"
            case .elo: "A0000004942010"
            }
        }

        public var label: String {
            switch self {
            case .visaCredit: "Visa crédito"
            case .mastercard: "Mastercard"
            case .elo: "Elo"
            }
        }
    }

    public let name = "Leitor de teste (sandbox)"
    private let devKey: Data
    private let lock = NSLock()
    private var counter = 0
    private var selected: TestCard
    /// Each reader holds its own copy of each test card: the test card's BIN and last four
    /// digits around random middle digits, and its own transaction counter (ATC, EMV tag
    /// 9F36). The platform's card-level fraud rules (velocity, counter continuity) then see one
    /// customer's card, not a number every sandbox user shares.
    private var issued: [TestCard: (pan: String, atc: Int)] = [:]

    public init(devKey: Data, card: TestCard = .visaCredit) {
        self.devKey = devKey
        selected = card
    }

    public var card: TestCard {
        get { lock.withLock { selected } }
        set { lock.withLock { selected = newValue } }
    }

    /// This reader's PAN for `c`.
    public func pan(of c: TestCard) -> String {
        lock.withLock { issue(c).pan }
    }

    private func issue(_ c: TestCard) -> (pan: String, atc: Int) {
        if let x = issued[c] { return x }
        let x = (Self.personalize(c.pan), 0)
        issued[c] = x
        return x
    }

    public func read(amount: Money, application: EmvApplication) async throws -> EncryptedCard {
        let (n, c, pan, atc) = lock.withLock {
            counter += 1
            let c = selected
            var x = issue(c)
            x.atc += 1
            issued[c] = x
            return (counter, c, x.pan, x.atc)
        }
        let ksn = "FFFF9876543210E" + String(repeating: "0", count: max(0, 5 - String(n).count)) + String(n)
        let dev = DevCard(pan: pan, expiry: "2911", emv: "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE119F3602" + String(format: "%04X", atc & 0xFFFF) + "9A032610299C0100", aid: c.aid)
        return EncryptedCard(format: DevFormat.name, ksn: ksn, ciphertext: try DevFormat.encrypt(key: devKey, ksn: ksn, card: dev))
    }

    /// Keeps `testPAN`'s first six and last four digits, randomizes the rest and fixes the Luhn digit.
    public static func personalize(_ testPAN: String) -> String {
        let middle = (0..<(testPAN.count - 11)).map { _ in String(Int.random(in: 0...9)) }.joined()
        return (0...9).map { String(testPAN.prefix(6)) + middle + String($0) + String(testPAN.suffix(4)) }.first(where: luhn)!
    }

    public static func luhn(_ pan: String) -> Bool {
        let sum = pan.reversed().enumerated().reduce(0) { acc, x in
            let d = Int(String(x.element))!
            return acc + (x.offset % 2 == 1 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d)
        }
        return sum % 10 == 0
    }
}
