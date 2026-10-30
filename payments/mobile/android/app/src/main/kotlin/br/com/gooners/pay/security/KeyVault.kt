package br.com.gooners.pay.security

import android.app.KeyguardManager
import android.content.Context
import androidx.core.content.edit
import android.content.pm.PackageManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import br.com.gooners.pay.core.auth.Jwk
import br.com.gooners.pay.core.auth.P256Signer
import br.com.gooners.pay.core.auth.derToRaw
import br.com.gooners.pay.core.base64Url
import br.com.gooners.pay.core.nostr.NostrKeys
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The phone's keys (docs/05 §2.6):
 *
 * - the DPoP key, a P-256 key generated inside the Keystore (StrongBox when present) that
 *   signs every request's proof and can never be exported;
 * - the Nostr device key (and, on the owner's phone, the merchant root key): random secp256k1
 *   secrets the Keystore cannot hold, stored wrapped by a Keystore AES-GCM key. When the phone
 *   has a screen lock, unwrapping needs biometrics or the device credential within the last
 *   30 seconds.
 */
class KeyVault(private val context: Context) {
    private val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    private val prefs = context.getSharedPreferences("goonerspay.keys", Context.MODE_PRIVATE)

    /** Whether unwrapping keys requires the user (a screen lock exists). */
    val userAuthRequired: Boolean = context.getSystemService(KeyguardManager::class.java).isDeviceSecure

    private val hasStrongBox = context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)

    /**
     * The DPoP key. Generated on first use; with [attestationChallenge] the Keystore attests
     * it (docs/05 §2.4), so the platform can pin this device's sessions to this hardware key.
     */
    fun dpopSigner(attestationChallenge: ByteArray? = null): P256Signer {
        if (!ks.containsAlias(DPOP)) {
            fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(DPOP, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setIsStrongBoxBacked(strongBox)
                .apply { if (attestationChallenge != null) setAttestationChallenge(attestationChallenge) }
                .build()
            val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
            try {
                gen.initialize(spec(hasStrongBox))
                gen.generateKeyPair()
            } catch (e: StrongBoxUnavailableException) {
                gen.initialize(spec(false))
                gen.generateKeyPair()
            }
        }
        val private = ks.getKey(DPOP, null) as PrivateKey
        val public = ks.getCertificate(DPOP).publicKey as ECPublicKey
        fun coord(b: BigInteger): String {
            val raw = b.toByteArray()
            val fixed = if (raw.size > 32) raw.copyOfRange(raw.size - 32, raw.size) else ByteArray(32 - raw.size) + raw
            return base64Url(fixed)
        }
        val jwk = Jwk(x = coord(public.w.affineX), y = coord(public.w.affineY))
        return object : P256Signer {
            override val publicJwk = jwk
            override fun sign(data: ByteArray): ByteArray =
                derToRaw(Signature.getInstance("SHA256withECDSA").apply { initSign(private); update(data) }.sign())
        }
    }

    /** The DPoP key's attestation certificate chain (leaf first, base64 DER). */
    fun dpopAttestationChain(): List<String> =
        ks.getCertificateChain(DPOP)?.map { Base64.getEncoder().encodeToString(it.encoded) }.orEmpty()

    private fun wrappingKey(): SecretKey {
        (ks.getKey(WRAP, null) as? SecretKey)?.let { return it }
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(WRAP, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setIsStrongBoxBacked(strongBox)
            .apply {
                if (userAuthRequired) {
                    setUserAuthenticationRequired(true)
                    setUserAuthenticationParameters(AUTH_SECONDS, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                    setInvalidatedByBiometricEnrollment(true)
                }
            }
            .build()
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        return try {
            gen.init(spec(hasStrongBox))
            gen.generateKey()
        } catch (e: StrongBoxUnavailableException) {
            gen.init(spec(false))
            gen.generateKey()
        }
    }

    /** Wraps and stores a secret; throws UserNotAuthenticatedException when the user must unlock first. */
    fun store(name: String, keys: NostrKeys) {
        val secret = keys.exportSecret()
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, wrappingKey()) }
            val ct = c.doFinal(secret)
            prefs.edit { putString("$name.iv", b64(c.iv)); putString("$name.ct", b64(ct)); putString("$name.pub", keys.publicKeyHex) }
        } finally {
            secret.fill(0)
        }
    }

    fun has(name: String) = prefs.contains("$name.ct")

    fun publicKey(name: String): String? = prefs.getString("$name.pub", null)

    /** Unwraps a secret for one use; the caller wipes it. Throws UserNotAuthenticatedException when locked. */
    fun load(name: String): NostrKeys {
        val iv = unb64(prefs.getString("$name.iv", null) ?: error("no $name key"))
        val ct = unb64(prefs.getString("$name.ct", null) ?: error("no $name key"))
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, iv)) }
        val secret = c.doFinal(ct)
        return try {
            NostrKeys(secret)
        } finally {
            secret.fill(0)
        }
    }

    /** Forgets every key: unpairing this phone. */
    fun wipe() {
        prefs.edit { clear() }
        listOf(DPOP, WRAP).filter(ks::containsAlias).forEach(ks::deleteEntry)
    }

    private fun b64(b: ByteArray) = Base64.getEncoder().encodeToString(b)
    private fun unb64(s: String) = Base64.getDecoder().decode(s)

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val DPOP = "goonerspay.dpop"
        private const val WRAP = "goonerspay.wrap"
        const val AUTH_SECONDS = 30 // docs/05 §2.6: a stolen, idle phone stops signing within half a minute
        const val DEVICE = "device"
        const val ROOT = "root"
    }
}
