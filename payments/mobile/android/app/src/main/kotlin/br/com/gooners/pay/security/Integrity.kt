package br.com.gooners.pay.security

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Evidence that this is the genuine app on a sound phone (docs/05 §2.4): the Keystore's
 * attestation of the DPoP key, generated with a challenge bound to the device key. The
 * platform verifies the chain against Google's roots, the locked bootloader, verified boot,
 * this package and its signing certificate. The sandbox records it without verifying.
 */
fun interface IntegrityProvider {
    suspend fun evidence(devicePubkeyHex: String): JsonObject
}

class KeyAttestationIntegrity(private val vault: KeyVault) : IntegrityProvider {
    override suspend fun evidence(devicePubkeyHex: String): JsonObject {
        val chain = vault.dpopAttestationChain()
        if (chain.size < 2) return buildJsonObject { put("type", "none"); put("nonce", devicePubkeyHex) }
        return buildJsonObject {
            put("type", "android_key_attestation")
            putJsonArray("certificate_chain") { chain.forEach { add(it) } }
        }
    }
}
