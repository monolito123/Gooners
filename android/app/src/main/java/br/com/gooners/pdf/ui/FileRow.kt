package br.com.gooners.pdf.ui

import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import br.com.gooners.pdf.R
import br.com.gooners.pdf.util.DocKind

/** Linha de lista de arquivos reutilizada em várias telas. */
class FileRow(parent: ViewGroup) : RecyclerView.ViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_file, parent, false)) {
    val icon: ImageView = itemView.findViewById(R.id.icon)
    val title: TextView = itemView.findViewById(R.id.title)
    val subtitle: TextView = itemView.findViewById(R.id.subtitle)
    val star: View = itemView.findViewById(R.id.star)

    fun bind(name: String, sub: String, kind: DocKind, fav: Boolean = false) {
        title.text = name
        subtitle.text = sub
        icon.setImageResource(kind.icon)
        icon.imageTintList = ColorStateList.valueOf(ContextCompat.getColor(itemView.context, kind.color))
        star.visibility = if (fav) View.VISIBLE else View.GONE
    }
}
