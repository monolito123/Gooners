package br.com.gooners.pdf

import android.app.Application
import androidx.appcompat.app.AppCompatDelegate
import br.com.gooners.pdf.util.Prefs
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import java.io.File

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        Prefs.init(this)
        AppCompatDelegate.setDefaultNightMode(Prefs.themeMode)
        PDFBoxResourceLoader.init(this)
        // Remove cópias de trabalho antigas (mais de 2 dias) para o app não ocupar espaço à toa.
        Thread {
            val limit = System.currentTimeMillis() - 2L * 24 * 3600 * 1000
            listOf("work", "out", "tmp", "zip").forEach { sub ->
                File(cacheDir, sub).listFiles()?.forEach { f -> if (f.lastModified() < limit) f.deleteRecursively() }
            }
        }.start()
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
