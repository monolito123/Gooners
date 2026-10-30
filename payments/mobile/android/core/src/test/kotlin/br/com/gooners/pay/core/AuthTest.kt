package br.com.gooners.pay.core

import br.com.gooners.pay.core.auth.Dpop
import br.com.gooners.pay.core.auth.Jwk
import br.com.gooners.pay.core.auth.P256Signer
import br.com.gooners.pay.core.auth.derToRaw
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/** A software P-256 signer for tests; the app's lives in the Android Keystore. */
class SoftwareSigner : P256Signer {
    private val kp = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    override val publicJwk: Jwk = (kp.public as ECPublicKey).let { pub ->
        fun coord(b: BigInteger) = base64Url(b.toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else ByteArray(32 - it.size) + it })
        Jwk(x = coord(pub.w.affineX), y = coord(pub.w.affineY))
    }
    val public = kp.public
    override fun sign(data: ByteArray): ByteArray =
        derToRaw(Signature.getInstance("SHA256withECDSA").apply { initSign(kp.private); update(data) }.sign())
}

class AuthTest {
    @Test fun dpopProofHasTheClaimsTheServerChecks() {
        val signer = SoftwareSigner()
        val proof = Dpop.proof(signer, "POST", "https://api.goonerspay.example/v1/payouts?x=1#y", "sess_test_abc", 1793295130)
        val (h, c, s) = proof.split('.')
        val dec = Base64.getUrlDecoder()
        val header = Json.parseToJsonElement(String(dec.decode(h))).jsonObject
        val claims = Json.parseToJsonElement(String(dec.decode(c))).jsonObject
        assertEquals("dpop+jwt", header["typ"]!!.jsonPrimitive.content)
        assertEquals("ES256", header["alg"]!!.jsonPrimitive.content)
        assertEquals("https://api.goonerspay.example/v1/payouts", claims["htu"]!!.jsonPrimitive.content)
        assertEquals("POST", claims["htm"]!!.jsonPrimitive.content)
        assertEquals(1793295130, claims["iat"]!!.jsonPrimitive.long)
        assertEquals(base64Url(sha256("sess_test_abc")), claims["ath"]!!.jsonPrimitive.content)
        // The raw r||s signature verifies once converted back to DER.
        val raw = dec.decode(s)
        assertEquals(64, raw.size)
        fun derInt(b: ByteArray): ByteArray { val v = BigInteger(1, b).toByteArray(); return byteArrayOf(2, v.size.toByte()) + v }
        val body = derInt(raw.copyOfRange(0, 32)) + derInt(raw.copyOfRange(32, 64))
        val der = byteArrayOf(0x30, body.size.toByte()) + body
        assertTrue(Signature.getInstance("SHA256withECDSA").apply { initVerify(signer.public); update("$h.$c".toByteArray()) }.verify(der))
    }

    @Test fun moneyKeypad() {
        var m = Money.zero()
        for (d in listOf(1, 2, 9, 9, 0)) m = m.typed(d)
        assertEquals(12990, m.centavos)
        assertEquals("129.90", m.decimal())
        assertEquals(1299, m.backspace().centavos)
        var big = Money(Money.MAX_KEYPAD)
        big = big.typed(9)
        assertEquals(Money.MAX_KEYPAD, big.centavos)
        assertEquals(Money(12990), Money.parseDecimal("129.90"))
    }
}
