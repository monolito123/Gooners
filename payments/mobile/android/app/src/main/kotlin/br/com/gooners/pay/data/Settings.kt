package br.com.gooners.pay.data

import android.content.Context
import androidx.core.content.edit
import br.com.gooners.pay.core.auth.DeviceList
import br.com.gooners.pay.core.checkout.MethodMemory
import br.com.gooners.pay.core.checkout.PayMethod
import br.com.gooners.pay.core.checkout.StanSource
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Non-secret settings of a paired phone. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("goonerspay.settings", Context.MODE_PRIVATE)

    var apiUrl: String
        get() = prefs.getString("api_url", "").orEmpty()
        set(v) = prefs.edit { putString("api_url", v) }

    /** The sandbox's development card key (hex). Empty outside the sandbox. */
    var sandboxCardKey: String
        get() = prefs.getString("sandbox_card_key", "").orEmpty()
        set(v) = prefs.edit { putString("sandbox_card_key", v) }

    var merchantId: String
        get() = prefs.getString("merchant_id", "").orEmpty()
        set(v) = prefs.edit { putString("merchant_id", v) }

    var deviceId: String
        get() = prefs.getString("device_id", "").orEmpty()
        set(v) = prefs.edit { putString("device_id", v) }

    /** The merchant's root key (hex), which every journal entry names. */
    var merchantRootPub: String
        get() = prefs.getString("merchant_root_pub", "").orEmpty()
        set(v) = prefs.edit { putString("merchant_root_pub", v) }

    var tradeName: String
        get() = prefs.getString("trade_name", "").orEmpty()
        set(v) = prefs.edit { putString("trade_name", v) }

    var rootBackedUp: Boolean
        get() = prefs.getBoolean("root_backed_up", false)
        set(v) = prefs.edit { putBoolean("root_backed_up", v) }

    /**
     * The device list the root key last signed (owner's phone only). The root key is the
     * list's only author, so this copy is the source of truth for the next one.
     */
    var deviceList: List<DeviceList.Entry>
        get() = Json.parseToJsonElement(prefs.getString("device_list", "[]")!!).jsonArray.map {
            val o = it.jsonObject
            DeviceList.Entry(o["pubkey"]!!.jsonPrimitive.content, o["platform"]!!.jsonPrimitive.content, o["label"]!!.jsonPrimitive.content)
        }
        set(v) = prefs.edit { putString("device_list", JsonArray(v.map {
            buildJsonObject { put("pubkey", it.pubkeyHex); put("platform", it.platform); put("label", it.label) }
        }).toString()) }

    /** created_at of the last signed list: the next one must be newer (docs/03 §4.2). */
    var deviceListAt: Long
        get() = prefs.getLong("device_list_at", 0)
        set(v) = prefs.edit { putLong("device_list_at", v) }

    /** The last payment method, first on the sheet next time (docs/06 §5). */
    val methods = object : MethodMemory {
        override var last: PayMethod?
            get() = prefs.getString("last_method", null)?.let { n -> PayMethod.entries.firstOrNull { it.name == n } }
            set(v) = prefs.edit { if (v == null) remove("last_method") else putString("last_method", v.name) }
    }

    /** The approval tone plays even in silent mode: a busy counter often needs it (docs/06 §7). */
    var approvalTone: Boolean
        get() = prefs.getBoolean("approval_tone", false)
        set(v) = prefs.edit { putBoolean("approval_tone", v) }

    /** The merchant takes stablecoins at the counter, settled in reais (docs/09). */
    var acceptsCrypto: Boolean
        get() = prefs.getBoolean("accepts_crypto", false)
        set(v) = prefs.edit { putBoolean("accepts_crypto", v) }

    /** The terminal's trace numbers, 000001..999999, kept across restarts. */
    val stan = StanSource {
        synchronized(this) {
            val next = prefs.getInt("stan", 0) % 999_999 + 1
            prefs.edit(commit = true) { putInt("stan", next) }
            next.toString().padStart(6, '0')
        }
    }

    fun clear() = prefs.edit { clear() }
}
