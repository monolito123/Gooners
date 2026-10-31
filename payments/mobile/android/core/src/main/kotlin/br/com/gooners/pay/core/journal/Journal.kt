package br.com.gooners.pay.core.journal

import br.com.gooners.pay.core.api.Clock
import br.com.gooners.pay.core.api.SystemClock
import br.com.gooners.pay.core.nostr.CanonicalJson
import br.com.gooners.pay.core.nostr.Event
import br.com.gooners.pay.core.nostr.NostrKeys
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Where the journal is kept on the phone: an app-private file, excluded from backups. */
interface JournalStore {
    fun read(): String?
    fun write(data: String)
}

class MemoryJournalStore : JournalStore {
    @Volatile private var data: String? = null
    override fun read() = data
    override fun write(data: String) {
        this.data = data
    }
}

/** The platform's answer to an upload (POST /v1/terminal/journal). */
@Serializable
data class JournalStatus(
    val status: String,
    val accepted: Int = 0,
    val duplicates: Int = 0,
    val head: Head? = null,
    val missing: List<List<Long>> = emptyList(),
    val forks: Int = 0,
) {
    @Serializable
    data class Head(val seq: Long, @SerialName("event_id") val eventId: String)
}

/**
 * The device's append-only, hash-chained journal (kind 7714, docs/03 §7). An entry's ID is
 * fixed when it is written: it depends on the device's public key, not on the secret. So
 * entries chain at once, even while the device key stays locked behind biometrics, and are
 * signed in a batch the next time the key is unwrapped (every login), then uploaded in order.
 */
class Journal(
    private val store: JournalStore,
    private val devicePubkeyHex: String,
    private val merchantRootPubHex: String,
    private val appVersion: String,
    private val clock: Clock = SystemClock,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    @Serializable
    private data class Entry(val event: Event, val seq: Long, val uploaded: Boolean = false)

    @Serializable
    private data class State(val entries: List<Entry> = emptyList(), val seq: Long = 0, val head: String? = null)

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private var state: State = store.read()?.let { runCatching { json.decodeFromString(State.serializer(), it) }.getOrNull() } ?: State()

    private fun save(s: State) {
        // Keep everything not yet accepted, and the last uploaded entries to answer a platform
        // that asks for them again.
        val keep = s.entries.filter { !it.uploaded } + s.entries.filter { it.uploaded }.takeLast(KEEP_UPLOADED)
        state = s.copy(entries = keep.sortedBy { it.seq })
        store.write(json.encodeToString(State.serializer(), state))
    }

    /** Appends an entry of [type] with [fields] (payment_intent_id, amount, result…) and returns it unsigned. */
    @Synchronized
    fun append(type: String, fields: JsonObject = JsonObject(emptyMap())): Event {
        val seq = state.seq + 1
        val now = clock.now()
        val content = buildJsonObject {
            fields.forEach { (k, v) -> put(k, v) }
            put("v", 1)
            put("seq", seq)
            put("prev", state.head?.let(::JsonPrimitive) ?: JsonNull)
            put("type", type)
            put("local_time", DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(Instant.ofEpochSecond(now).atZone(zone).toOffsetDateTime()))
            put("app", buildJsonObject { put("version", appVersion) })
        }
        val unsigned = Event(pubkey = devicePubkeyHex, createdAt = now, kind = KIND, tags = listOf(listOf("merchant", merchantRootPubHex)),
            content = CanonicalJson.encode(content))
        val ev = unsigned.copy(id = unsigned.computeId())
        save(state.copy(entries = state.entries + Entry(ev, seq), seq = seq, head = ev.id))
        return ev
    }

    /** Signs every unsigned entry with the device key; IDs do not change. Returns how many. */
    @Synchronized
    fun signPending(keys: NostrKeys): Int {
        require(keys.publicKeyHex == devicePubkeyHex) { "not this device's key" }
        var n = 0
        val entries = state.entries.map { e ->
            if (e.event.sig.isNotEmpty()) return@map e
            val signed = e.event.signedBy(keys)
            check(signed.id == e.event.id) { "journal entry ${e.seq} changed while signing" }
            n++
            e.copy(event = signed)
        }
        if (n > 0) save(state.copy(entries = entries))
        return n
    }

    /** Signed entries the platform has not accepted, in seq order. */
    @Synchronized
    fun toUpload(max: Int = MAX_BATCH): List<Event> = state.entries.filter { !it.uploaded && it.event.sig.isNotEmpty() }.take(max).map { it.event }

    /** Records an upload: what was sent is accepted, except the ranges the platform still lacks. */
    @Synchronized
    fun record(sent: List<Event>, status: JournalStatus) {
        val sentIds = sent.map { it.id }.toSet()
        val entries = state.entries.map { e ->
            val missing = status.missing.any { r -> r.size == 2 && e.seq in r[0]..r[1] }
            when {
                missing -> e.copy(uploaded = false)
                e.event.id in sentIds -> e.copy(uploaded = true)
                else -> e
            }
        }
        save(state.copy(entries = entries))
    }

    val head: String? get() = state.head
    val lastSeq: Long get() = state.seq
    val unsignedCount: Int @Synchronized get() = state.entries.count { it.event.sig.isEmpty() }
    val pendingCount: Int @Synchronized get() = state.entries.count { !it.uploaded }

    companion object {
        const val KIND = 7714
        const val MAX_BATCH = 500
        private const val KEEP_UPLOADED = 1000

        /** The amount object of docs/03 §2.2. */
        fun amount(centavos: Long): JsonObject = buildJsonObject {
            put("value", centavos)
            put("currency", "BRL")
            put("exponent", 2)
        }
    }
}
