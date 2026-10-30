import Foundation

// The subset of payments/api/openapi.yaml the merchant app uses. Property names are the
// camelCase form of the API's snake_case fields (GoonersPayAPI converts between them).

public struct Problem: Codable, Sendable, Equatable {
    public var type: String?
    public var title: String?
    public var status: Int?
    public var code: String?
    public var detail: String?
}

public struct Enrollment: Codable, Sendable, Equatable {
    public var merchantId: String
    public var tradeName: String
    public var rootNpub: String?
    public var expiresAt: String
}

public struct DeviceCreate: Codable, Sendable, Equatable {
    public var deviceNpub: String
    public var platform: String
    public var model: String?
    public var attestation: [String: String]?
    public var authorizationEvent: NostrEvent

    public init(deviceNpub: String, platform: String, model: String? = nil, attestation: [String: String]? = nil, authorizationEvent: NostrEvent) {
        self.deviceNpub = deviceNpub
        self.platform = platform
        self.model = model
        self.attestation = attestation
        self.authorizationEvent = authorizationEvent
    }
}

public struct Device: Codable, Sendable, Equatable {
    public var id: String
    public var merchantId: String
    public var deviceNpub: String
    public var platform: String?
    public var label: String?
    public var status: String
    public var capabilities: [String]?
    public var terminalId: String?
}

struct LoginBody: Codable, Sendable {
    var dpopJwk: JWK
    var deviceId: String?
}

public struct Session: Codable, Sendable, Equatable {
    public var sessionToken: String
    public var tokenType: String
    public var expiresIn: Int64
    public var merchantId: String
    public var deviceId: String
    public var terminalId: String?
    public var accountId: String
    public var scopes: [String]?
}

public struct Merchant: Codable, Sendable, Equatable {
    public var id: String
    public var accountId: String
    public var tradeName: String
    public var status: String
    public var rootNpub: String?
}

public struct IntentCreate: Codable, Sendable, Equatable {
    public var amount: Int64
    public var channel: String?
    public var paymentMethodTypes: [String]?
    public var description: String?

    public init(amount: Int64, channel: String? = nil, paymentMethodTypes: [String]? = nil, description: String? = nil) {
        self.amount = amount
        self.channel = channel
        self.paymentMethodTypes = paymentMethodTypes
        self.description = description
    }
}

public struct NextAction: Codable, Sendable, Equatable {
    public var type: String
    public var txid: String?
    public var brCode: String?
}

public struct PaymentIntent: Codable, Sendable, Equatable {
    public var id: String
    public var status: String
    public var amount: Int64
    public var merchantId: String
    public var nextAction: NextAction?
    public var receipt: ReceiptView?
}

public struct Sred: Codable, Sendable, Equatable {
    public var format: String
    public var ksn: String
    public var ciphertext: String
}

public struct TerminalAuthorization: Codable, Sendable, Equatable {
    public var paymentIntentId: String
    public var terminalId: String
    public var stan: String
    public var emvApplication: String
    public var localTime: String
    public var sred: Sred
    /// The device's tap_started journal entry; the receipt links to it (docs/03 §3.3).
    public var journalEventId: String?
}

struct JournalUpload: Codable, Sendable {
    var entries: [NostrEvent]
}

public struct CardView: Codable, Sendable, Equatable {
    public var brand: String?
    public var last4: String?
    public var funding: String?
}

public struct ReceiptView: Codable, Sendable, Equatable {
    public var nostrEventId: String?
    public var claimQr: String?
    public var claimUrl: String?
}

public struct SettlementView: Codable, Sendable, Equatable {
    public var mode: String?
    public var merchantDiscount: Int64?
    public var advanceFee: Int64?
    public var netAvailable: Int64?
    public var settlesOn: String?
}

public struct TerminalResult: Codable, Sendable, Equatable {
    public var status: String
    public var paymentIntentId: String
    public var responseCode: String?
    public var authorizationCode: String?
    public var declineCode: String?
    public var customerMessage: String?
    public var card: CardView?
    public var receipt: ReceiptView?
    public var settlement: SettlementView?
}

public struct PendingDay: Codable, Sendable, Equatable, Hashable {
    public var date: String
    public var amount: Int64
}

public struct Balance: Codable, Sendable, Equatable {
    public var accountId: String
    public var available: Int64
    public var pending: Int64
    public var reserved: Int64?
    public var instantEligible: Int64?
    public var pendingByDate: [PendingDay]?
}

public struct Entry: Codable, Sendable, Equatable, Hashable {
    public var journalId: String
    public var direction: String
    public var amount: Int64
    public var type: String
    public var reference: String?
    public var postedAt: String
}

public struct Entries: Codable, Sendable, Equatable {
    public var data: [Entry]
    public var hasMore: Bool?
}

public struct PixDestination: Codable, Sendable, Equatable {
    public var type = "pix"
    public var keyType: String
    public var key: String

    public init(keyType: String, key: String) {
        self.keyType = keyType
        self.key = key
    }
}

struct QuoteRequest: Codable, Sendable {
    var accountId: String
    var amount: Int64
    var speed = "instant"
    var destination: PixDestination
}

public struct Quote: Codable, Sendable, Equatable {
    public var id: String
    public var amount: Int64
    public var feeTotal: Int64
    public var netToDestination: Int64
    public var expiresAt: String
}

struct PayoutRequest: Codable, Sendable {
    var quoteId: String
}

public struct Payout: Codable, Sendable, Equatable {
    public var id: String
    public var status: String
    public var amount: Int64
    public var endToEndId: String?
    public var reason: String?
}

public struct EnrollmentCode: Codable, Sendable, Equatable {
    public var code: String
    public var merchantId: String
    public var expiresAt: String
}
