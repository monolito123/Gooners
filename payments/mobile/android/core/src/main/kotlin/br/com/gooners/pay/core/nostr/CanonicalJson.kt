package br.com.gooners.pay.core.nostr

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Canonical JSON (docs/03 §2.2): keys sorted, no whitespace, integers only, strings escaped
 * as NIP-01 does. Event contents built this way have the same bytes, and so the same event
 * ID, in Kotlin, Swift, Go and JavaScript (conformance vectors, canonical_json).
 */
object CanonicalJson {
    fun encode(e: JsonElement): String = StringBuilder().also { write(it, e) }.toString()

    private fun write(b: StringBuilder, e: JsonElement) {
        when (e) {
            is JsonNull -> b.append("null")
            is JsonObject -> {
                b.append('{')
                e.keys.sorted().forEachIndexed { i, k ->
                    if (i > 0) b.append(',')
                    b.append(jsonString(k)).append(':')
                    write(b, e.getValue(k))
                }
                b.append('}')
            }
            is JsonArray -> {
                b.append('[')
                e.forEachIndexed { i, x ->
                    if (i > 0) b.append(',')
                    write(b, x)
                }
                b.append(']')
            }
            is JsonPrimitive -> when {
                e.isString -> b.append(jsonString(e.content))
                e.content == "true" || e.content == "false" -> b.append(e.content)
                else -> b.append(requireNotNull(e.longOrNull) { "canonical JSON has integers only: ${e.content}" })
            }
        }
    }
}
