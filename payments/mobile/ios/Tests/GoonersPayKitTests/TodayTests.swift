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

    func testChartAxes() {
        let compact: [Int64: String] = [0: "R$ 0", 90_000: "R$ 900", 99_950: "R$ 1 mil", 149_999: "R$ 1,5 mil", 250_000: "R$ 2,5 mil",
                                        1_000_000: "R$ 10 mil", 1_234_000: "R$ 12 mil", 99_999_999: "R$ 1 mi", 125_000_000: "R$ 1,3 mi", 1_500_000_000: "R$ 15 mi"]
        for (c, want) in compact { XCTAssertEqual(Today.compact(c), want, "\(c)") }
        XCTAssertEqual(Today.ticks(0), [0, 10_000])
        XCTAssertEqual(Today.ticks(50), [0, 100])
        XCTAssertEqual(Today.ticks(12_000), [0, 5_000, 10_000, 15_000])
        XCTAssertEqual(Today.ticks(1_000_000), [0, 500_000, 1_000_000])
        XCTAssertEqual(Today.ticks(1_200_000), [0, 500_000, 1_000_000, 1_500_000])
        XCTAssertEqual(Today.axis(24), [0, 6, 12, 18, 23])
        XCTAssertEqual(Today.axis(7), Array(0...6))
        XCTAssertEqual(Today.axis(30), [0, 6, 12, 18, 24, 29])
    }

    private func example(_ section: String) throws -> Data {
        let doc = try String(contentsOf: ConformanceTests.mobile.deletingLastPathComponent().appendingPathComponent("docs/02-api-reference.md"), encoding: .utf8)
        let at = try XCTUnwrap(doc.range(of: "### " + section)).upperBound
        let start = try XCTUnwrap(doc.range(of: "```json", range: at..<doc.endIndex)).upperBound
        let end = try XCTUnwrap(doc.range(of: "```", range: start..<doc.endIndex)).lowerBound
        return Data(doc[start..<end].utf8)
    }

    func testSalesViews() throws {
        let day = Today.dayView(try GoonersPayAPI.decoder.decode(DaySummary.self, from: try example("8.5")), today: true)
        XCTAssertEqual(day.title, "Hoje")
        XCTAssertEqual(day.change, "+50%")
        XCTAssertEqual(day.compareName, "sexta passada")
        XCTAssertEqual(day.compare.count, 24)
        XCTAssertEqual(day.ticks, [0, 5_000, 10_000])
        XCTAssertEqual(day.labels[11], "11h")
        XCTAssertEqual(day.spoken[23], "23h às 0h")
        XCTAssertEqual(day.axis, [0, 6, 12, 18, 23])

        let period = Today.periodView(try GoonersPayAPI.decoder.decode(PeriodSummary.self, from: try example("8.6")), today: "2026-11-06")
        XCTAssertEqual(period.title, "Últimos 7 dias")
        XCTAssertEqual(period.range, "31/10 a 06/11")
        XCTAssertEqual(period.change, "+12,4%")
        XCTAssertEqual(period.versus, "vs. os 7 dias anteriores até agora")
        XCTAssertEqual(period.spoken[0], "sábado, 31/10")
        XCTAssertEqual(period.byMethod.map(\.method), ["credit", "debit", "pix"])
        XCTAssertEqual(period.shares.reduce(0, +), 100)
        XCTAssertEqual(period.ticks, [0, 50_000, 100_000, 150_000])
        XCTAssertEqual(period.axis, Array(0...6))
        XCTAssertEqual(period.compare.count, 7)
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
