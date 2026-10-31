import Foundation
import GoonersPayKit
import Observation

/// Where the app is.
enum Screen: Equatable {
    case loading
    case setup
    /// The owner writes down the merchant root key before anything else (docs/03 §4.1).
    case backup(nsec: String)
    /// A cashier phone waits for the owner's phone to add it to the device list.
    case awaitingApproval(npub: String, tradeName: String)
    case home
}

enum HomeTab: Hashable {
    case charge, money, devices, settings
}

enum AppError: LocalizedError {
    case loggedOut, noReader, noScreenLock, notHTTPS, alreadyListed, removeSelf

    var errorDescription: String? {
        switch self {
        case .loggedOut: "Sessão encerrada. Abra o app novamente."
        case .noReader: "Nenhum leitor de cartão disponível neste aparelho. Use Pix."
        case .noScreenLock: "Configure um código no iPhone antes de parear: ele protege as chaves da loja."
        case .notHTTPS: "O endereço da plataforma precisa começar com https://."
        case .alreadyListed: "Este aparelho já está autorizado."
        case .removeSelf: "Para remover este aparelho, use Ajustes › Desparear."
        }
    }
}

/// The journal, readable from the login hook (which runs off the main actor) once it exists:
/// a cashier phone's journal starts only after its first login.
private final class JournalRef: @unchecked Sendable {
    private let lock = NSLock()
    private var j: Journal?
    var journal: Journal? {
        get { lock.withLock { j } }
        set { lock.withLock { j = newValue } }
    }
}

/// What the checkout needs from the logged-in session, kept apart so the controller can be
/// created before the first login.
@MainActor
private final class SessionBox {
    var authed: GoonersPayAPI.Authed?
    var reader: SandboxCardReader?
    let journal = JournalRef()
    private var readerKey = ""

    /// The sandbox reader for the configured development key; nil outside the sandbox.
    func sandboxReader(key: String) -> SandboxCardReader? {
        if let reader, readerKey == key { return reader }
        guard key.count == 64, let raw = Data(hex: key) else { return nil }
        let r = SandboxCardReader(devKey: raw)
        reader = r
        readerKey = key
        return r
    }
}

@MainActor @Observable
final class AppModel {
    var screen: Screen = .loading
    var tab: HomeTab = .charge
    var busy = false
    var message: String?

    var balance: Balance?
    var entries: [GoonersPayKit.Entry] = []
    var quote: Quote?
    var destination: PixDestination?
    var lastPayout: String?
    var settlements: [Settlement] = []
    /// The statement open on screen, checked on the phone.
    var statement: Statement?
    var devices: [DeviceList.Entry]

    @ObservationIgnored let settings: AppSettings
    @ObservationIgnored let vault = KeyVault()
    @ObservationIgnored private let integrity: IntegrityProvider = AppAttestIntegrity()
    @ObservationIgnored private let box: SessionBox
    @ObservationIgnored let checkout: CheckoutController

    init(settings: AppSettings = AppSettings()) {
        self.settings = settings
        devices = settings.deviceList
        let box = SessionBox()
        self.box = box
        checkout = CheckoutController(
            api: {
                guard let a = box.authed else { throw AppError.loggedOut }
                return a
            },
            reader: {
                guard let r = box.sandboxReader(key: settings.sandboxCardKey) else { throw AppError.noReader }
                return r
            },
            stan: settings.stan,
            journal: { box.journal.journal },
            risk: RiskMonitor(posture: IOSPosture())
        )
    }

    @ObservationIgnored private let journalStore = FileJournalStore()

    /// The journal, once the merchant's root key is known (it names it in every entry).
    private func journal() -> Journal? {
        if let j = box.journal.journal { return j }
        guard !settings.devicePubkey.isEmpty, !settings.merchantRootPub.isEmpty else { return nil }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let j = Journal(store: journalStore, devicePubkeyHex: settings.devicePubkey, merchantRootPubHex: settings.merchantRootPub, appVersion: version)
        box.journal.journal = j
        return j
    }

    /// Uploads signed journal entries; the platform's answer says what it still lacks.
    private func syncJournal() {
        guard let a = box.authed, let j = journal() else { return }
        Task {
            if let st = try? await a.syncJournal(j), st.status == "fork_detected" {
                message = "A goonersPAY bloqueou este terminal: o diário do aparelho foi duplicado. Fale com o suporte."
            }
        }
    }

    var isOwner: Bool { vault.has(.root) }
    var ownNpub: String? { settings.devicePubkey.isEmpty ? nil : try? Bech32.npub(settings.devicePubkey) }

    /// The sandbox reader, when this phone is paired with the sandbox, to pick the test card.
    /// Production plugs in ProximityReader (Tap to Pay on iPhone) or a PCI PTS reader instead.
    var sandboxReader: SandboxCardReader? { box.sandboxReader(key: settings.sandboxCardKey) }

    /// The API client, pinned to the platform's keys when the build carries pins.
    nonisolated static func api(_ url: String) -> GoonersPayAPI {
        let info = Bundle.main.infoDictionary ?? [:]
        let pins = Set(((info["GoonersPayPins"] as? String) ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("sha256/") })
        let host = (info["GoonersPayPinnedHost"] as? String) ?? ""
        guard !pins.isEmpty, URL(string: url)?.host == host else { return GoonersPayAPI(baseURL: url) }
        return GoonersPayAPI(baseURL: url, pins: CertificatePins(host: host, pins: pins))
    }

    nonisolated static var defaultAPIURL: String { Bundle.main.object(forInfoDictionaryKey: "GoonersPayAPIURL") as? String ?? "http://localhost:8080" }

    /// Drives the alert that shows `message`.
    var showingMessage: Bool {
        get { message != nil }
        set { if !newValue { message = nil } }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        Task {
            busy = true
            defer { busy = false }
            do {
                try await work()
            } catch VaultError.invalidated {
                forget()
                screen = .setup
                message = VaultError.invalidated.errorDescription
            } catch let e as APIError {
                message = e.message
            } catch {
                message = error.localizedDescription
            }
        }
    }

    /// Unwraps a key off the main thread (Face ID may run) for one use.
    private func withKey<T: Sendable>(_ name: KeyName, _ f: (NostrKeys) async throws -> T) async throws -> T {
        let vault = vault
        let key = try await Task.detached { try vault.load(name) }.value
        defer { key.wipe() }
        return try await f(key)
    }

    // MARK: start, pairing, login

    /// Where to start when the app opens.
    func resume() {
        run { [self] in
            if !vault.has(.device) {
                screen = .setup
            } else if isOwner && !settings.rootBackedUp {
                screen = .backup(nsec: try await withKey(.root) { $0.nsec() })
            } else if settings.deviceID.isEmpty {
                screen = .awaitingApproval(npub: ownNpub ?? "", tradeName: settings.tradeName)
            } else {
                try await login()
                screen = .home
            }
        }
    }

    private func login() async throws {
        let api = Self.api(settings.apiURL)
        let dpop = try vault.dpopSigner()
        let deviceID = settings.deviceID.isEmpty ? nil : settings.deviceID
        journal()?.append("session_start")
        let ref = box.journal
        let integrity = integrity
        let session = try await withKey(.device) { key in
            let s: Session
            do {
                s = try await api.login(device: key, dpop: dpop, deviceID: deviceID)
            } catch let e as APIError where e.attestationRequired {
                // A phone the owner added proves itself at its first login, once, with App Attest.
                s = try await api.login(device: key, dpop: dpop, deviceID: deviceID, attestation: await integrity.evidence(devicePubkeyHex: key.publicKeyHex))
            }
            _ = try? ref.journal?.signPending(key)
            return s
        }
        let vault = vault
        let a = api.authed(deviceKey: { try await Task.detached { try vault.load(.device) }.value }, dpop: dpop, session: session,
                           onKey: { _ = try? ref.journal?.signPending($0) })
        if let signer = AppAttestIntegrity.assertionSigner() { await a.signAuthorizations(with: signer) }
        box.authed = a
        settings.deviceID = session.deviceId
        settings.merchantID = session.merchantId
        if settings.merchantRootPub.isEmpty, let npub = try await a.merchant().rootNpub {
            // A cashier phone learns the root key from the merchant; its journal starts now.
            settings.merchantRootPub = try Bech32.decode(hrp: "npub", npub).hex
            journal()?.append("session_start")
        }
        syncJournal()
    }

    /// Pairs this phone with the merchant the enrollment code names. On the merchant's first
    /// phone it also creates the root key, which authorizes every later device.
    func pair(apiURL: String, code rawCode: String, sandboxCardKey: String) {
        run { [self] in
            guard vault.deviceIsSecure else { throw AppError.noScreenLock }
            var url = apiURL.trimmingCharacters(in: .whitespacesAndNewlines)
            while url.hasSuffix("/") { url.removeLast() }
            #if !DEBUG
            guard url.lowercased().hasPrefix("https://") else { throw AppError.notHTTPS } // only the sandbox on a Mac is plain HTTP
            #endif
            let code = rawCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            let api = Self.api(url)
            let enrollment = try await api.lookupEnrollment(code: code)
            forget()
            settings.apiURL = url
            settings.sandboxCardKey = sandboxCardKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            settings.merchantID = enrollment.merchantId
            settings.tradeName = enrollment.tradeName
            let device = NostrKeys.generate()
            defer { device.wipe() }
            do {
                try vault.store(.device, device)
                settings.devicePubkey = device.publicKeyHex
                if enrollment.rootNpub != nil {
                    screen = .awaitingApproval(npub: device.npub, tradeName: enrollment.tradeName)
                    return
                }
                let root = NostrKeys.generate()
                defer { root.wipe() }
                try vault.store(.root, root)
                let entries = [DeviceList.Entry(pubkeyHex: device.publicKeyHex, platform: "ios", label: Self.model)]
                let now = Int64(Date().timeIntervalSince1970)
                let list = try DeviceList.event(root: root, merchantID: enrollment.merchantId, devices: entries, createdAt: now)
                let evidence = await integrity.evidence(devicePubkeyHex: device.publicKeyHex)
                let created = try await api.enroll(code: code, DeviceCreate(deviceNpub: device.npub, platform: "ios", model: Self.model,
                                                                            attestation: evidence, authorizationEvent: list))
                settings.deviceID = created.id
                settings.merchantRootPub = root.publicKeyHex
                settings.deviceList = entries
                settings.deviceListAt = now
                devices = entries
                screen = .backup(nsec: root.nsec())
            } catch {
                forget()
                throw error
            }
        }
    }

    /// The owner wrote the root key down.
    func backedUp() {
        run { [self] in
            settings.rootBackedUp = true
            try await login()
            screen = .home
        }
    }

    /// A cashier phone tries to log in once the owner says it was added.
    func checkApproval() {
        run { [self] in
            do {
                try await login()
                screen = .home
            } catch let e as APIError where e.status == 401 {
                message = "Este aparelho ainda não foi autorizado. Peça ao dono para adicioná-lo em Aparelhos."
            }
        }
    }

    // MARK: receivables and payouts

    func refreshMoney() {
        run { [self] in
            guard let a = box.authed else { return }
            balance = try await a.balance()
            entries = try await a.entries(limit: 20).data
            settlements = try await a.settlements().data
        }
    }

    /// Opens a day's statement: fetched, then checked against the public root on the phone.
    func openStatement(_ s: Settlement) {
        run { [self] in
            guard let a = box.authed else { return }
            let keys = Set(((Bundle.main.infoDictionary?["GoonersPayPlatformKeys"] as? String) ?? "").split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.count == 64 })
            statement = try await a.verifiedStatement(s, platformKeys: keys)
        }
    }

    func quotePayout(_ amount: Money, keyType: String, key: String) {
        run { [self] in
            guard let a = box.authed else { return }
            let d = PixDestination(keyType: keyType, key: key.trimmingCharacters(in: .whitespacesAndNewlines))
            quote = try await a.quote(amount: amount.centavos, destination: d)
            destination = d
            lastPayout = nil
        }
    }

    func cancelQuote() { quote = nil }

    /// Sends the quoted payout after a fresh Face ID confirmation.
    func confirmPayout() {
        run { [self] in
            guard let a = box.authed, let q = quote else { return }
            try await vault.confirm("Confirmar o saque de \(Money(q.amount).format())")
            let p = try await a.payout(quoteID: q.id)
            quote = nil
            lastPayout = "Saque \(Money(p.amount).format()): \(p.status)"
            balance = try await a.balance()
            entries = try await a.entries(limit: 20).data
        }
    }

    // MARK: devices (owner)

    /// Adds a phone by its npub: the root key signs a new device list naming it.
    func addDevice(npub raw: String, platform: String, label: String) {
        run { [self] in
            guard let a = box.authed else { return }
            let npub = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let pub = try Bech32.decode(hrp: "npub", npub).hex
            let current = settings.deviceList
            guard !current.contains(where: { $0.pubkeyHex == pub }) else { throw AppError.alreadyListed }
            let name = label.trimmingCharacters(in: .whitespacesAndNewlines)
            let next = current + [DeviceList.Entry(pubkeyHex: pub, platform: platform, label: name.isEmpty ? "Caixa" : name)]
            _ = try await a.registerDevice(DeviceCreate(deviceNpub: npub, platform: platform, authorizationEvent: signList(next)))
            save(next)
        }
    }

    /// Removes a phone: a new list without it ends its sessions and revokes its terminal.
    func removeDevice(_ pubkeyHex: String) {
        run { [self] in
            guard let a = box.authed, let own = ownNpub else { return }
            guard pubkeyHex != settings.devicePubkey else { throw AppError.removeSelf }
            let next = settings.deviceList.filter { $0.pubkeyHex != pubkeyHex }
            _ = try await a.registerDevice(DeviceCreate(deviceNpub: own, platform: "ios", authorizationEvent: signList(next)))
            save(next)
        }
    }

    private func signList(_ entries: [DeviceList.Entry]) async throws -> NostrEvent {
        let at = max(Int64(Date().timeIntervalSince1970), settings.deviceListAt + 1)
        settings.deviceListAt = at
        let merchant = settings.merchantID
        return try await withKey(.root) { try DeviceList.event(root: $0, merchantID: merchant, devices: entries, createdAt: at) }
    }

    private func save(_ entries: [DeviceList.Entry]) {
        settings.deviceList = entries
        devices = entries
        message = "Lista de aparelhos atualizada."
    }

    func newEnrollmentCode() {
        run { [self] in
            guard let a = box.authed else { return }
            message = "Código para o novo aparelho: \(try await a.createEnrollmentCode().code) (vale 15 minutos)"
        }
    }

    // MARK: settings

    func unpair() {
        forget()
        screen = .setup
    }

    private func forget() {
        box.authed = nil
        box.reader = nil
        box.journal.journal = nil
        journalStore.delete()
        checkout.nextSale()
        vault.wipe()
        settings.clear()
        devices = []
        balance = nil
        entries = []
        quote = nil
    }

    /// The hardware model ("iPhone16,1"): what the device list and the platform record.
    static let model: String = {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }()
}
