import Foundation
import XCTest
@testable import GoonersPayKit

final class JournalTests: XCTestCase {
    let device = NostrKeys.generate()
    let root = NostrKeys.generate()

    private func content(_ e: NostrEvent) throws -> [String: JSONValue] {
        guard case let .object(o) = try JSONDecoder().decode(JSONValue.self, from: Data(e.content.utf8)) else { throw URLError(.cannotParseResponse) }
        return o
    }

    func testEntriesChainBeforeTheKeyIsUnwrapped() throws {
        let store = MemoryJournalStore()
        let j = Journal(store: store, devicePubkeyHex: device.publicKeyHex, merchantRootPubHex: root.publicKeyHex, appVersion: "0.1.0")
        let a = j.append("session_start")
        let b = j.append("tap_started", fields: ["amount": Journal.amount(Money(4590))])
        let c = j.append("auth_result")
        XCTAssertEqual(try content(a)["prev"], .null)
        XCTAssertEqual(try content(b)["prev"], .string(a.id))
        XCTAssertEqual(try content(c)["prev"], .string(b.id))
        XCTAssertEqual(try content(c)["seq"], .int(3))
        XCTAssertTrue(j.toUpload().isEmpty) // nothing is sent unsigned
        XCTAssertEqual(j.unsignedCount, 3)

        XCTAssertEqual(try j.signPending(device), 3)
        let signed = j.toUpload()
        XCTAssertEqual(signed.map(\.id), [a.id, b.id, c.id]) // signing does not change IDs
        XCTAssertTrue(signed.allSatisfy { $0.verify() })

        // The journal survives a restart, and the platform asks again for entry 2.
        let again = Journal(store: store, devicePubkeyHex: device.publicKeyHex, merchantRootPubHex: root.publicKeyHex, appVersion: "0.1.0")
        again.record(sent: signed, status: JournalStatus(status: "platform_behind", missing: [[2, 2]]))
        XCTAssertEqual(again.toUpload().map(\.id), [b.id])
        again.record(sent: [signed[1]], status: JournalStatus(status: "consistent"))
        XCTAssertTrue(again.toUpload().isEmpty)
        XCTAssertEqual(again.head, c.id)
        XCTAssertEqual(try content(again.append("session_end"))["prev"], .string(c.id))
    }

    func testOnlyTheDeviceKeySigns() {
        let j = Journal(store: MemoryJournalStore(), devicePubkeyHex: device.publicKeyHex, merchantRootPubHex: root.publicKeyHex, appVersion: "0.1.0")
        j.append("session_start")
        XCTAssertThrowsError(try j.signPending(root))
    }

    func testACorruptStoreStartsAFreshJournal() throws {
        let j = Journal(store: MemoryJournalStore(Data("{not json".utf8)), devicePubkeyHex: device.publicKeyHex, merchantRootPubHex: root.publicKeyHex, appVersion: "0.1.0")
        XCTAssertNil(j.head)
        XCTAssertEqual(try content(j.append("session_start"))["seq"], .int(1))
    }
}
