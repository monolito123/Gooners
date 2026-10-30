package br.com.gooners.pay.core.pix

/**
 * Reads a Pix BR Code (EMV MPM, BCB Manual de Padrões para Iniciação do Pix). The app shows
 * the code the platform returns as a QR; decoding it checks the CRC and that the amount and
 * merchant are what the cashier typed before the customer sees it.
 */
data class BrCode(val dynamic: Boolean, val url: String?, val key: String?, val amount: String?, val merchantName: String, val merchantCity: String) {
    companion object {
        private const val GUI = "br.gov.bcb.pix"

        fun crc16(s: String): String {
            var crc = 0xFFFF
            for (b in s.toByteArray(Charsets.UTF_8)) {
                crc = crc xor ((b.toInt() and 0xff) shl 8)
                repeat(8) { crc = if (crc and 0x8000 != 0) (crc shl 1) xor 0x1021 else crc shl 1 }
                crc = crc and 0xFFFF
            }
            return "%04X".format(crc)
        }

        private fun fields(s: String): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            var i = 0
            while (i < s.length) {
                require(i + 4 <= s.length) { "BR Code: truncated field header" }
                val id = s.substring(i, i + 2)
                val len = s.substring(i + 2, i + 4).toIntOrNull() ?: throw IllegalArgumentException("BR Code: bad length")
                require(i + 4 + len <= s.length) { "BR Code: field $id runs past the end" }
                out[id] = s.substring(i + 4, i + 4 + len)
                i += 4 + len
            }
            return out
        }

        fun decode(code: String): BrCode {
            require(code.length > 8 && code.substring(code.length - 8, code.length - 4) == "6304") { "BR Code: no CRC field at the end" }
            require(crc16(code.substring(0, code.length - 4)) == code.takeLast(4).uppercase()) { "BR Code: CRC mismatch" }
            val f = fields(code)
            require(f["00"] == "01") { "BR Code: payload format must be 01" }
            val mai = fields(f["26"] ?: throw IllegalArgumentException("BR Code: no Pix merchant account (26)"))
            require(mai["00"].equals(GUI, ignoreCase = true)) { "BR Code: not a Pix code" }
            val dynamic = f["01"] == "12"
            return BrCode(dynamic, mai["25"], mai["01"], f["54"], f["59"].orEmpty(), f["60"].orEmpty())
        }
    }
}
