package br.com.gooners.pay.core.auth

import br.com.gooners.pay.core.base64
import br.com.gooners.pay.core.base64Url
import br.com.gooners.pay.core.nostr.Event
import br.com.gooners.pay.core.nostr.NostrKeys
import br.com.gooners.pay.core.randomBytes
import br.com.gooners.pay.core.sha256
import br.com.gooners.pay.core.toHex
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

internal val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

/** NIP-98 (kind 27235): the device signs the exact URL, method and body of its login. */
object Nip98 {
    const val KIND = 27235

    fun event(keys: NostrKeys, method: String, url: String, body: ByteArray, createdAt: Long, aux: ByteArray? = null): Event =
        Event(createdAt = createdAt, kind = KIND, content = "",
            tags = listOf(listOf("u", url), listOf("method", method), listOf("payload", sha256(body).toHex())))
            .signedBy(keys, aux)

    /** The Authorization header value: "Nostr " + base64(event JSON). */
    fun header(event: Event): String = "Nostr " + base64(json.encodeToString(Event.serializer(), event).toByteArray(Charsets.UTF_8))
}

/** A P-256 public key as a JSON Web Key. */
@Serializable
data class Jwk(val kty: String = "EC", val crv: String = "P-256", val x: String, val y: String) {
    /** RFC 7638 thumbprint: SHA-256 of the required members in lexicographic order. */
    fun thumbprint(): String = base64Url(sha256("""{"crv":"$crv","kty":"$kty","x":"$x","y":"$y"}"""))
}

/**
 * Signs with a P-256 key that should never leave secure hardware (Android Keystore /
 * StrongBox, Secure Enclave). [sign] returns the raw 64-byte r‖s signature of SHA-256(data).
 */
interface P256Signer {
    val publicJwk: Jwk
    fun sign(data: ByteArray): ByteArray
}

/** DPoP proofs (RFC 9449) that bind every request to the device's hardware key. */
object Dpop {
    fun proof(signer: P256Signer, method: String, url: String, accessToken: String?, now: Long, jti: String = base64Url(randomBytes(16))): String {
        val header = buildJsonObject {
            put("typ", "dpop+jwt")
            put("alg", "ES256")
            putJsonObject("jwk") {
                put("kty", signer.publicJwk.kty)
                put("crv", signer.publicJwk.crv)
                put("x", signer.publicJwk.x)
                put("y", signer.publicJwk.y)
            }
        }
        val claims = buildJsonObject {
            put("jti", jti)
            put("htm", method)
            put("htu", htu(url))
            put("iat", now)
            if (accessToken != null) put("ath", base64Url(sha256(accessToken)))
        }
        val input = base64Url(header.toString().toByteArray()) + "." + base64Url(claims.toString().toByteArray())
        return input + "." + base64Url(signer.sign(input.toByteArray(Charsets.US_ASCII)))
    }

    /** The URL a proof names: no query and no fragment (RFC 9449 §4.2). */
    fun htu(url: String): String = url.substringBefore('#').substringBefore('?')
}

/** Converts a DER ECDSA signature (what JCA returns) to the 64-byte r‖s form JWS uses. */
fun derToRaw(der: ByteArray): ByteArray {
    require(der.size >= 8 && der[0] == 0x30.toByte()) { "not a DER signature" }
    var i = 2
    if (der[1].toInt() and 0x80 != 0) i = 2 + (der[1].toInt() and 0x7f)
    fun int(): ByteArray {
        require(der[i] == 0x02.toByte())
        val len = der[i + 1].toInt() and 0xff
        val v = der.copyOfRange(i + 2, i + 2 + len)
        i += 2 + len
        val trimmed = v.dropWhile { it == 0.toByte() }.toByteArray()
        require(trimmed.size <= 32)
        return ByteArray(32 - trimmed.size) + trimmed
    }
    return int() + int()
}

/** The merchant root key's device authorization list (kind 17710, docs/03 §4.2). */
object DeviceList {
    const val KIND = 17710

    data class Entry(val pubkeyHex: String, val platform: String, val label: String)

    fun event(root: NostrKeys, merchantId: String, devices: List<Entry>, createdAt: Long, aux: ByteArray? = null): Event {
        require(devices.size in 1..20) { "a device list holds 1 to 20 devices" }
        val tags = mutableListOf(listOf("v", "1"), listOf("merchant", merchantId))
        devices.forEach { tags += listOf("device", it.pubkeyHex, it.platform, it.label.take(40), createdAt.toString()) }
        return Event(createdAt = createdAt, kind = KIND, tags = tags, content = "").signedBy(root, aux)
    }
}
