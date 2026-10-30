package br.com.gooners.pay.core.statements

import br.com.gooners.pay.core.hexToBytes
import br.com.gooners.pay.core.nostr.CanonicalJson
import br.com.gooners.pay.core.nostr.Event
import br.com.gooners.pay.core.sha256
import br.com.gooners.pay.core.toHex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** RFC 6962 Merkle trees as the platform builds them (docs/03 §6): inclusion proofs per RFC 9162 §2.1.3.2. */
object Merkle {
    fun leafHash(data: ByteArray): ByteArray = sha256(byteArrayOf(0) + data)

    fun nodeHash(left: ByteArray, right: ByteArray): ByteArray = sha256(byteArrayOf(1) + left + right)

    /** Whether [leafData] is the leaf at [index] of the tree of [treeSize] leaves whose root is [rootHex]. */
    fun verifyInclusion(leafData: ByteArray, index: Long, treeSize: Long, path: List<ByteArray>, rootHex: String): Boolean {
        if (index < 0 || index >= treeSize) return false
        var fn = index
        var sn = treeSize - 1
        var r = leafHash(leafData)
        for (p in path) {
            if (sn == 0L) return false
            if (fn % 2 == 1L || fn == sn) {
                r = nodeHash(p, r)
                if (fn % 2 == 0L) {
                    while (fn % 2 == 0L && fn != 0L) {
                        fn = fn shr 1
                        sn = sn shr 1
                    }
                }
            } else {
                r = nodeHash(r, p)
            }
            fn = fn shr 1
            sn = sn shr 1
        }
        return sn == 0L && r.toHex() == rootHex
    }

    /** The leaf committing one merchant's statement into the day's public log (docs/03 §6.2). */
    fun statementLeafData(saltHex: String, commitmentHex: String): ByteArray =
        "goonerspay/v1/statement-leaf".toByteArray() + saltHex.hexToBytes() + commitmentHex.hexToBytes()
}

/** One sale in a statement. */
data class StatementLine(val receiptEventId: String, val amount: Long, val fee: Long, val settles: String)

/** What the phone checked about a day's statement, each check on its own (docs/03 §6.5). */
data class StatementCheck(
    /** The statement (kind 7713) is signed, by [statementSigner]. */
    val statementSigned: Boolean,
    /** It is this merchant's statement. */
    val forThisMerchant: Boolean,
    /** Gross, fees and net add up from the lines. */
    val totalsAddUp: Boolean,
    /** statement_commitment is the hash of the canonical statement. */
    val commitmentMatches: Boolean,
    /** The day's public root (kind 7715) is signed, by [rootSigner], and is the one the statement names. */
    val rootSigned: Boolean,
    /** The statement is a leaf of that public root. */
    val inPublicRoot: Boolean,
    val statementSigner: String,
    val rootSigner: String,
) {
    val ok: Boolean get() = statementSigned && forThisMerchant && totalsAddUp && commitmentMatches && rootSigned && inPublicRoot
}

/** A day's statement as the merchant reads it. */
data class Statement(
    val date: String,
    val merchantId: String,
    val currency: String,
    val gross: Long,
    val fees: Long,
    val refunds: Long,
    val chargebacks: Long,
    val net: Long,
    val lines: List<StatementLine>,
    val receiptsRoot: String,
    val check: StatementCheck,
) {
    /** Whether the receipt [receiptEventId] is in this statement, from the platform's proof. */
    fun includes(receiptEventId: String, leafIndex: Long, treeSize: Long, auditPath: List<String>): Boolean =
        lines.any { it.receiptEventId == receiptEventId } &&
            Merkle.verifyInclusion(receiptEventId.hexToBytes(), leafIndex, treeSize, auditPath.map { it.hexToBytes() }, receiptsRoot)

    companion object {
        /**
         * Reads and checks a statement against the day's public root, the way anyone holding
         * them can (docs/03 §6.5): nothing here trusts the API's other answers. [platformKeys],
         * when known (the keys the platform publishes), must have signed both events.
         */
        fun verify(statement: Event, root: Event, merchantId: String, platformKeys: Set<String> = emptySet()): Statement {
            val c = Json.parseToJsonElement(statement.content).jsonObject
            val totals = c["totals"]!!.jsonObject
            fun total(k: String) = totals[k]!!.jsonPrimitive.long
            val lines = c["lines"]!!.jsonArray.map {
                val o = it.jsonObject
                StatementLine(o["receipt_event_id"]!!.jsonPrimitive.content, o["amount"]!!.jsonPrimitive.long, o["fee"]!!.jsonPrimitive.long,
                    o["settles"]?.jsonPrimitive?.content ?: "")
            }
            val commitment = c["statement_commitment"]!!.jsonPrimitive.content
            val t = c["transparency"]!!.jsonObject
            val body = JsonObject(c - "statement_commitment" - "transparency")
            val rootContent = runCatching { Json.parseToJsonElement(root.content).jsonObject }.getOrNull()
            val signedBy = { e: Event -> e.verify() && (platformKeys.isEmpty() || e.pubkey in platformKeys) }
            val check = StatementCheck(
                statementSigned = statement.kind == KIND_STATEMENT && signedBy(statement),
                forThisMerchant = c["merchant_id"]?.jsonPrimitive?.content == merchantId,
                totalsAddUp = total("gross") == lines.sumOf { it.amount } && total("fees") == lines.sumOf { it.fee } &&
                    total("net") == total("gross") - total("fees") - total("refunds") - total("chargebacks"),
                commitmentMatches = sha256(CanonicalJson.encode(body)).toHex() == commitment,
                rootSigned = root.kind == KIND_ROOT && signedBy(root) && root.id == t["root_event_id"]?.jsonPrimitive?.content &&
                    rootContent?.get("date")?.jsonPrimitive?.content == c["date"]?.jsonPrimitive?.content,
                inPublicRoot = rootContent != null && Merkle.verifyInclusion(
                    Merkle.statementLeafData(t["leaf_salt"]!!.jsonPrimitive.content, commitment),
                    t["leaf_index"]!!.jsonPrimitive.long, t["tree_size"]!!.jsonPrimitive.long,
                    t["audit_path"]!!.jsonArray.map { it.jsonPrimitive.content.hexToBytes() }, rootContent["root"]!!.jsonPrimitive.content),
                statementSigner = statement.pubkey,
                rootSigner = root.pubkey,
            )
            return Statement(c["date"]!!.jsonPrimitive.content, c["merchant_id"]!!.jsonPrimitive.content, c["currency"]!!.jsonPrimitive.content,
                total("gross"), total("fees"), total("refunds"), total("chargebacks"), total("net"), lines, c["receipts_root"]!!.jsonPrimitive.content, check)
        }

        const val KIND_STATEMENT = 7713
        const val KIND_ROOT = 7715
    }
}
