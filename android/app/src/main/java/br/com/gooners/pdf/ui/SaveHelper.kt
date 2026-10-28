package br.com.gooners.pdf.ui

import android.net.Uri
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.lifecycleScope
import br.com.gooners.pdf.util.FileUtil
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Salvar/compartilhar/abrir arquivos gerados. Deve ser criado como propriedade da Activity
 * (registra os launchers antes do onCreate).
 */
class SaveHelper(private val activity: ComponentActivity) {
    private var pendingOne: File? = null
    private var pendingMany: List<File> = emptyList()
    var onSaved: ((Uri) -> Unit)? = null

    private val createDoc = activity.registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val f = pendingOne ?: return@registerForActivityResult
        if (uri == null) return@registerForActivityResult
        activity.lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) { runCatching { FileUtil.writeTo(activity, f, uri) }.isSuccess }
            toast(if (ok) "Arquivo salvo" else "Não foi possível salvar")
            if (ok) onSaved?.invoke(uri)
        }
    }

    private val openTree = activity.registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) return@registerForActivityResult
        val files = pendingMany
        activity.lifecycleScope.launch {
            val n = withContext(Dispatchers.IO) {
                val dir = DocumentFile.fromTreeUri(activity, uri) ?: return@withContext 0
                var count = 0
                for (f in files) {
                    runCatching {
                        val doc = dir.createFile(FileUtil.mimeOf(f.name), f.name) ?: return@runCatching
                        FileUtil.writeTo(activity, f, doc.uri)
                        count++
                    }
                }
                count
            }
            toast("$n de ${files.size} arquivos salvos na pasta")
        }
    }

    fun saveAs(file: File, suggested: String = file.name) {
        pendingOne = file
        createDoc.launch(suggested)
    }

    fun saveAll(files: List<File>) {
        if (files.size == 1) { saveAs(files[0]); return }
        pendingMany = files
        openTree.launch(null)
    }

    /** Diálogo padrão de resultado: abrir, compartilhar ou salvar. */
    fun showResult(files: List<File>, message: String) {
        if (files.isEmpty()) { MaterialAlertDialogBuilder(activity).setTitle("Concluído").setMessage(message).setPositiveButton("OK", null).show(); return }
        val b = MaterialAlertDialogBuilder(activity).setTitle("Pronto!")
            .setMessage(message + "\n\n" + files.take(6).joinToString("\n") { "• ${it.name} (${FileUtil.human(it.length())})" } + if (files.size > 6) "\n…" else "")
            .setPositiveButton(if (files.size == 1) "Salvar" else "Salvar na pasta") { _, _ -> saveAll(files) }
            .setNeutralButton("Compartilhar") { _, _ -> FileUtil.share(activity, files) }
        if (files.size == 1) b.setNegativeButton("Abrir") { _, _ -> Router.openFile(activity, files[0]) }
        b.show()
    }

    private fun toast(s: String) = Toast.makeText(activity, s, Toast.LENGTH_SHORT).show()
}
