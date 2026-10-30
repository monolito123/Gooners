package br.com.gooners.pay.core

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

private val HEX = "0123456789abcdef".toCharArray()

/** Lowercase hex. */
fun ByteArray.toHex(): String {
    val out = CharArray(size * 2)
    for (i in indices) {
        val v = this[i].toInt() and 0xff
        out[2 * i] = HEX[v ushr 4]
        out[2 * i + 1] = HEX[v and 0x0f]
    }
    return String(out)
}

/** Parses even-length hex; throws on anything else. */
fun String.hexToBytes(): ByteArray {
    require(length % 2 == 0) { "hex must have an even length" }
    return ByteArray(length / 2) { i ->
        val hi = Character.digit(this[2 * i], 16)
        val lo = Character.digit(this[2 * i + 1], 16)
        require(hi >= 0 && lo >= 0) { "not hex: $this" }
        ((hi shl 4) or lo).toByte()
    }
}

fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

fun sha256(text: String): ByteArray = sha256(text.toByteArray(Charsets.UTF_8))

fun base64Url(data: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(data)

fun base64(data: ByteArray): String = Base64.getEncoder().encodeToString(data)

internal val secureRandom = SecureRandom()

fun randomBytes(n: Int): ByteArray = ByteArray(n).also { secureRandom.nextBytes(it) }
