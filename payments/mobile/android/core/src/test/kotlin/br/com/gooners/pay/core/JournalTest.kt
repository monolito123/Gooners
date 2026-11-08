package br.com.gooners.pay.core

import br.com.gooners.pay.core.journal.Journal
import br.com.gooners.pay.core.journal.JournalStatus
import br.com.gooners.pay.core.journal.MemoryJournalStore
import br.com.gooners.pay.core.nostr.NostrKeys
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JournalTest {
    private val device = NostrKeys.generate()
    private val root = NostrKeys.generate()

    @Test
    fun entriesChainBeforeTheKeyIsUnwrapped() {
        val store = MemoryJournalStore()
        var now = 1_793_295_000L
        val j = Journal(store, device.publicKeyHex, root.publicKeyHex, "0.1.0", { now })
        val a = j.append("session_start")
        now += 5
        val b = j.append("tap_started", Journal.amount(4590))
        val c = j.append("auth_result")
        fun content(e: br.com.gooners.pay.core.nostr.Event) = Json.parseToJsonElement(e.content).jsonObject
        assertEquals("null", content(a)["prev"].toString())
        assertEquals(a.id, content(b)["prev"]!!.jsonPrimitive.content)
        assertEquals(b.id, content(c)["prev"]!!.jsonPrimitive.content)
        assertEquals(3L, content(c)["seq"]!!.jsonPrimitive.long)
        assertTrue(j.toUpload().isEmpty()) // nothing is sent unsigned
        assertEquals(3, j.unsignedCount)

        assertEquals(3, j.signPending(device))
        val signed = j.toUpload()
        assertEquals(listOf(a.id, b.id, c.id), signed.map { it.id }) // signing does not change IDs
        assertTrue(signed.all { it.verify() })

        // The journal survives a restart, and the platform asks again for entry 2.
        val again = Journal(store, device.publicKeyHex, root.publicKeyHex, "0.1.0", { now })
        again.record(signed, JournalStatus("platform_behind", missing = listOf(listOf(2L, 2L))))
        assertEquals(listOf(b.id), again.toUpload().map { it.id })
        again.record(listOf(signed[1]), JournalStatus("consistent"))
        assertTrue(again.toUpload().isEmpty())
        assertEquals(c.id, again.head)
        val d = again.append("session_end")
        assertEquals(c.id, content(d)["prev"]!!.jsonPrimitive.content)
    }

    @Test(expected = IllegalArgumentException::class)
    fun onlyTheDeviceKeySigns() {
        val j = Journal(MemoryJournalStore(), device.publicKeyHex, root.publicKeyHex, "0.1.0")
        j.append("session_start")
        j.signPending(root)
    }

    @Test
    fun aCorruptStoreStartsAFreshJournal() {
        val store = MemoryJournalStore().apply { write("{not json") }
        val j = Journal(store, device.publicKeyHex, root.publicKeyHex, "0.1.0")
        assertNull(j.head)
        assertEquals(1L, Json.parseToJsonElement(j.append("session_start").content).jsonObject["seq"]!!.jsonPrimitive.long)
    }
}
