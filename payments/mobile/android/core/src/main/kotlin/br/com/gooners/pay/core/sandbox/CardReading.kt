package br.com.gooners.pay.core.sandbox

import br.com.gooners.pay.core.Money
import br.com.gooners.pay.core.base64
import br.com.gooners.pay.core.randomBytes
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** The EMV application the cashier chose (Brazilian combo cards carry both). */
enum class EmvApplication(val wire: String) { CREDIT("credit"), DEBIT("debit") }

/** Card data encrypted on the device for the platform's decryptor; the app never sees it in the clear in production. */
data class EncryptedCard(val format: String, val ksn: String, val ciphertext: ByteArray)

/**
 * Where card data comes from. In production this is the licensed MPoC SDK (Android) or
 * ProximityReader / a PCI PTS reader (iOS): they encrypt inside their secure boundary and the
 * app only forwards the blob (docs/05 §2.2: feature code never sees card data or SDK types).
 */
interface CardReader {
    /** Human-readable name shown on the waiting screen. */
    val name: String
    suspend fun read(amount: Money, application: EmvApplication): EncryptedCard
}

/** Clear card data in the development format: field names and order match the platform's carddata.Card. */
@Serializable
data class DevCard(
    val pan: String,
    val expiry: String,
    val track2: String? = null,
    @SerialName("pan_sequence") val panSequence: String? = null,
    val emv: String? = null,
    val aid: String? = null,
    @SerialName("pin_block") val pinBlock: String? = null,
)

/** carddata.DevFormat: nonce(12) ‖ AES-256-GCM(json(card)), additional data = KSN. */
object DevFormat {
    const val NAME = "dev-aesgcm-v1"
    private val json = Json { explicitNulls = false }

    fun encrypt(key: ByteArray, ksn: String, card: DevCard, nonce: ByteArray = randomBytes(12)): ByteArray {
        require(key.size == 32 && nonce.size == 12)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        c.updateAAD(ksn.toByteArray(Charsets.UTF_8))
        return nonce + c.doFinal(json.encodeToString(DevCard.serializer(), card).toByteArray(Charsets.UTF_8))
    }

    fun decrypt(key: ByteArray, ksn: String, blob: ByteArray): DevCard {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, blob.copyOfRange(0, 12)))
        c.updateAAD(ksn.toByteArray(Charsets.UTF_8))
        return json.decodeFromString(DevCard.serializer(), String(c.doFinal(blob.copyOfRange(12, blob.size)), Charsets.UTF_8))
    }
}

/**
 * A sandbox reader: "taps" a scheme test card and encrypts it in the development format, so
 * the whole checkout runs against the sandbox without card hardware. The platform refuses
 * this format in production; the sandbox's key is public.
 */
class SandboxCardReader(private val devKey: ByteArray, var card: TestCard = TestCard.VISA_CREDIT) : CardReader {
    override val name = "Leitor de teste (sandbox)"
    private var ksnCounter = 0

    /**
     * Each reader holds its own copy of each test card: the test card's BIN and last four
     * digits around random middle digits, and its own transaction counter (ATC, EMV tag
     * 9F36). The platform's card-level fraud rules (velocity, counter continuity) then see one
     * customer's card, not a number every sandbox user shares.
     */
    private val issued = mutableMapOf<TestCard, Pair<String, Int>>()

    /** This reader's PAN for [c]. */
    @Synchronized
    fun panOf(c: TestCard): String = issued.getOrPut(c) { personalize(c.pan) to 0 }.first

    @Synchronized
    private fun nextTap(c: TestCard): Pair<String, Int> {
        val (pan, atc) = issued.getOrPut(c) { personalize(c.pan) to 0 }
        return (pan to atc + 1).also { issued[c] = it }
    }

    enum class TestCard(val pan: String, val aid: String, val label: String) {
        VISA_CREDIT("4111111111111111", "A0000000031010", "Visa crédito"),
        MASTERCARD("5555555555554444", "A0000000041010", "Mastercard"),
        ELO("6362970000457013", "A0000004942010", "Elo"),
    }

    override suspend fun read(amount: Money, application: EmvApplication): EncryptedCard {
        val c = card
        val (pan, atc) = nextTap(c)
        val ksn = synchronized(this) { ksnCounter++; "FFFF9876543210E" + ksnCounter.toString().padStart(5, '0') }
        val dev = DevCard(pan = pan, expiry = "2911", aid = c.aid,
            emv = "9F2608A1B2C3D4E5F607089F2701809F3704C0FFEE119F3602" + "%04X".format(atc and 0xFFFF) + "9A032610299C0100")
        return EncryptedCard(DevFormat.NAME, ksn, DevFormat.encrypt(devKey, ksn, dev))
    }

    companion object {
        /** Keeps [testPan]'s first six and last four digits, randomizes the rest and fixes the Luhn digit. */
        fun personalize(testPan: String, random: java.util.Random = java.security.SecureRandom()): String {
            val middle = (0 until testPan.length - 11).map { random.nextInt(10) }.joinToString("")
            return (0..9).map { testPan.take(6) + middle + it + testPan.takeLast(4) }.first(::luhn)
        }

        fun luhn(pan: String): Boolean = pan.reversed().mapIndexed { i, c ->
            val d = c - '0'
            if (i % 2 == 1) (d * 2).let { if (it > 9) it - 9 else it } else d
        }.sum() % 10 == 0
    }
}

fun EncryptedCard.base64Ciphertext(): String = base64(ciphertext)
