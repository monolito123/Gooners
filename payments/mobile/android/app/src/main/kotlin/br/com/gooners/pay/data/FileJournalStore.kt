package br.com.gooners.pay.data

import br.com.gooners.pay.core.journal.JournalStore
import java.io.File

/** The terminal journal in the app's private files (excluded from backups), written atomically. */
class FileJournalStore(private val file: File) : JournalStore {
    override fun read(): String? = runCatching { file.readText() }.getOrNull()

    @Synchronized
    override fun write(data: String) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(data)
        if (!tmp.renameTo(file)) {
            file.writeText(data)
            tmp.delete()
        }
    }

    fun delete() {
        file.delete()
    }
}
