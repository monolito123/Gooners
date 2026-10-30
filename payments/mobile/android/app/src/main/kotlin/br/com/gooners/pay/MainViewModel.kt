package br.com.gooners.pay

import android.app.Application
import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import br.com.gooners.pay.core.Money
import br.com.gooners.pay.core.statements.Statement
import br.com.gooners.pay.core.api.Settlement
import br.com.gooners.pay.core.api.ApiException
import br.com.gooners.pay.core.api.Balance
import br.com.gooners.pay.core.api.DeviceCreate
import br.com.gooners.pay.core.api.Entry
import br.com.gooners.pay.core.api.GoonersPayApi
import br.com.gooners.pay.core.api.PixDestination
import br.com.gooners.pay.core.api.Quote
import br.com.gooners.pay.core.auth.DeviceList
import br.com.gooners.pay.core.auth.KeyAttestation
import br.com.gooners.pay.core.checkout.CheckoutController
import br.com.gooners.pay.core.journal.Journal
import br.com.gooners.pay.core.nostr.Bech32
import br.com.gooners.pay.core.nostr.Event
import br.com.gooners.pay.core.nostr.NostrKeys
import br.com.gooners.pay.core.risk.RiskMonitor
import br.com.gooners.pay.core.toHex
import br.com.gooners.pay.security.KeyVault
import br.com.gooners.pay.security.UnlockCancelled
import br.com.gooners.pay.security.UnlockReason
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Where the app is. */
sealed interface Screen {
    data object Loading : Screen
    data object Setup : Screen
    /** The owner writes down the merchant root key before anything else (docs/03 §4.1). */
    data class Backup(val nsec: String) : Screen
    /** A cashier phone waits for the owner's phone to add it to the device list. */
    data class AwaitingApproval(val npub: String, val tradeName: String) : Screen
    data object Home : Screen
}

enum class Tab(val label: String) { CHARGE("Cobrar"), MONEY("Recebíveis"), DEVICES("Aparelhos"), SETTINGS("Ajustes") }

data class MoneyState(
    val balance: Balance? = null,
    val entries: List<Entry> = emptyList(),
    val quote: Quote? = null,
    val destination: PixDestination? = null,
    val lastPayout: String? = null,
    val settlements: List<Settlement> = emptyList(),
    /** The statement open on screen, checked on the phone. */
    val statement: Statement? = null,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as GoonersPayApp).container
    val unlocker = c.unlocker
    val settings = c.settings

    private val _screen = MutableStateFlow<Screen>(Screen.Loading)
    val screen: StateFlow<Screen> = _screen.asStateFlow()
    private val _tab = MutableStateFlow(Tab.CHARGE)
    val tab: StateFlow<Tab> = _tab.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()
    private val _money = MutableStateFlow(MoneyState())
    val money: StateFlow<MoneyState> = _money.asStateFlow()
    private val _devices = MutableStateFlow(settings.deviceList)
    val devices: StateFlow<List<DeviceList.Entry>> = _devices.asStateFlow()

    private var authed: GoonersPayApi.Authed? = null
    private var journal: Journal? = null

    val checkout = CheckoutController(
        api = { authed ?: error("Sessão encerrada. Abra o app novamente.") },
        reader = { c.reader() },
        stan = settings.stan,
        scope = viewModelScope,
        journal = { journal },
        risk = RiskMonitor(c.posture),
    )

    /** The journal, once the merchant's root key is known (it names it in every entry). */
    private fun journal(): Journal? {
        journal?.let { return it }
        val device = c.vault.publicKey(KeyVault.DEVICE) ?: return null
        val root = settings.merchantRootPub.ifEmpty { return null }
        return Journal(c.journalStore, device, root, BuildConfig.VERSION_NAME).also { journal = it }
    }

    val isOwner: Boolean get() = c.vault.has(KeyVault.ROOT)
    val ownNpub: String? get() = c.vault.publicKey(KeyVault.DEVICE)?.let(Bech32::npub)
    val needsScreenLock: Boolean get() = !c.vault.userAuthRequired && !BuildConfig.DEBUG

    /** The sandbox reader, when this phone is paired with the sandbox, to pick the test card. */
    val sandboxReader get() = c.sandboxReaderOrNull()

    init {
        resume()
    }

    fun select(t: Tab) {
        _tab.value = t
        if (t == Tab.MONEY) refreshMoney()
    }

    fun dismissMessage() {
        _message.value = null
    }

    private fun run(block: suspend CoroutineScope.() -> Unit) = viewModelScope.launch {
        _busy.value = true
        try {
            block()
        } catch (e: UnlockCancelled) {
            _message.value = "Autenticação cancelada."
        } catch (e: KeyPermanentlyInvalidatedException) {
            // A new fingerprint or a removed screen lock destroys the wrapping key on purpose.
            forget()
            _message.value = "As chaves deste aparelho foram invalidadas por uma mudança no bloqueio de tela. Pareie novamente."
        } catch (e: ApiException) {
            _message.value = e.problem?.detail ?: e.problem?.title ?: "Erro ${e.status}"
        } catch (e: Exception) {
            _message.value = e.message ?: e.toString()
        } finally {
            _busy.value = false
        }
    }

    /** Where to start when the app opens. */
    private fun resume() = run {
        _screen.value = when {
            !c.vault.has(KeyVault.DEVICE) -> Screen.Setup
            isOwner && !settings.rootBackedUp -> Screen.Backup(withKey(KeyVault.ROOT) { it.nsec() })
            settings.deviceId.isEmpty() -> Screen.AwaitingApproval(ownNpub.orEmpty(), settings.tradeName)
            else -> {
                login()
                Screen.Home
            }
        }
    }

    /** Unwraps a key for one use and wipes it after. */
    private suspend fun <T> withKey(name: String, f: suspend (NostrKeys) -> T): T {
        val key = unlocker.withKeys { c.vault.load(name) }
        return try {
            f(key)
        } finally {
            key.wipe()
        }
    }

    private suspend fun login() {
        val api = c.api()
        val dpop = c.vault.dpopSigner()
        journal()?.append("session_start")
        val session = withKey(KeyVault.DEVICE) { key ->
            val deviceId = settings.deviceId.ifEmpty { null }
            try {
                api.login(key, dpop, deviceId)
            } catch (e: ApiException) {
                // A phone the owner added (or a platform that turned strict attestation on)
                // proves itself at login: once, with its key attestation.
                if (e.status != 401 || e.problem?.detail?.contains("attestation_required") != true) throw e
                api.login(key, dpop, deviceId, c.integrity.evidence(key.publicKeyHex))
            }.also { journal()?.signPending(key) }
        }
        val a = api.Authed({ unlocker.withKeys { c.vault.load(KeyVault.DEVICE) } }, dpop, session, onKey = { journal()?.signPending(it) })
        authed = a
        settings.deviceId = session.deviceId
        settings.merchantId = session.merchantId
        if (settings.merchantRootPub.isEmpty()) {
            // A cashier phone learns the root key from the merchant; its journal starts now.
            a.merchant().rootNpub?.let { settings.merchantRootPub = Bech32.decode("npub", it).toHex() }
            journal()?.append("session_start")
        }
        syncJournal()
    }

    /** Uploads signed journal entries; the platform's answer says what it still lacks. */
    private fun syncJournal() = viewModelScope.launch {
        val a = authed ?: return@launch
        val j = journal() ?: return@launch
        runCatching { a.syncJournal(j) }.onSuccess { st ->
            if (st?.status == "fork_detected") _message.value = "A goonersPAY bloqueou este terminal: o diário do aparelho foi duplicado. Fale com o suporte."
        }
    }

    /**
     * Pairs this phone with the merchant the enrollment code names. On the merchant's first
     * phone it also creates the root key, which authorizes every later device.
     */
    fun pair(apiUrl: String, code: String, sandboxCardKey: String) = run {
        check(!needsScreenLock) { "Configure um bloqueio de tela (PIN, padrão ou biometria) antes de parear." }
        val url = apiUrl.trim().trimEnd('/')
        check(BuildConfig.DEBUG || url.startsWith("https://", ignoreCase = true)) { "O endereço da plataforma precisa começar com https://." }
        val api = c.api(url)
        val enrollment = api.lookupEnrollment(code.trim())
        forget()
        settings.apiUrl = url
        settings.sandboxCardKey = sandboxCardKey.trim().lowercase()
        settings.merchantId = enrollment.merchantId
        settings.tradeName = enrollment.tradeName
        val device = NostrKeys.generate()
        try {
            unlocker.withKeys { c.vault.store(KeyVault.DEVICE, device) }
            // The DPoP key is born attested to this device key (forget() removed any older one).
            c.vault.dpopSigner(KeyAttestation.challenge(device.publicKeyHex))
            if (enrollment.rootNpub != null) {
                _screen.value = Screen.AwaitingApproval(device.npub, enrollment.tradeName)
                return@run
            }
            val root = NostrKeys.generate()
            try {
                unlocker.withKeys { c.vault.store(KeyVault.ROOT, root) }
                val entries = listOf(DeviceList.Entry(device.publicKeyHex, "android", Build.MODEL))
                val now = System.currentTimeMillis() / 1000
                val list = DeviceList.event(root, enrollment.merchantId, entries, now)
                val created = api.enroll(code.trim(), DeviceCreate(device.npub, "android", Build.MODEL, c.integrity.evidence(device.publicKeyHex), list))
                settings.deviceId = created.id
                settings.merchantRootPub = root.publicKeyHex
                settings.deviceList = entries
                settings.deviceListAt = now
                _devices.value = entries
                _screen.value = Screen.Backup(root.nsec())
            } finally {
                root.wipe()
            }
        } catch (e: Exception) {
            forget()
            throw e
        } finally {
            device.wipe()
        }
    }

    /** The owner wrote the root key down. */
    fun backedUp() = run {
        settings.rootBackedUp = true
        login()
        _screen.value = Screen.Home
    }

    /** A cashier phone tries to log in once the owner says it was added. */
    fun checkApproval() = run {
        try {
            login()
            _screen.value = Screen.Home
        } catch (e: ApiException) {
            if (e.status != 401) throw e
            _message.value = "Este aparelho ainda não foi autorizado. Peça ao dono para adicioná-lo em Aparelhos."
        }
    }

    // ---- money ----

    fun refreshMoney() = run {
        val a = authed ?: return@run
        val balance = a.balance()
        val entries = a.entries(20).data
        val settlements = a.settlements().data
        _money.update { it.copy(balance = balance, entries = entries, settlements = settlements) }
    }

    /** Opens a day's statement: fetched, then checked against the public root on the phone. */
    fun openStatement(s: Settlement) = run {
        val a = authed ?: return@run
        val keys = BuildConfig.PLATFORM_KEYS.split(',').map { it.trim() }.filter { it.length == 64 }.toSet()
        _money.update { it.copy(statement = a.verifiedStatement(s, keys)) }
    }

    fun closeStatement() = _money.update { it.copy(statement = null) }

    fun quotePayout(amount: Money, keyType: String, key: String) = run {
        val a = authed ?: return@run
        val destination = PixDestination(keyType = keyType, key = key.trim())
        val quote = a.quote(amount.centavos, destination)
        _money.update { it.copy(quote = quote, destination = destination, lastPayout = null) }
    }

    fun cancelQuote() = _money.update { it.copy(quote = null) }

    /** Sends the quoted payout after a fresh biometric confirmation. */
    fun confirmPayout() = run {
        val a = authed ?: return@run
        val q = _money.value.quote ?: return@run
        unlocker.confirm(UnlockReason.PAYOUT)
        val p = a.payout(q.id)
        _money.update { it.copy(quote = null, lastPayout = "Saque ${Money(p.amount).format()}: ${p.status}") }
        refreshMoney()
    }

    // ---- devices (owner) ----

    /** Adds a phone by its npub: the root key signs a new device list naming it. */
    fun addDevice(npub: String, platform: String, label: String) = run {
        val a = authed ?: return@run
        val pub = Bech32.decode("npub", npub.trim()).toHex()
        val current = settings.deviceList
        check(current.none { it.pubkeyHex == pub }) { "Este aparelho já está autorizado." }
        val entries = current + DeviceList.Entry(pub, platform, label.trim().ifEmpty { "Caixa" })
        a.registerDevice(DeviceCreate(npub.trim(), platform, authorizationEvent = signList(entries)))
        saveList(entries)
    }

    /** Removes a phone: a new list without it ends its sessions and revokes its terminal. */
    fun removeDevice(pubkeyHex: String) = run {
        val a = authed ?: return@run
        val own = c.vault.publicKey(KeyVault.DEVICE)
        check(pubkeyHex != own) { "Para remover este aparelho, use Ajustes › Desparear." }
        val entries = settings.deviceList.filter { it.pubkeyHex != pubkeyHex }
        a.registerDevice(DeviceCreate(Bech32.npub(own!!), "android", authorizationEvent = signList(entries)))
        saveList(entries)
    }

    private suspend fun signList(entries: List<DeviceList.Entry>): Event {
        val at = maxOf(System.currentTimeMillis() / 1000, settings.deviceListAt + 1)
        settings.deviceListAt = at
        return withKey(KeyVault.ROOT) { DeviceList.event(it, settings.merchantId, entries, at) }
    }

    private fun saveList(entries: List<DeviceList.Entry>) {
        settings.deviceList = entries
        _devices.value = entries
        _message.value = "Lista de aparelhos atualizada."
    }

    fun newEnrollmentCode() = run {
        val a = authed ?: return@run
        _message.value = "Código para o novo aparelho: ${a.createEnrollmentCode().code} (vale 15 minutos)"
    }

    // ---- settings ----

    fun unpair() = run {
        forget()
        _screen.value = Screen.Setup
    }

    private fun forget() {
        authed = null
        journal = null
        c.journalStore.delete()
        c.vault.wipe()
        settings.clear()
        _devices.value = emptyList()
        _money.value = MoneyState()
    }
}
