package br.com.gooners.pay

import android.app.Application
import android.content.Context
import br.com.gooners.pay.core.api.GoonersPayApi
import br.com.gooners.pay.core.hexToBytes
import br.com.gooners.pay.core.sandbox.CardReader
import br.com.gooners.pay.core.sandbox.SandboxCardReader
import br.com.gooners.pay.data.Settings
import br.com.gooners.pay.security.IntegrityProvider
import br.com.gooners.pay.security.KeyVault
import br.com.gooners.pay.security.Unlocker
import br.com.gooners.pay.security.UnverifiedIntegrity

class GoonersPayApp : Application() {
    val container by lazy { AppContainer(this) }
}

/** The app's long-lived objects. */
class AppContainer(context: Context) {
    val settings = Settings(context)
    val vault = KeyVault(context)
    val unlocker = Unlocker()
    val integrity: IntegrityProvider = UnverifiedIntegrity

    fun api(url: String = settings.apiUrl) = GoonersPayApi(url)

    /**
     * The card reader. Production plugs in the licensed MPoC SDK here; until then only the
     * sandbox reader exists, and only when the sandbox's card key is configured.
     */
    fun reader(): CardReader {
        val key = settings.sandboxCardKey
        check(key.length == 64) { "Nenhum leitor de cartão disponível neste aparelho. Use Pix." }
        sandboxReader?.takeIf { sandboxKey == key }?.let { return it }
        return SandboxCardReader(key.hexToBytes()).also { sandboxReader = it; sandboxKey = key }
    }

    private var sandboxReader: SandboxCardReader? = null
    private var sandboxKey = ""

    /** The sandbox reader, to choose which test card it taps. */
    fun sandboxReaderOrNull(): SandboxCardReader? = runCatching { reader() as? SandboxCardReader }.getOrNull()
}
