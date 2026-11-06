import Foundation
import XCTest
@testable import GoonersPayKit

/// The "Hoje" card's words and figures; TodayTest.kt holds the Android core to the same cases.
final class TodayTests: XCTestCase {
    func testSharesAddUpToAHundred() {
        XCTAssertEqual(Today.shares([10_000, 2_000]), [83, 17])
        XCTAssertEqual(Today.shares([1, 1, 1]), [34, 33, 33])
        XCTAssertEqual(Today.shares([5]), [100])
        XCTAssertEqual(Today.shares([0, 0]), [0, 0])
        XCTAssertEqual(Today.shares([]), [])
        XCTAssertEqual(Today.shares([7, 13, 29, 51, 3]).reduce(0, +), 100)
    }

    func testChangeAgainstLastWeek() {
        XCTAssertEqual(Today.change(50), "+50%")
        XCTAssertEqual(Today.change(-12.5), "−12,5%")
        XCTAssertEqual(Today.change(0), "0%")
        XCTAssertNil(Today.change(nil))
        XCTAssertEqual(Today.versus("2026-10-30", today: true), "vs. sexta passada até agora")
        XCTAssertEqual(Today.versus("2026-11-01", today: false), "vs. domingo passado")
        XCTAssertEqual(Today.versus("2026-10-31", today: false), "vs. sábado passado")
    }

    func testMethodsAndStates() {
        XCTAssertEqual(Today.method("credit"), "Crédito")
        XCTAssertEqual(Today.method("boleto_bancario"), "boleto bancario")
        XCTAssertEqual(Today.chart("card"), "other")
        XCTAssertEqual(Today.chart("pix"), "pix")
        XCTAssertEqual(Today.status("captured").label, "Paga")
        XCTAssertEqual(Today.status("captured").tone, .positive)
        XCTAssertEqual(Today.status("requires_action").label, "Aguardando")
        XCTAssertEqual(Today.status("requires_action").tone, .attention)
        XCTAssertEqual(Today.status("failed").tone, .alert)
        XCTAssertEqual(Today.status("on_hold").label, "on hold")
        XCTAssertEqual(Today.status("on_hold").tone, .neutral)
    }

    func testPeakHour() {
        XCTAssertNil(Today.peakHour(Array(repeating: 0, count: 24)))
        XCTAssertNil(Today.peakHour([]))
        XCTAssertEqual(Today.peakHour((0..<24).map { $0 == 9 ? 500 : $0 == 14 ? 200 : 0 }), 9)
    }

    func testDecodesTheApiExample() throws {
        // The example of docs/02 §8.5, as the platform sends it.
        let doc = try String(contentsOf: ConformanceTests.mobile.deletingLastPathComponent().appendingPathComponent("docs/02-api-reference.md"), encoding: .utf8)
        let section = try XCTUnwrap(doc.range(of: "### 8.5")).upperBound
        let start = try XCTUnwrap(doc.range(of: "```json", range: section..<doc.endIndex)).upperBound
        let end = try XCTUnwrap(doc.range(of: "```", range: start..<doc.endIndex)).lowerBound
        let s = try GoonersPayAPI.decoder.decode(DaySummary.self, from: Data(doc[start..<end].utf8))
        XCTAssertEqual(s.byMethod.reduce(0) { $0 + $1.gross }, s.gross)
        XCTAssertEqual(s.hourly.count, 24)
        XCTAssertEqual(s.hourly.reduce(0, +), s.gross)
        XCTAssertEqual(s.net, s.gross - s.fees - s.refunded)
        XCTAssertEqual(s.lastWeek?.changePct, 50)
        XCTAssertEqual(s.recent.last?.card, "visa •••• 1111")
    }
}
