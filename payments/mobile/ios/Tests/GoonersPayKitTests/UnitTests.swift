import Foundation
import XCTest
@testable import GoonersPayKit

final class UnitTests: XCTestCase {
    func testParsesWhatPeopleType() {
        let ok: [String: Int64] = ["150": 15000, "150,5": 15050, "150,05": 15005, " 0,99 ": 99, "1.234,56": 123456, "1.234.567": 123456700]
        for (s, want) in ok { XCTAssertEqual(Money.parseReais(s)?.centavos, want, s) }
        for s in ["", ",50", "1,234", "12.34", "1.23,00", "abc", "-5", "1,2,3", "12345678901"] { XCTAssertNil(Money.parseReais(s), s) }
    }

    func testKeypadEntry() {
        var m = Money.zero
        for d in [1, 2, 9, 9, 0] { m = m.typed(d) }
        XCTAssertEqual(m.centavos, 12990)
        XCTAssertEqual(m.backspace().centavos, 1299)
        XCTAssertEqual(Money(Money.maxKeypad).typed(9), Money(Money.maxKeypad))
    }

    func testDPoPProofVerifiesWithTheJWK() throws {
        let signer = SoftwareP256Signer()
        let proof = try DPoP.proof(signer: signer, method: "POST", url: "https://api.example/v1/payouts?x=1#f", accessToken: "sess_test_abc", now: 1_700_000_000)
        let parts = proof.split(separator: ".").map(String.init)
        XCTAssertEqual(parts.count, 3)
        let header = try JSONSerialization.jsonObject(with: Data(base64URL: parts[0])!) as! [String: Any]
        let claims = try JSONSerialization.jsonObject(with: Data(base64URL: parts[1])!) as! [String: Any]
        XCTAssertEqual(header["typ"] as? String, "dpop+jwt")
        XCTAssertEqual(claims["htu"] as? String, "https://api.example/v1/payouts")
        XCTAssertEqual(claims["ath"] as? String, sha256("sess_test_abc").base64URL)
        XCTAssertEqual((header["jwk"] as? [String: String])?["x"], signer.publicJWK.x)
        XCTAssertEqual(Data(base64URL: parts[2])?.count, 64)
    }

    func testEventJSONRoundTripsThroughTheAPIDecoder() throws {
        let k = NostrKeys.generate()
        let ev = try NostrEvent(createdAt: 1_700_000_000, kind: 1, tags: [["t", "a\"b\\c\n"]], content: "olá\u{01}").signed(by: k)
        XCTAssertTrue(ev.verify())
        XCTAssertEqual(try GoonersPayAPI.decoder.decode(NostrEvent.self, from: Data(ev.json().utf8)), ev)
        XCTAssertEqual(try GoonersPayAPI.decoder.decode(NostrEvent.self, from: GoonersPayAPI.encoder.encode(ev)), ev)
        k.wipe()
        XCTAssertEqual(k.exportSecret(), Data(count: 32))
    }

    func testOutcomeMessages() {
        let r = TerminalResult(status: "approved", paymentIntentId: "pi_1", card: CardView(brand: "visa", last4: "1111"),
                               receipt: ReceiptView(claimQr: "https://r/#k=1"), settlement: SettlementView(mode: "instant", netAvailable: 950))
        XCTAssertEqual(CheckoutController.outcome(Money(1000), r),
                       .approved(Money(1000), method: "Visa •••• 1111", claimURL: "https://r/#k=1", netAvailable: 950, instant: true))
        XCTAssertEqual(CheckoutController.outcome(Money(1), TerminalResult(status: "pin_required", paymentIntentId: "pi")).amount, Money(1))
    }
}

extension TerminalResult {
    init(status: String, paymentIntentId: String, card: CardView? = nil, receipt: ReceiptView? = nil, settlement: SettlementView? = nil) {
        self.init(status: status, paymentIntentId: paymentIntentId, responseCode: nil, authorizationCode: nil, declineCode: nil,
                  customerMessage: nil, card: card, receipt: receipt, settlement: settlement)
    }
}

extension CardView {
    init(brand: String, last4: String) { self.init(brand: brand, last4: last4, funding: nil) }
}

extension ReceiptView {
    init(claimQr: String) { self.init(nostrEventId: nil, claimQr: claimQr, claimUrl: nil) }
}

extension SettlementView {
    init(mode: String, netAvailable: Int64) { self.init(mode: mode, merchantDiscount: nil, advanceFee: nil, netAvailable: netAvailable, settlesOn: nil) }
}
