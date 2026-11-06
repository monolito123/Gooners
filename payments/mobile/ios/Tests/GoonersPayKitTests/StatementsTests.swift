import Foundation
import XCTest
@testable import GoonersPayKit

/// The phone checks a statement the way docs/03 §6.5 says anyone can, on the spec's signed examples.
final class StatementsTests: XCTestCase {
    static let examples = ConformanceTests.mobile.deletingLastPathComponent().appendingPathComponent("nostr/examples")

    func event(_ name: String) throws -> NostrEvent {
        try GoonersPayAPI.decoder.decode(NostrEvent.self, from: Data(contentsOf: Self.examples.appendingPathComponent(name)))
    }

    var platformKeys: Set<String> {
        struct Keys: Decodable { struct K: Decodable { var role: String; var pubkey: String }; var keys: [K] }
        let k = try! JSONDecoder().decode(Keys.self, from: Data(contentsOf: Self.examples.appendingPathComponent("keys.json")))
        return Set(k.keys.filter { $0.role.hasPrefix("platform-") }.map(\.pubkey))
    }

    func merchant(_ e: NostrEvent) throws -> String {
        guard case let .object(c) = try JSONDecoder().decode(JSONValue.self, from: Data(e.content.utf8)), case let .string(m)? = c["merchant_id"] else {
            throw Statement.Malformed.statement
        }
        return m
    }

    func testTheSpecStatementVerifies() throws {
        let statement = try event("7713-settlement-statement.json")
        let s = try Statement.verify(statement: statement, root: try event("7715-transparency-root.json"), merchantId: try merchant(statement), platformKeys: platformKeys)
        XCTAssertTrue(s.check.ok, "\(s.check)")
        XCTAssertEqual(s.date, "2026-10-29")
        XCTAssertEqual(s.net, s.gross - s.fees - s.refunds - s.chargebacks)
        let proof = try GoonersPayAPI.decoder.decode(InclusionProof.self, from: Data(contentsOf: Self.examples.appendingPathComponent("proof-receipt-0.json")))
        let p = proof.statementInclusion
        XCTAssertTrue(s.includes(proof.receiptEventId, leafIndex: p.leafIndex, treeSize: p.treeSize, auditPath: p.auditPath))
        XCTAssertFalse(s.includes(s.lines[1].receiptEventId, leafIndex: p.leafIndex, treeSize: p.treeSize, auditPath: p.auditPath))
    }

    func testEachTamperingIsCaught() throws {
        let statement = try event("7713-settlement-statement.json")
        let root = try event("7715-transparency-root.json")
        let m = try merchant(statement)
        var edited = statement
        edited.content = statement.content.replacingOccurrences(of: "\"amount\":12990", with: "\"amount\":12000")
        let e = try Statement.verify(statement: edited, root: root, merchantId: m).check
        XCTAssertFalse(e.statementSigned)
        XCTAssertFalse(e.totalsAddUp)
        XCTAssertFalse(try Statement.verify(statement: statement, root: try event("7715-transparency-root-2026-10-28.json"), merchantId: m).check.rootSigned)
        var forged = root
        forged.content = root.content.replacingOccurrences(of: "\"tree_size\":8", with: "\"tree_size\":9")
        XCTAssertFalse(try Statement.verify(statement: statement, root: forged, merchantId: m).check.rootSigned)
        XCTAssertFalse(try Statement.verify(statement: statement, root: root, merchantId: "mer_someone_else").check.forThisMerchant)
        XCTAssertFalse(try Statement.verify(statement: statement, root: root, merchantId: m, platformKeys: [String(repeating: "ab", count: 32)]).check.ok)
    }

    func testMerkleEdgeCases() {
        let leaf = Data("x".utf8)
        XCTAssertTrue(Merkle.verifyInclusion(leaf, index: 0, treeSize: 1, path: [], rootHex: Merkle.leafHash(leaf).hex))
        XCTAssertFalse(Merkle.verifyInclusion(leaf, index: 1, treeSize: 1, path: [], rootHex: Merkle.leafHash(leaf).hex))
        XCTAssertFalse(Merkle.verifyInclusion(leaf, index: -1, treeSize: 1, path: [], rootHex: Merkle.leafHash(leaf).hex))
        let other = Merkle.leafHash(Data("y".utf8))
        let root = Merkle.nodeHash(Merkle.leafHash(leaf), other).hex
        XCTAssertTrue(Merkle.verifyInclusion(leaf, index: 0, treeSize: 2, path: [other], rootHex: root))
        XCTAssertFalse(Merkle.verifyInclusion(leaf, index: 0, treeSize: 2, path: [], rootHex: root))
    }
}
