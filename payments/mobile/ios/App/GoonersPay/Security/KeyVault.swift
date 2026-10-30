import CryptoKit
import Foundation
import GoonersPayKit
import LocalAuthentication
import Security

enum KeyName: String, Sendable {
    case device, root
}

enum VaultError: LocalizedError {
    case keychain(OSStatus)
    case noKey
    case cancelled
    /// A new face or fingerprint, or a removed passcode, destroyed the wrapping key on purpose.
    case invalidated
    case crypto(String)

    var errorDescription: String? {
        switch self {
        case let .keychain(s): "Erro no chaveiro do aparelho (\(s))."
        case .noKey: "Este aparelho não tem as chaves da loja."
        case .cancelled: "Autenticação cancelada."
        case .invalidated: "As chaves deste aparelho foram invalidadas por uma mudança no Face ID ou no código. Pareie novamente."
        case let .crypto(m): m
        }
    }
}

/// The DPoP key, a Secure Enclave P-256 key that signs every request's proof and never leaves
/// the Enclave (CryptoKit stores only an Enclave-encrypted handle).
struct EnclaveSigner: P256Signer, @unchecked Sendable {
    let key: SecureEnclave.P256.Signing.PrivateKey
    let publicJWK: JWK

    init(key: SecureEnclave.P256.Signing.PrivateKey) {
        self.key = key
        publicJWK = JWK(x963: key.publicKey.x963Representation)
    }

    func sign(_ data: Data) throws -> Data { try key.signature(for: data).rawRepresentation }
}

/// The phone's keys (docs/05 §3.6):
///
/// - the DPoP key in the Secure Enclave;
/// - the Nostr device key (and, on the owner's phone, the merchant root key): secp256k1
///   secrets the Enclave cannot hold, stored ECIES-encrypted to an Enclave P-256 key whose use
///   needs Face ID (or the passcode on phones without biometrics). One authentication covers
///   30 seconds of use.
///
/// The simulator has no Secure Enclave: there the keys live in the keychain unwrapped, which
/// is only acceptable for development.
final class KeyVault: @unchecked Sendable {
    private let service = "br.com.gooners.pay"
    private let wrapTag = Data("br.com.gooners.pay.wrap".utf8)
    private let lock = NSLock()
    private var context = KeyVault.newContext()

    private static func newContext() -> LAContext {
        let c = LAContext()
        c.touchIDAuthenticationAllowableReuseDuration = 30
        c.localizedReason = "Desbloquear as chaves da loja"
        return c
    }

    /// Whether the phone has a passcode, without which nothing can be protected.
    var deviceIsSecure: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        #endif
    }

    // MARK: DPoP

    func dpopSigner() throws -> P256Signer {
        #if targetEnvironment(simulator)
        if let raw = try read("dpop.software") { return SoftwareP256Signer(key: try P256.Signing.PrivateKey(rawRepresentation: raw)) }
        let k = P256.Signing.PrivateKey()
        try write("dpop.software", k.rawRepresentation)
        return SoftwareP256Signer(key: k)
        #else
        if let blob = try read("dpop.enclave") { return EnclaveSigner(key: try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)) }
        let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, nil)!
        let k = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
        try write("dpop.enclave", k.dataRepresentation)
        return EnclaveSigner(key: k)
        #endif
    }

    // MARK: Nostr keys

    func has(_ name: KeyName) -> Bool { (try? read("nostr." + name.rawValue)) != nil }

    func store(_ name: KeyName, _ keys: NostrKeys) throws {
        var secret = keys.exportSecret()
        defer { secret.resetBytes(in: 0..<secret.count) }
        #if targetEnvironment(simulator)
        try write("nostr." + name.rawValue, secret)
        #else
        guard let pub = try SecKeyCopyPublicKey(wrappingKey(create: true)) else { throw VaultError.crypto("Chave de proteção sem chave pública.") }
        var error: Unmanaged<CFError>?
        guard let ct = SecKeyCreateEncryptedData(pub, .eciesEncryptionCofactorVariableIVX963SHA256AESGCM, secret as CFData, &error) as Data? else {
            throw VaultError.crypto(error?.takeRetainedValue().localizedDescription ?? "ECIES")
        }
        try write("nostr." + name.rawValue, ct)
        #endif
    }

    /// Unwraps a key for one use; the caller wipes it. Blocks while Face ID runs: never call
    /// it on the main thread.
    func load(_ name: KeyName) throws -> NostrKeys {
        guard let blob = try read("nostr." + name.rawValue) else { throw VaultError.noKey }
        #if targetEnvironment(simulator)
        return try NostrKeys(secret: blob)
        #else
        let key = try wrappingKey(create: false)
        var error: Unmanaged<CFError>?
        guard var secret = SecKeyCreateDecryptedData(key, .eciesEncryptionCofactorVariableIVX963SHA256AESGCM, blob as CFData, &error) as Data? else {
            let e = error?.takeRetainedValue()
            if let e, CFErrorGetDomain(e) as String == LAErrorDomain || CFErrorGetCode(e) == Int(errSecUserCanceled) {
                throw VaultError.cancelled
            }
            throw VaultError.invalidated
        }
        defer { secret.resetBytes(in: 0..<secret.count) }
        return try NostrKeys(secret: secret)
        #endif
    }

    /// The Enclave key the Nostr secrets are encrypted to. It is created with the access control
    /// the secrets need: biometrics (invalidated when the enrolled faces change) or the passcode.
    private func wrappingKey(create: Bool) throws -> SecKey {
        let ctx = lock.withLock { context }
        var item: CFTypeRef?
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: wrapTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
            kSecUseAuthenticationContext as String: ctx,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let item { return item as! SecKey }
        guard create else { throw status == errSecItemNotFound ? VaultError.invalidated : VaultError.keychain(status) }
        let biometrics = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        let flags: SecAccessControlCreateFlags = biometrics ? [.privateKeyUsage, .biometryCurrentSet] : [.privateKeyUsage, .devicePasscode]
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, flags, &error) else {
            throw VaultError.crypto(error?.takeRetainedValue().localizedDescription ?? "access control")
        }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: wrapTag,
                kSecAttrAccessControl as String: access,
            ] as [String: Any],
        ]
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw VaultError.crypto(error?.takeRetainedValue().localizedDescription ?? "Secure Enclave")
        }
        return key
    }

    /// Asks for Face ID or the passcode now, whatever was authenticated before: a step-up
    /// before money leaves the account.
    func confirm(_ reason: String) async throws {
        do {
            _ = try await LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            throw VaultError.cancelled
        }
    }

    /// Forgets every key: unpairing this phone.
    func wipe() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
        SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: wrapTag] as CFDictionary)
        lock.withLock { context = KeyVault.newContext() }
    }

    // MARK: keychain items (this device only, never in backups)

    private func read(_ account: String) throws -> Data? {
        var item: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ] as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw VaultError.keychain(status) }
        return item as? Data
    }

    private func write(_ account: String, _ data: Data) throws {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var item = base
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw VaultError.keychain(status) }
    }
}
