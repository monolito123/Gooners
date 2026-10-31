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
        // Plain coders keep NIP-01's field names too.
        let plain = String(decoding: try JSONEncoder().encode(ev), as: UTF8.self)
        XCTAssertTrue(plain.contains("\"created_at\":") && !plain.contains("createdAt"))
        XCTAssertEqual(try JSONDecoder().decode(NostrEvent.self, from: Data(plain.utf8)), ev)
        k.wipe()
        XCTAssertEqual(k.exportSecret(), Data(count: 32))
    }

    func testOutcomeMessages() {
        let r = TerminalResult(status: "approved", paymentIntentId: "pi_1", card: CardView(brand: "visa", last4: "1111"),
                               receipt: ReceiptView(claimQr: "https://r/#k=1"), settlement: SettlementView(mode: "instant", netAvailable: 950))
        XCTAssertEqual(CheckoutController.outcome(Money(1000), r),
                       .approved(Sale(amount: Money(1000), method: "Visa •••• 1111", claimURL: "https://r/#k=1", netAvailable: 950, instant: true)))
        XCTAssertEqual(CheckoutController.outcome(Money(1), TerminalResult(status: "pin_required", paymentIntentId: "pi")).amount, Money(1))
    }

    /// Spoken amounts (docs/06 §4); the Android core is held to the same table.
    func testSpokenAmounts() {
        let table: [Int64: String] = [
            12990: "cento e vinte e nove reais e noventa centavos", 100: "um real", 1: "um centavo", 0: "zero real",
            10000: "cem reais", 10100: "cento e um reais", 99: "noventa e nove centavos", 2000: "vinte reais",
            100000: "mil reais", 110000: "mil e cem reais", 102000: "mil e vinte reais", 123456: "mil duzentos e trinta e quatro reais e cinquenta e seis centavos",
            200000000: "dois milhões de reais", 100000000: "um milhão de reais", 250000000: "dois milhões e quinhentos mil reais",
            99999999: "novecentos e noventa e nove mil novecentos e noventa e nove reais e noventa e nove centavos", 1400: "catorze reais",
            -500: "menos cinco reais",
        ]
        for (c, want) in table { XCTAssertEqual(Money(c).spoken(), want, "\(c)") }
    }

    func testWording() {
        let today = DateComponents(year: 2026, month: 10, day: 31)
        XCTAssertEqual(Wording.day("2026-10-31", today: today), "hoje")
        XCTAssertEqual(Wording.day("2026-11-01", today: today), "amanhã")
        XCTAssertEqual(Wording.day("2026-10-30T10:00:00Z", today: today), "ontem")
        XCTAssertEqual(Wording.day("2026-11-28", today: today), "28/11")
        XCTAssertEqual(Wording.day("2027-01-04", today: today), "04/01/2027")
        XCTAssertEqual(Wording.entry("investment_buy"), "Compra na B3")
        XCTAssertEqual(Wording.entry("something_new"), "something new")
        XCTAssertTrue(Wording.calm(status: 422, detail: "insufficient funds: the wallet holds less than 10").hasPrefix("Saldo insuficiente."))
        XCTAssertTrue(Wording.calm(status: 0, detail: nil).contains("Nada foi enviado"))
    }

    /// The tones of docs/06 §7: two rising notes, one low note, a click; soft edges, no clipping.
    func testTones() {
        let rate = 8_000.0
        func crossings(_ s: ArraySlice<Float>) -> Int { zip(s, s.dropFirst()).filter { ($0 < 0) != ($1 < 0) }.count }
        let approved = Tone.approved.samples(sampleRate: rate)
        XCTAssertEqual(approved.count, Int(0.12 * rate) + Int(0.03 * rate) + Int(0.16 * rate))
        let first = approved[0..<Int(0.12 * rate)], second = approved[Int(0.15 * rate)...]
        // Zero crossings per second are twice the frequency: about 1047 Hz, then 1568 Hz.
        XCTAssertEqual(Double(crossings(first)) / 0.12 / 2, 1_046.5, accuracy: 60)
        XCTAssertEqual(Double(crossings(second)) / 0.16 / 2, 1_568, accuracy: 60)
        let declined = Tone.declined.samples(sampleRate: rate)
        XCTAssertEqual(Double(crossings(declined[...])) / 0.35 / 2, 220, accuracy: 20)
        for t in Tone.allCases {
            let s = t.samples(sampleRate: rate)
            XCTAssertLessThanOrEqual(s.map(abs).max() ?? 1, 0.5, "\(t) clips")
            XCTAssertLessThan(abs(s.first!) + abs(s.last!), 0.01, "\(t) clicks at its edges")
        }
    }

    /// The method sheet puts the last method first; a long press repeats it (docs/06 §5).
    @MainActor
    func testTheLastMethodComesFirst() {
        struct Fixed: StanSource { func next() -> String { "000001" } }
        let memory = InMemoryMethods()
        final class Offer { var choice: CryptoChoice? }
        let offer = Offer()
        let c = CheckoutController(api: { throw APIError(status: 0, problem: nil) }, reader: { throw APIError(status: 0, problem: nil) },
                                   stan: Fixed(), memory: memory, cryptoOffer: { offer.choice })
        XCTAssertEqual(c.methods(), [.credit, .debit, .pix])
        XCTAssertEqual(c.state, .entering(.zero, repeat: nil))
        for d in [5, 0, 0] { c.digit(d) }
        c.charge()
        c.choose(.pix)
        XCTAssertEqual(memory.last, .pix)
        c.nextSale()
        XCTAssertEqual(c.state, .entering(.zero, repeat: .pix))
        XCTAssertEqual(c.methods(), [.pix, .credit, .debit])
        memory.last = .crypto
        XCTAssertEqual(c.methods(), [.credit, .debit, .pix]) // crypto only where the merchant takes it
        offer.choice = CryptoChoice()
        XCTAssertEqual(c.methods(), [.crypto, .credit, .debit, .pix])
        c.nextSale()
        c.set(Money(5_000))
        XCTAssertEqual(c.state.amount, Money(5_000))
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


extension TerminalResult {
    init(status: String, paymentIntentId: String, card: CardView? = nil, receipt: ReceiptView? = nil, settlement: SettlementView? = nil) {
        self.init(status: status, paymentIntentId: paymentIntentId, responseCode: nil, authorizationCode: nil, declineCode: nil,
                  customerMessage: nil, card: card, receipt: receipt, settlement: settlement)
    }
}
