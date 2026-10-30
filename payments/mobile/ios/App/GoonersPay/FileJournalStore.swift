import Foundation
import GoonersPayKit

/// The terminal journal in Application Support: written atomically, encrypted by the device
/// until first unlock, and excluded from backups.
final class FileJournalStore: JournalStore, @unchecked Sendable {
    private let url: URL
    private let lock = NSLock()

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("journal.json")
    }

    func read() -> Data? { lock.withLock { try? Data(contentsOf: url) } }

    func write(_ data: Data) {
        lock.withLock {
            try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var u = url
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? u.setResourceValues(values)
        }
    }

    func delete() { lock.withLock { _ = try? FileManager.default.removeItem(at: url) } }
}
