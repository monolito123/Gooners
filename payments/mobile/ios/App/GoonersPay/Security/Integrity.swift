import CryptoKit
import DeviceCheck
import Foundation

/// Evidence that this is the genuine app on a genuine iPhone, sent at enrollment (docs/05 §3.6).
/// App Attest attests a key whose client data is the device's Nostr key; the platform's
/// attestor verifies it against Apple's root. The sandbox records it without verifying.
protocol IntegrityProvider: Sendable {
    func evidence(devicePubkeyHex: String) async -> [String: String]
}

struct AppAttestIntegrity: IntegrityProvider {
    func evidence(devicePubkeyHex: String) async -> [String: String] {
        let service = DCAppAttestService.shared
        guard service.isSupported else { return ["type": "none", "nonce": devicePubkeyHex] }
        do {
            let keyID = try await service.generateKey()
            let hash = Data(SHA256.hash(data: Data(devicePubkeyHex.utf8)))
            let attestation = try await service.attestKey(keyID, clientDataHash: hash)
            return ["type": "app_attest", "key_id": keyID, "attestation": attestation.base64EncodedString(), "client_data": devicePubkeyHex]
        } catch {
            return ["type": "none", "nonce": devicePubkeyHex, "error": String((error as NSError).code)]
        }
    }
}
