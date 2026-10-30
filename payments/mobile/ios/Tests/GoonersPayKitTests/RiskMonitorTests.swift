import Foundation
import XCTest
@testable import GoonersPayKit

final class RiskMonitorTests: XCTestCase {
    final class Clock: @unchecked Sendable {
        var now: TimeInterval = 1_000_000
    }

    struct Posture: PostureSource {
        var set: Set<String>
        func signals() -> Set<String> { set }
    }

    let clock = Clock()
    lazy var monitor = RiskMonitor(clock: { [clock] in clock.now })

    func sale(_ centavos: Int64, typing: TimeInterval = 5) -> [String] {
        monitor.typing()
        clock.now += typing
        return monitor.tapped(Money(centavos)).signals
    }

    func testAnOrdinarySaleSendsNothing() {
        let r = monitor.tapped(Money(12_90))
        XCTAssertEqual(r.milli, 0)
        XCTAssertEqual(r.model, DeviceModel.name)
        XCTAssertEqual(sale(45_00), [])
    }

    func testInteractionSignals() {
        XCTAssertTrue(sale(10_00, typing: 0.3).contains("fast_amount_to_tap"))
        XCTAssertTrue(sale(199_90).contains("just_under_limit"))
        _ = sale(50_00)
        _ = sale(50_00)
        XCTAssertTrue(sale(50_00).contains("repeated_amount"))
        for _ in 0..<3 { monitor.cancelled() }
        XCTAssertTrue(sale(12_00).contains("cancelled_taps"))
        clock.now += RiskMonitor.window + 1 // old cancellations and taps age out
        XCTAssertEqual(sale(12_00), [])
    }

    func testSessionSignals() {
        for i in 0..<3 {
            _ = sale(10_00 + Int64(i))
            monitor.result("declined")
        }
        XCTAssertTrue(sale(20_00).contains("decline_streak"))
        monitor.result("approved")
        XCTAssertFalse(sale(21_00).contains("decline_streak"))
        for i in 0..<(RiskMonitor.burstTaps - 1) {
            monitor.typing()
            clock.now += 2
            _ = monitor.tapped(Money(30_00 + Int64(i)))
        }
        XCTAssertTrue(monitor.tapped(Money(99_00)).signals.contains("tap_burst"))
    }

    func testPostureIsScoredWithTheRest() {
        let m = RiskMonitor(posture: Posture(set: ["debugger", "root_indicators"]), clock: { [clock] in clock.now })
        let r = m.tapped(Money(10_00))
        XCTAssertEqual(r.milli, 840)
        XCTAssertEqual(r.signals, ["debugger", "root_indicators"])
    }

    func testEachSandboxReaderHasItsOwnCard() {
        let a = SandboxCardReader(devKey: Data(count: 32)).pan(of: .visaCredit)
        let b = SandboxCardReader(devKey: Data(count: 32)).pan(of: .visaCredit)
        XCTAssertNotEqual(a, b)
        for pan in [a, b] {
            XCTAssertEqual(pan.count, 16)
            XCTAssertTrue(pan.hasPrefix("411111") && pan.hasSuffix("1111") && SandboxCardReader.luhn(pan), pan)
        }
        let elo = SandboxCardReader(devKey: Data(count: 32)).pan(of: .elo)
        XCTAssertTrue(elo.hasPrefix("636297") && elo.hasSuffix("7013") && SandboxCardReader.luhn(elo), elo)
    }
}
