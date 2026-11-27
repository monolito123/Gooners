package br.com.gooners.pdf.convert

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.util.Base64
import br.com.gooners.pdf.util.FileUtil
import java.io.ByteArrayOutputStream
import java.io.File

/** Banco de dados SQLite: lista tabelas e visões com as primeiras linhas de cada uma (somente leitura). */
object SqliteViewer {
    private const val ROWS = 200

    fun toHtml(file: File): String {
        val db = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS)
        db.use {
            val objects = ArrayList<Triple<String, String, String?>>()
            db.rawQuery("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name", null).use { c ->
                while (c.moveToNext()) objects += Triple(c.getString(0), c.getString(1), c.getString(2))
            }
            val sb = StringBuilder("<div class=\"note\">Banco SQLite · ${objects.size} tabela(s)/visão(ões) · ${FileUtil.human(file.length())}</div>")
            if (objects.size > 1) {
                sb.append("<div class=\"tabs\">")
                objects.forEachIndexed { i, o -> sb.append("<a href=\"#t$i\">").append(X.esc(o.first)).append("</a>") }
                sb.append("</div>")
            }
            objects.forEachIndexed { i, (name, type, sql) ->
                val q = "\"" + name.replace("\"", "\"\"") + "\""
                val count = try { db.rawQuery("SELECT COUNT(*) FROM $q", null).use { if (it.moveToFirst()) it.getLong(0) else 0 } } catch (e: Exception) { -1 }
                sb.append("<h3 class=\"sheet\" id=\"t$i\">").append(X.esc(name)).append(" <small>(")
                    .append(if (type == "view") "visão" else "tabela").append(if (count >= 0) " · $count linhas" else "").append(")</small></h3>")
                sql?.let { sb.append("<details><summary>Estrutura</summary><pre><code>").append(X.esc(it)).append("</code></pre></details>") }
                try {
                    db.rawQuery("SELECT * FROM $q LIMIT $ROWS", null).use { c -> sb.append(grid(c)) }
                    if (count > ROWS) sb.append("<p><small>Exibindo as primeiras $ROWS linhas.</small></p>")
                } catch (e: Exception) {
                    sb.append("<p><i>").append(X.esc(e.message ?: "erro")).append("</i></p>")
                }
            }
            if (objects.isEmpty()) sb.append("<p><i>(nenhuma tabela)</i></p>")
            return sb.toString()
        }
    }

    private fun grid(c: Cursor): String {
        val sb = StringBuilder("<table class=\"grid\"><tr>")
        for (n in c.columnNames) sb.append("<th>").append(X.esc(n)).append("</th>")
        sb.append("</tr>")
        while (c.moveToNext()) {
            sb.append("<tr>")
            for (i in 0 until c.columnCount) {
                val v = when (c.getType(i)) {
                    Cursor.FIELD_TYPE_NULL -> "<i>NULL</i>"
                    Cursor.FIELD_TYPE_BLOB -> "<i>[BLOB ${c.getBlob(i)?.size ?: 0} bytes]</i>"
                    Cursor.FIELD_TYPE_INTEGER, Cursor.FIELD_TYPE_FLOAT -> X.esc(c.getString(i) ?: "")
                    else -> X.esc((c.getString(i) ?: "").take(500))
                }
                sb.append(if (c.getType(i) == Cursor.FIELD_TYPE_INTEGER || c.getType(i) == Cursor.FIELD_TYPE_FLOAT) "<td class=\"n\">" else "<td>").append(v).append("</td>")
            }
            sb.append("</tr>")
        }
        return sb.append("</table>").toString()
    }
}

/** Pacote Android (.apk): nome, ícone, versão, permissões e atalhos para instalar ou ver o conteúdo. */
object ApkInfo {
    @Suppress("DEPRECATION")
    fun toHtml(ctx: Context, file: File): String {
        val pm = ctx.packageManager
        val flags = PackageManager.GET_PERMISSIONS or PackageManager.GET_ACTIVITIES or PackageManager.GET_SERVICES or PackageManager.GET_RECEIVERS
        val info: PackageInfo? = try { pm.getPackageArchiveInfo(file.path, flags) } catch (e: Exception) { null }
        val sb = StringBuilder()
        if (info == null) {
            sb.append("<div class=\"note\">Não foi possível ler as informações deste pacote (pode ser um pacote dividido .apks/.xapk/.aab).</div>")
        } else {
            val ai = info.applicationInfo
            ai?.sourceDir = file.path
            ai?.publicSourceDir = file.path
            val label = ai?.let { runCatching { it.loadLabel(pm).toString() }.getOrNull() } ?: info.packageName
            val icon = ai?.let { runCatching { it.loadIcon(pm) }.getOrNull() }
            sb.append("<div class=\"card\"><div class=\"avatar\">")
            if (icon != null) {
                val bmp = Bitmap.createBitmap(144, 144, Bitmap.Config.ARGB_8888)
                icon.setBounds(0, 0, 144, 144); icon.draw(Canvas(bmp))
                val bo = ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.PNG, 100, bo)
                sb.append("<img src=\"data:image/png;base64,").append(Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP)).append("\">")
            } else sb.append("🤖")
            sb.append("</div><div><h2 style=\"margin:0\">").append(X.esc(label)).append("</h2><small>").append(X.esc(info.packageName)).append("</small></div></div>")
            sb.append("<table class=\"meta\">")
            fun row(k: String, v: String?) { if (!v.isNullOrBlank()) sb.append("<tr><th>").append(k).append("</th><td>").append(X.esc(v)).append("</td></tr>") }
            val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
            row("Versão", "${info.versionName ?: "?"} ($code)")
            if (Build.VERSION.SDK_INT >= 24) ai?.let { row("Android mínimo", "API ${it.minSdkVersion}") }
            ai?.let { row("Android alvo", "API ${it.targetSdkVersion}") }
            row("Tamanho", FileUtil.human(file.length()))
            row("Telas", info.activities?.size?.toString())
            row("Serviços", info.services?.size?.toString())
            val installed = try { pm.getPackageInfo(info.packageName, 0) } catch (e: Exception) { null }
            row("Instalado no aparelho", installed?.let { "sim (versão ${it.versionName})" } ?: "não")
            sb.append("</table>")
            val perms = info.requestedPermissions?.toList().orEmpty()
            if (perms.isNotEmpty()) {
                sb.append("<h3>Permissões (${perms.size})</h3><ul>")
                perms.sorted().forEach { sb.append("<li><code>").append(X.esc(it.removePrefix("android.permission."))).append("</code></li>") }
                sb.append("</ul>")
            }
        }
        sb.append("<p><a class=\"att\" href=\"${DocumentConverter.BASE}action/install\">⬇ Instalar este aplicativo</a> ")
            .append("<a class=\"att\" href=\"${DocumentConverter.BASE}action/browse\">🗂 Ver arquivos do pacote</a></p>")
        sb.append("<div class=\"note\">Instale apenas aplicativos de fontes confiáveis.</div>")
        return sb.toString()
    }
}
