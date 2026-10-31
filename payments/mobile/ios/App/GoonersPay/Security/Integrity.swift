import CryptoKit
import DeviceCheck
import Foundation

/// Evidence that this is the genuine app on a genuine iPhone, sent at enrollment (docs/05 §3.6).
/// App Attest attests a key whose client data is the device's Nostr key; the platform's
/// attestor verifies it against Apple's root. The sandbox records it without verifying. The
/// same key then signs every card authorization (an assertion), so the platform knows each
/// sale came from this app on this iPhone.
protocol IntegrityProvider: Sendable {
    func evidence(devicePubkeyHex: String) async -> [String: String]
}

struct AppAttestIntegrity: IntegrityProvider {
    /// The attested key's identifier (not a secret: the key stays in the Secure Enclave).
    private static let keyIDDefault = "goonerspay.appAttestKeyID"

    /// Signs SHA-256 of a request body with the attested key; nil before any attestation.
    static func assertionSigner() -> (@Sendable (Data) async throws -> Data)? {
        guard DCAppAttestService.shared.isSupported, let keyID = UserDefaults.standard.string(forKey: keyIDDefault) else { return nil }
        return { hash in try await DCAppAttestService.shared.generateAssertion(keyID, clientDataHash: hash) }
    }

    func evidence(devicePubkeyHex: String) async -> [String: String] {
        let service = DCAppAttestService.shared
        guard service.isSupported else { return ["type": "none", "nonce": devicePubkeyHex] }
        do {
            let keyID = try await service.generateKey()
            let hash = Data(SHA256.hash(data: Data(devicePubkeyHex.utf8)))
            let attestation = try await service.attestKey(keyID, clientDataHash: hash)
            UserDefaults.standard.set(keyID, forKey: Self.keyIDDefault)
            return ["type": "app_attest", "key_id": keyID, "attestation": attestation.base64EncodedString(), "client_data": devicePubkeyHex]
        } catch {
            return ["type": "none", "nonce": devicePubkeyHex, "error": String((error as NSError).code)]
        }
    }
}
