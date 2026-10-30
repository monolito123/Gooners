package br.com.gooners.pay.security

import android.security.keystore.UserNotAuthenticatedException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The user dismissed the biometric prompt. */
class UnlockCancelled : Exception("Autenticação cancelada")

/** Why the app asks the user to authenticate. */
enum class UnlockReason { KEYS, PAYOUT }

/**
 * Bridges code that needs the user's biometrics (a key unwrap, a payout) and the activity that
 * can show the prompt: callers suspend until the user authenticates or gives up.
 */
class Unlocker {
    private val mutex = Mutex()
    private val _request = MutableStateFlow<Pair<UnlockReason, CompletableDeferred<Boolean>>?>(null)
    val request: StateFlow<Pair<UnlockReason, CompletableDeferred<Boolean>>?> = _request.asStateFlow()

    private suspend fun prompt(reason: UnlockReason) {
        val d = CompletableDeferred<Boolean>()
        _request.value = reason to d
        val ok = try { d.await() } finally { _request.value = null }
        if (!ok) throw UnlockCancelled()
    }

    /** Runs [block], asking the user to authenticate first when the Keystore says it must. */
    suspend fun <T> withKeys(block: () -> T): T = mutex.withLock {
        try {
            block()
        } catch (e: UserNotAuthenticatedException) {
            prompt(UnlockReason.KEYS)
            block()
        }
    }

    /** Always asks: a step-up before money leaves the account. */
    suspend fun confirm(reason: UnlockReason) = mutex.withLock { prompt(reason) }

    fun answer(ok: Boolean) {
        _request.value?.second?.complete(ok)
    }
}
