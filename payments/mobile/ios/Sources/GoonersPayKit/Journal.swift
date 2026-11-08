import Foundation

/// Where the journal is kept: an app-private file, excluded from backups.
public protocol JournalStore: Sendable {
    func read() -> Data?
    func write(_ data: Data)
}

public final class MemoryJournalStore: JournalStore, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    public init(_ data: Data? = nil) { self.data = data }
    public func read() -> Data? { lock.withLock { data } }
    public func write(_ data: Data) { lock.withLock { self.data = data } }
}

/// The platform's answer to an upload (POST /v1/terminal/journal).
public struct JournalStatus: Codable, Sendable, Equatable {
    public struct Head: Codable, Sendable, Equatable {
        public var seq: Int64
        public var eventId: String
    }

    public var status: String
    public var accepted: Int?
    public var duplicates: Int?
    public var head: Head?
    public var missing: [[Int64]]?
    public var forks: Int?

    public init(status: String, missing: [[Int64]] = []) {
        self.status = status
        self.missing = missing
    }
}

/// The device's append-only, hash-chained journal (kind 7714, docs/03 §7). An entry's ID is
/// fixed when it is written: it depends on the device's public key, not on the secret. So
/// entries chain at once, while the device key stays behind Face ID, and are signed in a batch
/// the next time the key is unwrapped (every login), then uploaded in order.
public final class Journal: @unchecked Sendable {
    public static let kind = 7714
    public static let maxBatch = 500
    private static let keepUploaded = 1000

    private struct Entry: Codable {
        var event: NostrEvent
        var seq: Int64
        var uploaded = false
    }

    private struct State: Codable {
        var entries: [Entry] = []
        var seq: Int64 = 0
        var head: String?
    }

    private let store: JournalStore
    private let devicePubkeyHex: String
    private let merchantRootPubHex: String
    private let appVersion: String
    private let clock: @Sendable () -> Int64
    private let timeZone: TimeZone
    private let lock = NSLock()
    private var state: State

    public init(store: JournalStore, devicePubkeyHex: String, merchantRootPubHex: String, appVersion: String,
                clock: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970) }, timeZone: TimeZone = .current) {
        self.store = store
        self.devicePubkeyHex = devicePubkeyHex
        self.merchantRootPubHex = merchantRootPubHex
        self.appVersion = appVersion
        self.clock = clock
        self.timeZone = timeZone
        state = store.read().flatMap { try? JSONDecoder().decode(State.self, from: $0) } ?? State()
    }

    private func save(_ s: State) {
        // Keep everything not yet accepted, and the last uploaded entries in case the platform asks again.
        var s = s
        let pending = s.entries.filter { !$0.uploaded }
        let uploaded = s.entries.filter(\.uploaded).suffix(Self.keepUploaded)
        s.entries = (pending + uploaded).sorted { $0.seq < $1.seq }
        state = s
        if let data = try? JSONEncoder().encode(s) { store.write(data) }
    }

    /// The amount object of docs/03 §2.2.
    public static func amount(_ m: Money) -> JSONValue {
        .object(["value": .int(m.centavos), "currency": .string("BRL"), "exponent": .int(2)])
    }

    /// Appends an entry of `type` with `fields` and returns it unsigned, its ID already fixed.
    @discardableResult
    public func append(_ type: String, fields: [String: JSONValue] = [:]) -> NostrEvent {
        lock.withLock {
            let seq = state.seq + 1
            let now = clock()
            let f = ISO8601DateFormatter()
            f.timeZone = timeZone
            f.formatOptions = [.withInternetDateTime]
            var content = fields
            content["v"] = .int(1)
            content["seq"] = .int(seq)
            content["prev"] = state.head.map(JSONValue.string) ?? .null
            content["type"] = .string(type)
            content["local_time"] = .string(f.string(from: Date(timeIntervalSince1970: TimeInterval(now))))
            content["app"] = .object(["version": .string(appVersion)])
            var ev = NostrEvent(pubkey: devicePubkeyHex, createdAt: now, kind: Self.kind, tags: [["merchant", merchantRootPubHex]],
                                content: JSONValue.object(content).canonical)
            ev.id = ev.computeID()
            var s = state
            s.entries.append(Entry(event: ev, seq: seq))
            s.seq = seq
            s.head = ev.id
            save(s)
            return ev
        }
    }

    public enum Failure: Error { case notThisDevice, idChanged }

    /// Signs every unsigned entry with the device key; IDs do not change. Returns how many.
    @discardableResult
    public func signPending(_ keys: NostrKeys) throws -> Int {
        try lock.withLock {
            guard keys.publicKeyHex == devicePubkeyHex else { throw Failure.notThisDevice }
            var s = state
            var n = 0
            for i in s.entries.indices where s.entries[i].event.sig.isEmpty {
                let signed = try s.entries[i].event.signed(by: keys)
                guard signed.id == s.entries[i].event.id else { throw Failure.idChanged }
                s.entries[i].event = signed
                n += 1
            }
            if n > 0 { save(s) }
            return n
        }
    }

    /// Signed entries the platform has not accepted, in seq order.
    public func toUpload(max: Int = Journal.maxBatch) -> [NostrEvent] {
        lock.withLock { Array(state.entries.filter { !$0.uploaded && !$0.event.sig.isEmpty }.prefix(max).map(\.event)) }
    }

    /// Records an upload: what was sent is accepted, except the ranges the platform still lacks.
    public func record(sent: [NostrEvent], status: JournalStatus) {
        lock.withLock {
            let ids = Set(sent.map(\.id))
            var s = state
            for i in s.entries.indices {
                let seq = s.entries[i].seq
                if (status.missing ?? []).contains(where: { $0.count == 2 && (($0[0])...($0[1])).contains(seq) }) {
                    s.entries[i].uploaded = false
                } else if ids.contains(s.entries[i].event.id) {
                    s.entries[i].uploaded = true
                }
            }
            save(s)
        }
    }

    public var head: String? { lock.withLock { state.head } }
    public var lastSeq: Int64 { lock.withLock { state.seq } }
    public var unsignedCount: Int { lock.withLock { state.entries.filter { $0.event.sig.isEmpty }.count } }
    public var pendingCount: Int { lock.withLock { state.entries.filter { !$0.uploaded }.count } }
}
