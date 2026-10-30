import Foundation
import GoonersPayKit

/// Non-secret settings of a paired phone.
final class AppSettings: @unchecked Sendable {
    private let defaults: UserDefaults
    private let lock = NSLock()

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private func string(_ k: String) -> String { defaults.string(forKey: k) ?? "" }

    var apiURL: String {
        get { string("api_url") }
        set { defaults.set(newValue, forKey: "api_url") }
    }

    /// The sandbox's development card key (hex). Empty outside the sandbox.
    var sandboxCardKey: String {
        get { string("sandbox_card_key") }
        set { defaults.set(newValue, forKey: "sandbox_card_key") }
    }

    var merchantID: String {
        get { string("merchant_id") }
        set { defaults.set(newValue, forKey: "merchant_id") }
    }

    var deviceID: String {
        get { string("device_id") }
        set { defaults.set(newValue, forKey: "device_id") }
    }

    var devicePubkey: String {
        get { string("device_pubkey") }
        set { defaults.set(newValue, forKey: "device_pubkey") }
    }

    var tradeName: String {
        get { string("trade_name") }
        set { defaults.set(newValue, forKey: "trade_name") }
    }

    var rootBackedUp: Bool {
        get { defaults.bool(forKey: "root_backed_up") }
        set { defaults.set(newValue, forKey: "root_backed_up") }
    }

    /// The device list the root key last signed (owner's phone only). The root key is the
    /// list's only author, so this copy is the source of truth for the next one.
    var deviceList: [DeviceList.Entry] {
        get { (defaults.data(forKey: "device_list")).flatMap { try? JSONDecoder().decode([DeviceList.Entry].self, from: $0) } ?? [] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "device_list") }
    }

    /// created_at of the last signed list: the next one must be newer (docs/03 §4.2).
    var deviceListAt: Int64 {
        get { Int64(defaults.integer(forKey: "device_list_at")) }
        set { defaults.set(Int(newValue), forKey: "device_list_at") }
    }

    /// The terminal's trace numbers, 000001..999999, kept across launches.
    var stan: StanSource { StanCounter(settings: self) }

    fileprivate func nextStan() -> String {
        lock.withLock {
            let next = defaults.integer(forKey: "stan") % 999_999 + 1
            defaults.set(next, forKey: "stan")
            let s = String(next)
            return String(repeating: "0", count: 6 - s.count) + s
        }
    }

    func clear() {
        for k in ["api_url", "sandbox_card_key", "merchant_id", "device_id", "device_pubkey", "trade_name", "root_backed_up",
                  "device_list", "device_list_at", "stan"] {
            defaults.removeObject(forKey: k)
        }
    }
}

private struct StanCounter: StanSource {
    let settings: AppSettings
    func next() -> String { settings.nextStan() }
}
