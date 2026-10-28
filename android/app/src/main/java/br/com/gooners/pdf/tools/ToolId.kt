package br.com.gooners.pdf.tools

import br.com.gooners.pdf.R

enum class Input { NONE, PDF, PDFS, IMAGES, DOCUMENT, IMAGE_OR_PDF }

enum class ToolId(val title: String, val desc: String, val icon: Int, val input: Input, val group: String) {
    // Criar
    NEW_DOC("Novo documento", "Escreva e exporte em PDF, Word, HTML ou texto", R.drawable.ic_page_add, Input.NONE, "Criar"),
    BLANK_PDF("PDF em branco", "Folhas lisas, pautadas, quadriculadas ou pontilhadas", R.drawable.ic_pdf, Input.NONE, "Criar"),
    SCAN("Digitalizar", "Use a câmera para criar um PDF de documentos", R.drawable.ic_camera, Input.NONE, "Criar"),
    IMAGES_TO_PDF("Imagens para PDF", "Junte fotos e imagens num só PDF", R.drawable.ic_image, Input.IMAGES, "Criar"),

    // Editar
    EDIT("Editar PDF", "Texto, desenho, destaque, formas, imagens e corretivo", R.drawable.ic_edit, Input.PDF, "Editar"),
    SIGN("Assinar PDF", "Desenhe sua assinatura e posicione no documento", R.drawable.ic_sign, Input.PDF, "Editar"),
    FILL_FORM("Preencher formulário", "Campos de texto, caixas de seleção e listas", R.drawable.ic_form, Input.PDF, "Editar"),
    ORGANIZE("Organizar páginas", "Reordenar, girar, excluir, duplicar e inserir", R.drawable.ic_grid, Input.PDF, "Editar"),
    WATERMARK("Marca d'água", "Texto translúcido em todas as páginas", R.drawable.ic_drop, Input.PDF, "Editar"),
    PAGE_NUMBERS("Numerar páginas", "Numeração com posição e formato à sua escolha", R.drawable.ic_numbers, Input.PDF, "Editar"),
    HEADER_FOOTER("Cabeçalho e rodapé", "Textos com número da página e data", R.drawable.ic_text, Input.PDF, "Editar"),
    ROTATE("Girar páginas", "Gire todas ou só algumas páginas", R.drawable.ic_rotate, Input.PDF, "Editar"),
    METADATA("Propriedades do PDF", "Título, autor, assunto e palavras-chave", R.drawable.ic_info, Input.PDF, "Editar"),
    FLATTEN("Achatar formulário", "Fixa os campos preenchidos no documento", R.drawable.ic_form, Input.PDF, "Editar"),

    // Organizar
    MERGE("Mesclar PDFs", "Junte vários PDFs na ordem que quiser", R.drawable.ic_merge, Input.PDFS, "Organizar"),
    SPLIT("Dividir PDF", "Separe por intervalos ou a cada N páginas", R.drawable.ic_split, Input.PDF, "Organizar"),
    EXTRACT_PAGES("Extrair páginas", "Crie um PDF só com as páginas escolhidas", R.drawable.ic_copy, Input.PDF, "Organizar"),
    DELETE_PAGES("Excluir páginas", "Remova páginas pelo número", R.drawable.ic_delete, Input.PDF, "Organizar"),
    COMPRESS("Comprimir PDF", "Reduza o tamanho mantendo a qualidade", R.drawable.ic_compress, Input.PDF, "Organizar"),
    GRAYSCALE("PDF em tons de cinza", "Converta para preto e branco (ideal para imprimir)", R.drawable.ic_night, Input.PDF, "Organizar"),

    // Converter
    TO_DOCX("PDF para Word", "Texto e parágrafos em .docx editável", R.drawable.ic_doc, Input.PDF, "Converter"),
    TO_IMAGES("PDF para imagens", "Cada página vira JPG ou PNG", R.drawable.ic_image, Input.PDF, "Converter"),
    TO_TEXT("PDF para texto", "Extraia todo o texto em .txt", R.drawable.ic_text, Input.PDF, "Converter"),
    TO_HTML("PDF para HTML", "Página web com o texto do PDF", R.drawable.ic_code, Input.PDF, "Converter"),
    DOC_TO_PDF("Documento para PDF", "Word, Excel, PowerPoint, ODF, EPUB, RTF, Markdown, HTML, TXT, CSV", R.drawable.ic_convert, Input.DOCUMENT, "Converter"),
    EXTRACT_IMAGES("Extrair imagens", "Salve as imagens contidas no PDF", R.drawable.ic_image, Input.PDF, "Converter"),
    OCR_PDF("OCR: PDF pesquisável", "Reconhece o texto de PDFs digitalizados", R.drawable.ic_scan, Input.PDF, "Converter"),
    OCR_IMAGE("OCR: imagem para texto", "Extraia o texto de fotos e prints", R.drawable.ic_scan, Input.IMAGES, "Converter"),

    // Segurança
    PROTECT("Proteger com senha", "Criptografia AES-256 e permissões", R.drawable.ic_lock, Input.PDF, "Segurança"),
    UNLOCK("Remover senha", "Gere uma cópia sem senha (você precisa saber a senha)", R.drawable.ic_unlock, Input.PDF, "Segurança"),
    REDACT("Tarjar informações", "Oculte dados sensíveis de forma definitiva", R.drawable.ic_redact, Input.PDF, "Segurança");
}
