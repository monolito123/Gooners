package br.com.gooners.pdf.convert

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader

/** Leitura de XML sem namespaces: compara pelo nome local (depois do prefixo). */
object X {
    fun parser(xml: String): XmlPullParser {
        val p = Xml.newPullParser()
        p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        // remove DOCTYPE com entidades externas (evita erro e ataques XXE)
        p.setInput(StringReader(xml.replace(Regex("<!DOCTYPE[^>\\[]*(\\[[^]]*])?>", RegexOption.IGNORE_CASE), "")))
        return p
    }

    fun XmlPullParser.local(): String = name?.substringAfter(':') ?: ""

    fun XmlPullParser.attr(local: String): String? {
        for (i in 0 until attributeCount) if (getAttributeName(i).substringAfter(':') == local) return getAttributeValue(i)
        return null
    }

    fun XmlPullParser.attrQ(qname: String): String? {
        for (i in 0 until attributeCount) if (getAttributeName(i) == qname) return getAttributeValue(i)
        return null
    }

    /** Percorre todos os eventos; [onStart]/[onEnd]/[onText] recebem o parser. */
    inline fun walk(xml: String, onStart: (XmlPullParser) -> Unit, onEnd: (XmlPullParser) -> Unit = {}, onText: (String) -> Unit = {}) {
        val p = parser(xml)
        var ev = p.eventType
        while (ev != XmlPullParser.END_DOCUMENT) {
            when (ev) {
                XmlPullParser.START_TAG -> onStart(p)
                XmlPullParser.END_TAG -> onEnd(p)
                XmlPullParser.TEXT, XmlPullParser.CDSECT, XmlPullParser.ENTITY_REF -> p.text?.let(onText)
            }
            ev = try { p.nextToken() } catch (e: Exception) { break }
        }
    }

    fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    /** Relacionamentos de um pacote OOXML: id -> caminho absoluto no ZIP. */
    fun rels(zip: ZipRes, part: String): Map<String, String> {
        val dir = part.substringBeforeLast('/', "")
        val relPath = (if (dir.isEmpty()) "" else "$dir/") + "_rels/" + part.substringAfterLast('/') + ".rels"
        val xml = zip.text(relPath) ?: return emptyMap()
        val out = HashMap<String, String>()
        walk(xml, { p ->
            if (p.local() == "Relationship") {
                val id = p.attr("Id") ?: return@walk
                val target = p.attr("Target") ?: return@walk
                out[id] = if (p.attr("TargetMode") == "External") target else ZipRes.resolve(part, target)
            }
        })
        return out
    }
}
