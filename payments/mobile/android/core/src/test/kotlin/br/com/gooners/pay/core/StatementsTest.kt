package br.com.gooners.pay.core

import br.com.gooners.pay.core.api.InclusionProof
import br.com.gooners.pay.core.nostr.Event
import br.com.gooners.pay.core.statements.Merkle
import br.com.gooners.pay.core.statements.Statement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The phone checks a statement the way docs/03 §6.5 says anyone can, on the spec's signed examples. */
class StatementsTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun file(name: String) = File(System.getProperty("nostr.examples"), name).readText()
    private fun event(name: String) = json.decodeFromString(Event.serializer(), file(name))
    private val statement = event("7713-settlement-statement.json")
    private val root = event("7715-transparency-root.json")
    private val merchant = Json.parseToJsonElement(statement.content).jsonObject["merchant_id"]!!.jsonPrimitive.content
    private val platformKeys = Json.parseToJsonElement(file("keys.json")).jsonObject["keys"]!!.jsonArray.map { it.jsonObject }
        .filter { it["role"]!!.jsonPrimitive.content.startsWith("platform-") }.map { it["pubkey"]!!.jsonPrimitive.content }.toSet()

    @Test fun theSpecStatementVerifies() {
        val s = Statement.verify(statement, root, merchant, platformKeys)
        assertTrue(s.check.toString(), s.check.ok)
        assertEquals("2026-10-29", s.date)
        assertEquals(s.gross - s.fees - s.refunds - s.chargebacks, s.net)
        val proof = json.decodeFromString(InclusionProof.serializer(), file("proof-receipt-0.json"))
        val p = proof.statementInclusion
        assertTrue(s.includes(proof.receiptEventId, p.leafIndex, p.treeSize, p.auditPath))
        assertFalse("another receipt does not verify with that proof", s.includes(s.lines[1].receiptEventId, p.leafIndex, p.treeSize, p.auditPath))
    }

    @Test fun eachTamperingIsCaught() {
        // A line changed after signing: the signature and the totals fail.
        val content = statement.content.replace("\"amount\":12990", "\"amount\":12000")
        val edited = Statement.verify(statement.copy(content = content), root, merchant).check
        assertFalse(edited.statementSigned)
        assertFalse(edited.totalsAddUp)
        // Another day's root, or a root nobody signed.
        assertFalse(Statement.verify(statement, event("7715-transparency-root-2026-10-28.json"), merchant).check.rootSigned)
        val forged = root.copy(content = root.content.replace("\"tree_size\":8", "\"tree_size\":9"))
        assertFalse(Statement.verify(statement, forged, merchant).check.rootSigned)
        // Someone else's statement, or keys the platform does not publish.
        assertFalse(Statement.verify(statement, root, "mer_someone_else").check.forThisMerchant)
        assertFalse(Statement.verify(statement, root, merchant, setOf("ab".repeat(32))).check.ok)
    }

    @Test fun merkleEdgeCases() {
        val leaf = "x".toByteArray()
        assertTrue(Merkle.verifyInclusion(leaf, 0, 1, emptyList(), Merkle.leafHash(leaf).toHex()))
        assertFalse(Merkle.verifyInclusion(leaf, 1, 1, emptyList(), Merkle.leafHash(leaf).toHex()))
        assertFalse(Merkle.verifyInclusion(leaf, -1, 1, emptyList(), Merkle.leafHash(leaf).toHex()))
        val other = Merkle.leafHash("y".toByteArray())
        val root = Merkle.nodeHash(Merkle.leafHash(leaf), other).toHex()
        assertTrue(Merkle.verifyInclusion(leaf, 0, 2, listOf(other), root))
        assertFalse("a proof one level short", Merkle.verifyInclusion(leaf, 0, 2, emptyList(), root))
    }
}
