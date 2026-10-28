package br.com.gooners.pdf.util

import android.content.Context
import android.content.SharedPreferences
import androidx.appcompat.app.AppCompatDelegate

object Prefs {
    private lateinit var sp: SharedPreferences

    fun init(ctx: Context) {
        sp = ctx.getSharedPreferences("settings", Context.MODE_PRIVATE)
    }

    var themeMode: Int
        get() = sp.getInt("theme", AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
        set(v) = sp.edit().putInt("theme", v).apply()

    /** 0 = normal, 1 = noturno (cores invertidas), 2 = sépia */
    var readingTheme: Int
        get() = sp.getInt("reading_theme", 0)
        set(v) = sp.edit().putInt("reading_theme", v).apply()

    var keepScreenOn: Boolean
        get() = sp.getBoolean("keep_on", true)
        set(v) = sp.edit().putBoolean("keep_on", v).apply()

    var textSize: Int
        get() = sp.getInt("text_size", 100)
        set(v) = sp.edit().putInt("text_size", v).apply()

    var penColor: Int
        get() = sp.getInt("pen_color", 0xFFDC2626.toInt())
        set(v) = sp.edit().putInt("pen_color", v).apply()

    var penWidth: Float
        get() = sp.getFloat("pen_width", 2f)
        set(v) = sp.edit().putFloat("pen_width", v).apply()

    fun lastPage(key: String): Int = sp.getInt("page_$key", 0)
    fun setLastPage(key: String, page: Int) = sp.edit().putInt("page_$key", page).apply()

    fun getString(key: String, def: String = ""): String = sp.getString(key, def) ?: def
    fun putString(key: String, value: String) = sp.edit().putString(key, value).apply()
}
