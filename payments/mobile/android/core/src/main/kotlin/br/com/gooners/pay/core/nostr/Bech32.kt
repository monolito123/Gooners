package br.com.gooners.pay.core.nostr

import br.com.gooners.pay.core.hexToBytes

/** BIP-173 bech32 as NIP-19 uses it (npub, nsec). */
object Bech32 {
    private const val CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    private val GEN = intArrayOf(0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)

    private fun polymod(values: IntArray): Int {
        var chk = 1
        for (v in values) {
            val b = chk ushr 25
            chk = ((chk and 0x1ffffff) shl 5) xor v
            for (i in 0 until 5) if (((b ushr i) and 1) == 1) chk = chk xor GEN[i]
        }
        return chk
    }

    private fun hrpExpand(hrp: String): IntArray =
        IntArray(hrp.length * 2 + 1).also { out ->
            hrp.forEachIndexed { i, c ->
                out[i] = c.code ushr 5
                out[i + hrp.length + 1] = c.code and 31
            }
        }

    private fun convertBits(data: ByteArray, from: Int, to: Int, pad: Boolean): IntArray {
        var acc = 0
        var bits = 0
        val out = ArrayList<Int>()
        val maxv = (1 shl to) - 1
        for (b in data) {
            val v = b.toInt() and ((1 shl from) - 1)
            acc = (acc shl from) or v
            bits += from
            while (bits >= to) {
                bits -= to
                out.add((acc ushr bits) and maxv)
            }
        }
        if (pad) {
            if (bits > 0) out.add((acc shl (to - bits)) and maxv)
        } else {
            require(bits < from && ((acc shl (to - bits)) and maxv) == 0) { "bech32: invalid padding" }
        }
        return out.toIntArray()
    }

    fun encode(hrp: String, data: ByteArray): String {
        val values = convertBits(data, 8, 5, true)
        val checksum = polymod(hrpExpand(hrp) + values + IntArray(6)) xor 1
        val sb = StringBuilder(hrp).append('1')
        for (v in values) sb.append(CHARSET[v])
        for (i in 0 until 6) sb.append(CHARSET[(checksum ushr (5 * (5 - i))) and 31])
        return sb.toString()
    }

    /** Decodes and checks the checksum; returns the payload bytes. */
    fun decode(expectedHrp: String, s: String): ByteArray {
        val lower = s.lowercase()
        require(lower.startsWith(expectedHrp + "1")) { "bech32: expected $expectedHrp" }
        val data = lower.substring(expectedHrp.length + 1).map { c ->
            val i = CHARSET.indexOf(c)
            require(i >= 0) { "bech32: invalid character" }
            i
        }.toIntArray()
        require(data.size >= 6 && polymod(hrpExpand(expectedHrp) + data) == 1) { "bech32: bad checksum" }
        val payload = data.copyOfRange(0, data.size - 6)
        val bytes = ByteArray(payload.size) { payload[it].toByte() }
        return convertBits(bytes, 5, 8, false).let { ints -> ByteArray(ints.size) { ints[it].toByte() } }
    }

    fun npub(pubkeyHex: String): String = encode("npub", pubkeyHexBytes(pubkeyHex))

    fun nsec(secret: ByteArray): String {
        require(secret.size == 32)
        return encode("nsec", secret)
    }

    private fun pubkeyHexBytes(h: String): ByteArray {
        val b = h.hexToBytes()
        require(b.size == 32) { "an x-only public key is 32 bytes" }
        return b
    }
}
