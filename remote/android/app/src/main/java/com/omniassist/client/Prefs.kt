package com.omniassist.client

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Encrypted local storage. Holds only the unattended-access settings.
 *
 * The unattended password is stored as a salted SHA-256 hash and NEVER leaves
 * the device: the controller proves knowledge of it by sending it over the
 * end-to-end-encrypted control channel, and this class verifies it locally.
 * The signaling server never sees it.
 */
class Prefs(context: Context) {

    private val sp = EncryptedSharedPreferences.create(
        context,
        "omniassist_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** A stable device id so the same device keeps its identity across runs. */
    var deviceId: String?
        get() = sp.getString(KEY_DEVICE_ID, null)
        set(v) = sp.edit().putString(KEY_DEVICE_ID, v).apply()

    val unattendedEnabled: Boolean
        get() = sp.contains(KEY_UNATTENDED_HASH)

    /** Set or clear the unattended-access password. */
    fun setUnattendedPassword(password: CharArray?) {
        if (password == null || password.isEmpty()) {
            sp.edit().remove(KEY_UNATTENDED_HASH).remove(KEY_UNATTENDED_SALT).apply()
            return
        }
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val hash = hash(password, salt)
        sp.edit()
            .putString(KEY_UNATTENDED_SALT, b64(salt))
            .putString(KEY_UNATTENDED_HASH, b64(hash))
            .apply()
        password.fill('\u0000')
    }

    /** Constant-time check of a candidate unattended password. */
    fun verifyUnattended(candidate: CharArray): Boolean {
        val salt = sp.getString(KEY_UNATTENDED_SALT, null) ?: return false
        val stored = sp.getString(KEY_UNATTENDED_HASH, null) ?: return false
        val computed = b64(hash(candidate, unb64(salt)))
        candidate.fill('\u0000')
        return MessageDigest.isEqual(computed.toByteArray(), stored.toByteArray())
    }

    private fun hash(password: CharArray, salt: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        md.update(salt)
        md.update(String(password).toByteArray(Charsets.UTF_8))
        return md.digest()
    }

    private fun b64(b: ByteArray) = android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP)
    private fun unb64(s: String) = android.util.Base64.decode(s, android.util.Base64.NO_WRAP)

    companion object {
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_UNATTENDED_HASH = "unattended_hash"
        private const val KEY_UNATTENDED_SALT = "unattended_salt"
    }
}
