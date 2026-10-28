package br.com.gooners.pdf.convert

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class DocxRun(val text: String, val bold: Boolean = false, val italic: Boolean = false, val underline: Boolean = false,
              val sizePt: Float = 0f, val color: String? = null)

class DocxPara(val runs: List<DocxRun>, val heading: Int = 0, val align: String? = null,
               val bullet: Boolean = false, val pageBreakBefore: Boolean = false)

/** Gera um .docx mínimo e válido (Word, Google Docs, LibreOffice e WPS abrem). */
object DocxWriter {

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
        .filter { it == '\t' || it == '\n' || it >= ' ' }

    fun write(out: File, paras: List<DocxPara>, title: String = "") {
        val body = StringBuilder()
        for (p in paras) {
            body.append("<w:p><w:pPr>")
            if (p.heading in 1..3) body.append("<w:pStyle w:val=\"Heading${p.heading}\"/>")
            if (p.pageBreakBefore) body.append("<w:pageBreakBefore/>")
            if (p.bullet) body.append("<w:ind w:left=\"720\" w:hanging=\"360\"/>")
            p.align?.let { body.append("<w:jc w:val=\"$it\"/>") }
            body.append("</w:pPr>")
            val runs = if (p.bullet) listOf(DocxRun("•\t")) + p.runs else p.runs
            for (r in runs) {
                body.append("<w:r><w:rPr>")
                if (r.bold) body.append("<w:b/>")
                if (r.italic) body.append("<w:i/>")
                if (r.underline) body.append("<w:u w:val=\"single\"/>")
                r.color?.let { body.append("<w:color w:val=\"$it\"/>") }
                if (r.sizePt > 0) body.append("<w:sz w:val=\"${(r.sizePt * 2).toInt()}\"/>")
                body.append("</w:rPr>")
                r.text.split('\n').forEachIndexed { i, line ->
                    if (i > 0) body.append("<w:br/>")
                    line.split('\t').forEachIndexed { j, part ->
                        if (j > 0) body.append("<w:tab/>")
                        if (part.isNotEmpty()) body.append("<w:t xml:space=\"preserve\">").append(esc(part)).append("</w:t>")
                    }
                }
                body.append("</w:r>")
            }
            body.append("</w:p>")
        }
        val document = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>$body<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>"""
        val styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1F2937"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="1F2937"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>"""
        val contentTypes = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"""
        val rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"""
        val docRels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"""
        val core = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>Gooners PDF</dc:creator></cp:coreProperties>"""
        ZipOutputStream(out.outputStream().buffered()).use { z ->
            fun put(name: String, s: String) { z.putNextEntry(ZipEntry(name)); z.write(s.toByteArray(Charsets.UTF_8)); z.closeEntry() }
            put("[Content_Types].xml", contentTypes)
            put("_rels/.rels", rels)
            put("word/_rels/document.xml.rels", docRels)
            put("word/document.xml", document)
            put("word/styles.xml", styles)
            put("docProps/core.xml", core)
        }
    }
}
