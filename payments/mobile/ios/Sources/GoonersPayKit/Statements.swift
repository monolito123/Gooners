import Foundation

/// RFC 6962 Merkle trees as the platform builds them (docs/03 §6): inclusion proofs per RFC 9162 §2.1.3.2.
public enum Merkle {
    public static func leafHash(_ data: Data) -> Data { sha256(Data([0]) + data) }

    public static func nodeHash(_ left: Data, _ right: Data) -> Data { sha256(Data([1]) + left + right) }

    /// Whether `leafData` is the leaf at `index` of the tree of `treeSize` leaves whose root is `rootHex`.
    public static func verifyInclusion(_ leafData: Data, index: Int64, treeSize: Int64, path: [Data], rootHex: String) -> Bool {
        guard index >= 0, index < treeSize else { return false }
        var fn = index
        var sn = treeSize - 1
        var r = leafHash(leafData)
        for p in path {
            if sn == 0 { return false }
            if fn % 2 == 1 || fn == sn {
                r = nodeHash(p, r)
                if fn % 2 == 0 {
                    while fn % 2 == 0, fn != 0 {
                        fn >>= 1
                        sn >>= 1
                    }
                }
            } else {
                r = nodeHash(r, p)
            }
            fn >>= 1
            sn >>= 1
        }
        return sn == 0 && r.hex == rootHex
    }

    /// The leaf committing one merchant's statement into the day's public log (docs/03 §6.2).
    public static func statementLeafData(saltHex: String, commitmentHex: String) -> Data {
        Data("goonerspay/v1/statement-leaf".utf8) + (Data(hex: saltHex) ?? Data()) + (Data(hex: commitmentHex) ?? Data())
    }
}

/// One sale in a statement.
public struct StatementLine: Sendable, Equatable {
    public var receiptEventId: String
    public var amount: Int64
    public var fee: Int64
    public var settles: String
}

/// What the phone checked about a day's statement, each check on its own (docs/03 §6.5).
public struct StatementCheck: Sendable, Equatable {
    /// The statement (kind 7713) is signed, by `statementSigner`.
    public var statementSigned: Bool
    /// It is this merchant's statement.
    public var forThisMerchant: Bool
    /// Gross, fees and net add up from the lines.
    public var totalsAddUp: Bool
    /// statement_commitment is the hash of the canonical statement.
    public var commitmentMatches: Bool
    /// The day's public root (kind 7715) is signed, by `rootSigner`, and is the one the statement names.
    public var rootSigned: Bool
    /// The statement is a leaf of that public root.
    public var inPublicRoot: Bool
    public var statementSigner: String
    public var rootSigner: String

    public var ok: Bool { statementSigned && forThisMerchant && totalsAddUp && commitmentMatches && rootSigned && inPublicRoot }
}

/// A day's statement as the merchant reads it.
public struct Statement: Sendable, Equatable {
    public static let statementKind = 7713
    public static let rootKind = 7715

    public var date: String
    public var merchantId: String
    public var currency: String
    public var gross: Int64
    public var fees: Int64
    public var refunds: Int64
    public var chargebacks: Int64
    public var net: Int64
    public var lines: [StatementLine]
    public var receiptsRoot: String
    public var check: StatementCheck

    /// Whether the receipt `receiptEventId` is in this statement, from the platform's proof.
    public func includes(_ receiptEventId: String, leafIndex: Int64, treeSize: Int64, auditPath: [String]) -> Bool {
        guard lines.contains(where: { $0.receiptEventId == receiptEventId }), let leaf = Data(hex: receiptEventId) else { return false }
        let path = auditPath.compactMap { Data(hex: $0) }
        return path.count == auditPath.count && Merkle.verifyInclusion(leaf, index: leafIndex, treeSize: treeSize, path: path, rootHex: receiptsRoot)
    }

    public enum Malformed: Error { case statement, root }

    /// Reads and checks a statement against the day's public root, the way anyone holding them
    /// can (docs/03 §6.5): nothing here trusts the API's other answers. `platformKeys`, when
    /// known (the keys the platform publishes), must have signed both events.
    public static func verify(statement: NostrEvent, root: NostrEvent, merchantId: String, platformKeys: Set<String> = []) throws -> Statement {
        guard case let .object(c)? = try? JSONDecoder().decode(JSONValue.self, from: Data(statement.content.utf8)),
              case let .object(totals)? = c["totals"], case let .array(rawLines)? = c["lines"],
              case let .string(commitment)? = c["statement_commitment"], case let .object(t)? = c["transparency"],
              case let .string(date)? = c["date"], case let .string(merchant)? = c["merchant_id"],
              case let .string(currency)? = c["currency"], case let .string(receiptsRoot)? = c["receipts_root"]
        else { throw Malformed.statement }
        func int(_ o: [String: JSONValue], _ k: String) -> Int64? { if case let .int(i)? = o[k] { return i } else { return nil } }
        func str(_ o: [String: JSONValue], _ k: String) -> String? { if case let .string(s)? = o[k] { return s } else { return nil } }
        var lines: [StatementLine] = []
        for case let .object(o) in rawLines {
            guard let id = str(o, "receipt_event_id"), let amount = int(o, "amount"), let fee = int(o, "fee") else { throw Malformed.statement }
            lines.append(StatementLine(receiptEventId: id, amount: amount, fee: fee, settles: str(o, "settles") ?? ""))
        }
        guard let gross = int(totals, "gross"), let fees = int(totals, "fees"), let refunds = int(totals, "refunds"),
              let chargebacks = int(totals, "chargebacks"), let net = int(totals, "net") else { throw Malformed.statement }
        var body = c
        body["statement_commitment"] = nil
        body["transparency"] = nil
        var rootContent: [String: JSONValue] = [:]
        if case let .object(o)? = try? JSONDecoder().decode(JSONValue.self, from: Data(root.content.utf8)) { rootContent = o }
        let signedBy = { (e: NostrEvent) in e.verify() && (platformKeys.isEmpty || platformKeys.contains(e.pubkey)) }
        var inRoot = false
        if let salt = str(t, "leaf_salt"), let index = int(t, "leaf_index"), let size = int(t, "tree_size"), case let .array(p)? = t["audit_path"],
           let rootHex = str(rootContent, "root") {
            let path = p.compactMap { v -> Data? in if case let .string(h) = v { Data(hex: h) } else { nil } }
            inRoot = path.count == p.count && Merkle.verifyInclusion(Merkle.statementLeafData(saltHex: salt, commitmentHex: commitment),
                                                                     index: index, treeSize: size, path: path, rootHex: rootHex)
        }
        let check = StatementCheck(
            statementSigned: statement.kind == statementKind && signedBy(statement),
            forThisMerchant: merchant == merchantId,
            totalsAddUp: gross == lines.reduce(0) { $0 + $1.amount } && fees == lines.reduce(0) { $0 + $1.fee } && net == gross - fees - refunds - chargebacks,
            commitmentMatches: sha256(Data(JSONValue.object(body).canonical.utf8)).hex == commitment,
            rootSigned: root.kind == rootKind && signedBy(root) && root.id == str(t, "root_event_id") && str(rootContent, "date") == date,
            inPublicRoot: inRoot,
            statementSigner: statement.pubkey,
            rootSigner: root.pubkey)
        return Statement(date: date, merchantId: merchant, currency: currency, gross: gross, fees: fees, refunds: refunds, chargebacks: chargebacks,
                         net: net, lines: lines, receiptsRoot: receiptsRoot, check: check)
    }
}
