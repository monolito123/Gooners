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
    /// Sent with a first login when the platform asks for it (attestation_required).
    var attestation: [String: String]?
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
    /// Credit in parcelas; one payment when nil (docs/06 §5).
    public var installments: Installments?

    public init(amount: Int64, channel: String? = nil, paymentMethodTypes: [String]? = nil, description: String? = nil, installments: Installments? = nil) {
        self.amount = amount
        self.channel = channel
        self.paymentMethodTypes = paymentMethodTypes
        self.description = description
        self.installments = installments
    }
}

/// Parcelas the merchant finances ("parcelado lojista").
public struct Installments: Codable, Sendable, Equatable {
    public var count: Int
    public var type: String = "merchant"

    public init(count: Int, type: String = "merchant") {
        self.count = count
        self.type = type
    }
}

public struct NextAction: Codable, Sendable, Equatable {
    public var type: String
    public var txid: String?
    public var brCode: String?
    // crypto_transfer: send exactly amount of asset on network to address (docs/09)
    public var asset: String?
    public var network: String?
    public var address: String?
    public var memo: String?
    public var amount: String?
    public var price: String?
    public var uri: String?
    public var expiresAt: String?
}

struct CryptoConfirm: Codable, Sendable {
    var paymentMethodType = "crypto"
    var asset: String
    var network: String
}

struct RefundCreate: Codable, Sendable {
    var paymentIntentId: String
    var amount: Int64
}

public struct Refund: Codable, Sendable, Equatable {
    public var id: String
    public var status: String
    public var amount: Int64
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
    /// The phone's own risk score (docs/07 §3).
    public var deviceRisk: DeviceRisk? = nil
}

public struct DeviceRisk: Codable, Sendable, Equatable {
    public var score: Double
    public var model: String
    public var signals: [String]
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
    /// The sale waits for a risk review before it settles (docs/07 §3.6).
    public var held: Bool?
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
    /// Receivables a fraud shield review holds; not in `pending` (docs/07 §3.6).
    public var held: Int64?
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

public struct Settlement: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var merchantId: String?
    public var date: String
    public var currency: String?
    public var gross: Int64?
    public var fees: Int64?
    public var refunds: Int64?
    public var chargebacks: Int64?
    public var net: Int64?
    public var transactionCount: Int?
}

public struct Settlements: Codable, Sendable, Equatable {
    public var data: [Settlement]
    public var hasMore: Bool?
}

public struct MerklePath: Codable, Sendable, Equatable {
    public var leafIndex: Int64
    public var treeSize: Int64
    public var auditPath: [String]
    public var root: String?
}

public struct InclusionProof: Codable, Sendable, Equatable {
    public var receiptEventId: String
    public var statementInclusion: MerklePath
    public var transparencyInclusion: MerklePath?
}

public struct TransparencyRoot: Codable, Sendable, Equatable {
    public var date: String
    public var treeSize: Int64
    public var root: String
    public var event: NostrEvent
}


// MARK: - Digital assets, international accounts and B3 (docs/09)

public struct Holding: Codable, Sendable, Equatable, Identifiable {
    public var asset: String
    public var kind: String
    public var units: Int64
    public var amount: String
    /// At the best price to sell now; nil when no venue quotes it.
    public var valueBrl: Int64?
    public var id: String { asset }
}

public struct Holdings: Codable, Sendable, Equatable {
    public var data: [Holding]
}

public struct ReceiveDetails: Codable, Sendable, Equatable {
    public var currency: String?
    public var holder: String
    public var bank: String
    public var iban: String?
    public var bic: String?
    public var accountNumber: String?
    public var routingNumber: String?
    public var sortCode: String?
    public var reference: String
}

public struct InternationalAccount: Codable, Sendable, Equatable, Identifiable {
    public var currency: String
    public var units: Int64
    public var amount: String
    public var receive: ReceiveDetails
    public var id: String { currency }
}

public struct InternationalAccounts: Codable, Sendable, Equatable {
    public var data: [InternationalAccount]
}

public struct Position: Codable, Sendable, Equatable, Identifiable {
    public var ticker: String
    public var name: String?
    public var quantity: Int64
    public var cost: Int64
    public var last: String?
    public var value: Int64?
    public var result: Int64?
    public var id: String { ticker }
}

public struct InvestmentOrder: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var ticker: String
    public var side: String
    public var quantity: Int64
    public var total: Int64
    public var status: String
    public var settlesOn: String?
}

public struct Portfolio: Codable, Sendable, Equatable {
    public var positions: [Position]
    public var orders: [InvestmentOrder]

    public init(positions: [Position] = [], orders: [InvestmentOrder] = []) {
        self.positions = positions
        self.orders = orders
    }
}

public struct ConversionRequest: Codable, Sendable, Equatable {
    public var side: String
    public var asset: String
    public var brlAmount: Int64?
    public var amount: String?

    public init(side: String, asset: String, brlAmount: Int64? = nil, amount: String? = nil) {
        self.side = side
        self.asset = asset
        self.brlAmount = brlAmount
        self.amount = amount
    }
}

public struct Conversion: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var side: String
    public var asset: String
    public var amount: String
    public var brlUnits: Int64
    public var fee: Int64
    public var tax: Int64?
    public var total: Int64
    public var price: String
    public var venue: String?
    public var status: String
    public var expiresAt: String
}
