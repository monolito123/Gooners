import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import GoonersPayKit

private final class Counter: StanSource, @unchecked Sendable {
    private let lock = NSLock()
    private var n = 0
    func next() -> String {
        lock.withLock {
            n += 1
            let s = String(n)
            return String(repeating: "0", count: 6 - s.count) + s
        }
    }
}

/// The app's protocol against a live sandbox (go run ./cmd/smoke -serve FILE, then
/// GOONERSPAY_SANDBOX=FILE). Skipped when the variable is not set.
final class SandboxIntegrationTests: XCTestCase {
    struct Info: Decodable { var apiUrl, apiKey, devCardKey: String }

    @MainActor
    func testEnrollLoginSellAndPayOut() async throws {
        guard let file = ProcessInfo.processInfo.environment["GOONERSPAY_SANDBOX"] else { throw XCTSkip("GOONERSPAY_SANDBOX not set") }
        let info = try GoonersPayAPI.decoder.decode(Info.self, from: Data(contentsOf: URL(fileURLWithPath: file)))

        // The partner creates the merchant and its enrollment code (the only steps the app does not do).
        func partner(_ path: String, _ body: String) async throws -> [String: Any] {
            var req = URLRequest(url: URL(string: info.apiUrl + path)!)
            req.httpMethod = "POST"
            req.httpBody = Data(body.utf8)
            req.setValue("Bearer \(info.apiKey)", forHTTPHeaderField: "Authorization")
            req.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let (data, resp) = try await URLSession.shared.data(for: req)
            XCTAssertEqual((resp as! HTTPURLResponse).statusCode, 201, String(decoding: data, as: UTF8.self))
            return try JSONSerialization.jsonObject(with: data) as! [String: Any]
        }
        let merchantID = try await partner("/v1/merchants", #"{"legal":{"document":{"type":"cnpj","number":"12345678000195"},"legal_name":"Padaria Swift Ltda","trade_name":"Padaria Swift","mcc":"5812","city":"Recife"},"settlement":{"default_speed":"instant"}}"#)["id"] as! String
        let code = try await partner("/v1/merchants/\(merchantID)/enrollment-codes", "")["code"] as! String

        // The phone: lookup, root key and device key, device list, enrollment, login.
        let api = GoonersPayAPI(baseURL: info.apiUrl)
        let enrollment = try await api.lookupEnrollment(code: code)
        XCTAssertEqual(enrollment.merchantId, merchantID)
        XCTAssertNil(enrollment.rootNpub)
        let root = NostrKeys.generate()
        let device = NostrKeys.generate()
        let dpop = SoftwareP256Signer()
        let now = Int64(Date().timeIntervalSince1970)
        let owner = DeviceList.Entry(pubkeyHex: device.publicKeyHex, platform: "ios", label: "Caixa 1")
        let list = try DeviceList.event(root: root, merchantID: merchantID, devices: [owner], createdAt: now)
        let bound = try await api.enroll(code: code, DeviceCreate(deviceNpub: device.npub, platform: "ios", model: "XCTest", attestation: ["type": "none"], authorizationEvent: list))
        XCTAssertNotNil(bound.terminalId)
        let secret = device.exportSecret()
        let journal = Journal(store: MemoryJournalStore(), devicePubkeyHex: device.publicKeyHex, merchantRootPubHex: root.publicKeyHex, appVersion: "test")
        journal.append("session_start")
        let authed = api.authed(deviceKey: { try NostrKeys(secret: secret) }, dpop: dpop, session: try await api.login(device: device, dpop: dpop),
                                onKey: { _ = try? journal.signPending($0) })
        let merchant = try await authed.merchant()
        XCTAssertEqual(merchant.id, merchantID)

        // A card sale through the real checkout controller and the sandbox reader.
        let reader = SandboxCardReader(devKey: Data(hex: info.devCardKey)!, card: .mastercard)
        let checkout = CheckoutController(api: { authed }, reader: { reader }, stan: Counter(), pixPoll: .milliseconds(200), journal: { journal })
        func settled() async throws -> CheckoutState {
            for _ in 0..<300 {
                if checkout.state.isFinal { return checkout.state }
                if case .pixQR = checkout.state { return checkout.state }
                try await Task.sleep(for: .milliseconds(100))
            }
            return checkout.state
        }
        for d in [1, 2, 9, 9, 0] { checkout.digit(d) }
        checkout.charge()
        checkout.card(.credit)
        let sale = try await settled()
        guard case let .approved(paid) = sale else { return XCTFail("\(sale)") }
        XCTAssertEqual(paid.amount, Money(12990))
        XCTAssertTrue(paid.method.contains("5555") || paid.method.contains("4444"), paid.method)
        XCTAssertTrue(paid.claimURL?.contains("#k=") ?? false)
        XCTAssertEqual(paid.returnsIn, .seconds(4)) // back to the keypad by itself (docs/06 §5)

        // Pix: a dynamic QR whose amount the app checks before showing it.
        checkout.nextSale()
        for d in [2, 3, 9, 0] { checkout.digit(d) }
        checkout.charge()
        checkout.pix()
        let qr = try await settled()
        guard case let .pixQR(_, _, brCode) = qr else { return XCTFail("\(qr)") }
        let decoded = try BrCode.decode(brCode)
        XCTAssertTrue(decoded.dynamic && decoded.url != nil && (decoded.amount == nil || decoded.amount == "23.90"))
        checkout.nextSale()

        // The journal: signed with the key unwrapped for login, uploaded in order, linked from the sale.
        try journal.signPending(device)
        let sent = journal.toUpload()
        let synced = try await authed.syncJournal(journal)
        XCTAssertEqual(synced?.status, "consistent")
        XCTAssertEqual(synced?.head?.seq, journal.lastSeq)
        XCTAssertEqual(synced?.accepted, sent.count)
        let state = try await authed.journalState()
        XCTAssertEqual(state.status, "consistent")
        let tap = try XCTUnwrap(sent.first { $0.content.contains("\"tap_started\"") })
        guard case let .object(fields) = try JSONDecoder().decode(JSONValue.self, from: Data(tap.content.utf8)),
              case let .string(saleID) = fields["payment_intent_id"] else { return XCTFail("tap_started without a payment") }
        var req = URLRequest(url: URL(string: info.apiUrl + "/v1/payment-intents/\(saleID)/journal")!)
        req.setValue("Bearer \(info.apiKey)", forHTTPHeaderField: "Authorization")
        let (body, _) = try await URLSession.shared.data(for: req)
        let evidence = try JSONSerialization.jsonObject(with: body) as! [String: Any]
        XCTAssertEqual((evidence["data"] as? [Any])?.count, 2) // tap_started and auth_result

        // Balance and a payout to a Pix key.
        let balance = try await authed.balance()
        XCTAssertGreaterThan(balance.available, 0)
        let quote = try await authed.quote(amount: min(balance.available, 5_000), destination: PixDestination(keyType: "cnpj", key: "12345678000195"))
        let payout = try await authed.payout(quoteID: quote.id)
        XCTAssertEqual(payout.status, "paid")
        let entries = try await authed.entries(limit: 5)
        XCTAssertFalse(entries.data.isEmpty)
        // Statements: the session sees only its own merchant's (today's closes after 01:00 tomorrow).
        let settlements = try await authed.settlements()
        XCTAssertTrue(settlements.data.allSatisfy { $0.merchantId == merchantID })

        // The owner's phone adds a cashier phone, then removes it: its session ends at once.
        let cashier = NostrKeys.generate()
        let cashierDpop = SoftwareP256Signer()
        let both = try DeviceList.event(root: root, merchantID: merchantID, devices: [owner, .init(pubkeyHex: cashier.publicKeyHex, platform: "android", label: "Caixa 2")], createdAt: now + 1)
        _ = try await authed.registerDevice(DeviceCreate(deviceNpub: cashier.npub, platform: "android", authorizationEvent: both))
        let cashierSecret = cashier.exportSecret()
        let cashierAuthed = api.authed(deviceKey: { try NostrKeys(secret: cashierSecret) }, dpop: cashierDpop,
                                       session: try await api.login(device: cashier, dpop: cashierDpop))
        let cashierTerminal = await cashierAuthed.session.terminalId
        let ownerTerminal = await authed.session.terminalId
        XCTAssertNotNil(cashierTerminal)
        XCTAssertNotEqual(cashierTerminal, ownerTerminal)
        let onlyOwner = try DeviceList.event(root: root, merchantID: merchantID, devices: [owner], createdAt: now + 2)
        _ = try await authed.registerDevice(DeviceCreate(deviceNpub: device.npub, platform: "ios", authorizationEvent: onlyOwner))
        do {
            _ = try await cashierAuthed.merchant()
            XCTFail("a removed device kept its session")
        } catch let e as APIError {
            XCTAssertEqual(e.status, 401)
        }
        for k in [root, device, cashier] { k.wipe() }
    }
}
