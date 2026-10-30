package br.com.gooners.pay.core.nostr

import br.com.gooners.pay.core.hexToBytes
import br.com.gooners.pay.core.randomBytes
import br.com.gooners.pay.core.sha256
import br.com.gooners.pay.core.toHex
import fr.acinq.secp256k1.Secp256k1
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A Nostr event (NIP-01). */
@Serializable
data class Event(
    val id: String = "",
    val pubkey: String = "",
    @SerialName("created_at") val createdAt: Long,
    val kind: Int,
    val tags: List<List<String>>,
    val content: String,
    val sig: String = "",
) {
    /**
     * The NIP-01 commitment [0, pubkey, created_at, kind, tags, content], escaped exactly as
     * JavaScript's JSON.stringify (and the platform) do: \n \" \\ \r \t \b \f as short escapes,
     * other control characters as \u00xx, everything else raw UTF-8.
     */
    fun serialize(): String = buildString {
        append("[0,")
        appendJson(pubkey)
        append(',').append(createdAt).append(',').append(kind).append(",[")
        tags.forEachIndexed { i, t ->
            if (i > 0) append(',')
            append('[')
            t.forEachIndexed { j, v ->
                if (j > 0) append(',')
                appendJson(v)
            }
            append(']')
        }
        append("],")
        appendJson(content)
        append(']')
    }

    fun computeId(): String = sha256(serialize().toByteArray(Charsets.UTF_8)).toHex()

    /** Checks the ID and the BIP-340 signature. */
    fun verify(): Boolean {
        val computed = computeId()
        if (computed != id || pubkey.length != 64 || sig.length != 128) return false
        return runCatching { Secp256k1.verifySchnorr(sig.hexToBytes(), computed.hexToBytes(), pubkey.hexToBytes()) }.getOrDefault(false)
    }

    /** Signs with [keys]; [aux] is BIP-340 auxiliary randomness (fresh when null). */
    fun signedBy(keys: NostrKeys, aux: ByteArray? = null): Event {
        val unsigned = copy(pubkey = keys.publicKeyHex, id = "", sig = "")
        val id = unsigned.computeId()
        val sig = keys.signSchnorr(id.hexToBytes(), aux ?: randomBytes(32))
        return unsigned.copy(id = id, sig = sig.toHex())
    }

    fun tag(name: String): List<String>? = tags.firstOrNull { it.isNotEmpty() && it[0] == name }

    private fun StringBuilder.appendJson(s: String) {
        append('"')
        for (ch in s) {
            when (ch) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                else -> if (ch.code < 0x20) append("\\u00").append("0123456789abcdef"[ch.code ushr 4]).append("0123456789abcdef"[ch.code and 0xf]) else append(ch)
            }
        }
        append('"')
    }
}

/**
 * A secp256k1 key pair. On a phone the secret lives wrapped by a hardware key (Keystore,
 * Secure Enclave) and is unwrapped only for the signature; this class only holds it while
 * in use. Callers must [wipe] it.
 */
class NostrKeys(secret: ByteArray) {
    private val secret = secret.copyOf()

    init {
        require(secret.size == 32 && Secp256k1.secKeyVerify(secret)) { "not a valid secp256k1 secret key" }
    }

    /** x-only public key, hex. */
    val publicKeyHex: String = Secp256k1.pubkeyCreate(this.secret).copyOfRange(1, 33).toHex()

    val npub: String get() = Bech32.npub(publicKeyHex)

    fun signSchnorr(message32: ByteArray, aux32: ByteArray): ByteArray = Secp256k1.signSchnorr(message32, secret, aux32)

    fun exportSecret(): ByteArray = secret.copyOf()

    fun nsec(): String = Bech32.nsec(secret)

    fun wipe() = secret.fill(0)

    companion object {
        fun generate(): NostrKeys {
            while (true) {
                val s = randomBytes(32)
                if (Secp256k1.secKeyVerify(s)) return NostrKeys(s).also { s.fill(0) }
            }
        }

        fun fromNsec(nsec: String): NostrKeys = NostrKeys(Bech32.decode("nsec", nsec))
    }
}
