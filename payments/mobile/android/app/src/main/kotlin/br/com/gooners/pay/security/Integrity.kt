package br.com.gooners.pay.security

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Evidence that this is the genuine app on a sound phone, sent at enrollment (docs/05 §2.4).
 * Production sends a Play Integrity token whose request hash is the device key, verified by the
 * platform's attestor. The sandbox records the evidence without verifying it.
 */
fun interface IntegrityProvider {
    suspend fun evidence(devicePubkeyHex: String): JsonObject
}

val UnverifiedIntegrity = IntegrityProvider { pub ->
    buildJsonObject {
        put("type", "none")
        put("nonce", pub)
    }
}
