package br.com.gooners.pay.core.risk

import br.com.gooners.pay.core.Money

/**
 * The phone's half of the fraud shield (docs/07 §3): signals only the phone sees, scored by a
 * model compiled into the app. Raw observations never leave the phone; the authorization
 * carries the score, the model's name and at most five signal codes (§3.5).
 *
 * The platform knows the model and recomputes the score from the codes, so a tampered app
 * gains nothing by reporting a low score with them (§3.8). The conformance vectors hold this
 * core, the iOS core and the platform to the same numbers.
 */
object DeviceModel {
    const val NAME = "gp-device-1"
    const val MAX_SIGNALS = 5

    /** Weights in thousandths (docs/07 §3.3). */
    val WEIGHTS: Map<String, Int> = mapOf(
        // Device posture
        "hooking" to 700, "root_indicators" to 600, "debugger" to 600, "emulator" to 500, "overlay_active" to 400,
        "accessibility_service" to 350, "screen_captured" to 300, "adb_enabled" to 200, "developer_options" to 100,
        // Relay timing (from the MPoC kernel)
        "apdu_rtt_p99_exceeded" to 500,
        // Interaction
        "fast_amount_to_tap" to 250, "cancelled_taps" to 200, "repeated_amount" to 150, "just_under_limit" to 150,
        // Session
        "decline_streak" to 350, "tap_burst" to 300,
    )

    data class Score(val milli: Int, val signals: List<String>)

    /**
     * A noisy OR in integer thousandths: each signal, heaviest first (ties by name), keeps
     * (1000 - weight)/1000 of the remaining "clean" mass, truncated at every step. Unknown
     * codes weigh nothing. Returns the score and the heaviest [MAX_SIGNALS] codes.
     */
    fun score(signals: Collection<String>): Score {
        val known = signals.filter { it in WEIGHTS }.distinct()
            .sortedWith(compareByDescending<String> { WEIGHTS.getValue(it) }.thenBy { it })
        var clean = 1000
        for (s in known) clean = clean * (1000 - WEIGHTS.getValue(s)) / 1000
        return Score(1000 - clean, known.take(MAX_SIGNALS))
    }
}

/** Device posture the app reads from the OS (debugger, root, overlays…); the core cannot see it. */
fun interface PostureSource {
    fun signals(): Set<String>
}

/** What goes into the authorization request. */
data class DeviceRiskReport(val milli: Int, val model: String, val signals: List<String>)

/**
 * Watches the sales on this phone for the interaction and session signals of docs/07 §3.3,
 * adds the posture signals and scores each tap. Thread-safe.
 */
class RiskMonitor(
    private val posture: PostureSource = PostureSource { emptySet() },
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private var typingStartedAt: Long? = null
    private val taps = ArrayDeque<Pair<Long, Long>>() // time, centavos
    private val cancels = ArrayDeque<Long>()
    private val results = ArrayDeque<String>()

    /** The cashier typed a digit of a new amount. */
    @Synchronized
    fun typing() {
        if (typingStartedAt == null) typingStartedAt = clock()
    }

    /** A sale was abandoned before its card was sent. */
    @Synchronized
    fun cancelled() {
        cancels.addLast(clock())
        typingStartedAt = null
    }

    /** A card was read for [amount]: the report to send with its authorization. */
    @Synchronized
    fun tapped(amount: Money): DeviceRiskReport {
        val now = clock()
        while (taps.isNotEmpty() && now - taps.first().first > WINDOW_MILLIS) taps.removeFirst()
        while (cancels.isNotEmpty() && now - cancels.first() > WINDOW_MILLIS) cancels.removeFirst()
        val signals = posture.signals().toMutableSet()
        typingStartedAt?.let { if (now - it < FAST_TAP_MILLIS) signals += "fast_amount_to_tap" }
        if (cancels.size >= CANCELLED_TAPS) signals += "cancelled_taps"
        if (taps.size >= 2 && taps.takeLast(2).all { it.second == amount.centavos }) signals += "repeated_amount"
        if (amount.centavos in (NO_CVM_LIMIT * 95 / 100) until NO_CVM_LIMIT) signals += "just_under_limit"
        if (taps.count { now - it.first <= BURST_MILLIS } + 1 >= BURST_TAPS) signals += "tap_burst"
        if (results.size >= DECLINE_STREAK && results.all { it == "declined" || it == "pin_required" }) signals += "decline_streak"
        taps.addLast(now to amount.centavos)
        typingStartedAt = null
        val s = DeviceModel.score(signals)
        return DeviceRiskReport(s.milli, DeviceModel.NAME, s.signals)
    }

    /** The authorization's status (approved, declined, pin_required, timeout). */
    @Synchronized
    fun result(status: String) {
        results.addLast(status)
        while (results.size > DECLINE_STREAK) results.removeFirst()
    }

    companion object {
        const val WINDOW_MILLIS = 10 * 60_000L
        /** Faster than a cashier types an amount and a customer presents a card. */
        const val FAST_TAP_MILLIS = 1_500L
        const val CANCELLED_TAPS = 3
        /** More taps than a till can take: card-testing scripts. */
        const val BURST_TAPS = 8
        const val BURST_MILLIS = 2 * 60_000L
        const val DECLINE_STREAK = 3
        /** The contactless limit without cardholder verification in Brazil, centavos. */
        const val NO_CVM_LIMIT = 200_00L
    }
}
