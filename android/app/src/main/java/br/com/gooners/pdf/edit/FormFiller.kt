package br.com.gooners.pdf.edit

import android.content.Context
import android.text.InputType
import android.view.View
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import br.com.gooners.pdf.ui.dp
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDCheckBox
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDChoice
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDField
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDRadioButton
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTextField
import java.io.File

/** Formulários AcroForm: lista os campos, deixa preencher e grava (com opção de achatar). */
object FormFiller {

    class Field(val name: String, val label: String, val kind: Int, val value: String, val options: List<String>)

    const val TEXT = 0
    const val CHECK = 1
    const val CHOICE = 2

    fun read(file: File, password: String?): List<Field> {
        PdfBoxUtil.load(file, password).use { doc ->
            val form = doc.documentCatalog.acroForm ?: return emptyList()
            val out = ArrayList<Field>()
            for (f: PDField in form.fieldTree) {
                if (f.isReadOnly) continue
                val label = f.alternateFieldName?.takeIf { it.isNotBlank() } ?: f.partialName ?: f.fullyQualifiedName
                when (f) {
                    is PDTextField -> out += Field(f.fullyQualifiedName, label, TEXT, f.value ?: "", emptyList())
                    is PDCheckBox -> out += Field(f.fullyQualifiedName, label, CHECK, if (f.isChecked) "1" else "", emptyList())
                    is PDRadioButton -> out += Field(f.fullyQualifiedName, label, CHOICE, f.value ?: "", f.onValues.toList())
                    is PDChoice -> out += Field(f.fullyQualifiedName, label, CHOICE, f.value.firstOrNull() ?: "", f.optionsDisplayValues)
                }
            }
            return out
        }
    }

    fun write(src: File, out: File, password: String?, values: Map<String, String>, flatten: Boolean) {
        PdfBoxUtil.load(src, password).use { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val form = doc.documentCatalog.acroForm ?: return
            form.needAppearances = false
            for ((name, v) in values) {
                val f = form.getField(name) ?: continue
                try {
                    when (f) {
                        is PDCheckBox -> if (v == "1") f.check() else f.unCheck()
                        is PDRadioButton -> if (v.isNotEmpty()) f.setValue(v)
                        is PDChoice -> if (v.isNotEmpty()) f.setValue(v)
                        is PDTextField -> f.setValue(v)
                    }
                } catch (_: Exception) {
                    // campo com aparência defeituosa: deixa o leitor regenerar
                    form.needAppearances = true
                    if (f is PDTextField) try { f.setValue(v) } catch (_: Exception) {}
                }
            }
            if (flatten) try { form.flatten() } catch (_: Exception) {}
            if (!password.isNullOrEmpty()) PdfBoxUtil.encrypt(doc, password)
            doc.save(out)
        }
    }

    fun dialog(ctx: Context, fields: List<Field>, onDone: (Map<String, String>, Boolean) -> Unit) {
        val box = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(ctx.dp(20), ctx.dp(8), ctx.dp(20), ctx.dp(8)) }
        val getters = ArrayList<Pair<String, () -> String>>()
        for (f in fields) {
            when (f.kind) {
                CHECK -> {
                    val cb = CheckBox(ctx).apply { text = f.label; isChecked = f.value == "1" }
                    box.addView(cb); getters += f.name to { if (cb.isChecked) "1" else "" }
                }
                CHOICE -> {
                    box.addView(TextView(ctx).apply { text = f.label; setPadding(0, ctx.dp(10), 0, 0) })
                    val sp = Spinner(ctx)
                    val opts = listOf("") + f.options
                    sp.adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, opts)
                    sp.setSelection(opts.indexOf(f.value).coerceAtLeast(0))
                    box.addView(sp); getters += f.name to { opts[sp.selectedItemPosition] }
                }
                else -> {
                    box.addView(TextView(ctx).apply { text = f.label; setPadding(0, ctx.dp(10), 0, 0) })
                    val et = EditText(ctx).apply { setText(f.value); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE }
                    box.addView(et); getters += f.name to { et.text.toString() }
                }
            }
        }
        val flatten = CheckBox(ctx).apply { text = "Achatar (impedir novas alterações nos campos)"; setPadding(0, ctx.dp(16), 0, 0) }
        box.addView(flatten)
        val sv = ScrollView(ctx).apply { addView(box) }
        MaterialAlertDialogBuilder(ctx).setTitle("Preencher formulário (${fields.size} campos)")
            .setView(sv)
            .setPositiveButton("Aplicar") { _, _ -> onDone(getters.associate { it.first to it.second() }, flatten.isChecked) }
            .setNegativeButton("Cancelar", null)
            .show()
        if (fields.isEmpty()) box.visibility = View.GONE
    }
}
