# Gooners PDF — app Android

Leitor, editor, criador e conversor de documentos para Android 5.0+ (API 21 até 15). APK de ~4 MB, sem anúncios, funciona offline.

## Download

Cada push que altera `android/` roda o workflow **App Android (APK)**, que executa os testes, gera o APK e publica em
**Releases → `apk-latest`** (arquivo `GoonersPDF.apk`). O APK também fica como artefato da execução.

## O que o app faz

**Leitor de PDF**
- Renderização nativa (pdfium do Android), rolagem contínua, zoom por pinça e duplo toque com nitidez total (renderiza só a região visível).
- Busca com destaque (ignora acentos e maiúsculas), sumário/marcadores do PDF, marcadores próprios, ir para página, retoma a última página.
- Modos noturno, sépia e alto contraste; tela cheia; manter a tela ligada; ler em voz alta (TTS); copiar o texto da página; OCR da página.
- PDFs protegidos por senha e reparo automático de PDFs danificados. Imprimir pelo serviço de impressão do Android.

**Editor de PDF (recursos "Pro")**
- Editar texto existente (toque na linha → corrige e reescreve no lugar), adicionar texto, caneta, marca-texto, destacar, sublinhar, riscar.
- Retângulo, elipse, linha, seta, corretivo (branco), **tarja definitiva** (a página é achatada e o conteúdo some de verdade).
- Assinatura desenhada (fica salva para reutilizar), imagens, carimbos (APROVADO, PAGO, CONFIDENCIAL, data…).
- Selecionar, mover, redimensionar, duplicar e apagar anotações; desfazer/refazer.
- Preencher formulários (texto, caixa de seleção, listas) com opção de achatar.
- Organizar páginas: reordenar arrastando, girar, duplicar, excluir, extrair, inserir página em branco, outro PDF ou imagem.
- Tudo é gravado como conteúdo real do PDF (aparece em qualquer leitor). Salva no arquivo original ou em "Salvar como".

**Ferramentas**: mesclar, dividir (intervalos, a cada N, uma por página), extrair/excluir páginas, comprimir (4 níveis), tons de cinza,
proteger com senha AES-256 e permissões, remover senha, marca d'água, numerar páginas, cabeçalho/rodapé, girar, metadados, achatar formulário.

**Conversão**: PDF → Word (.docx), imagens (JPG/PNG, até 300 ppp), texto, HTML; extrair imagens; OCR (PDF pesquisável e imagem → texto);
qualquer documento suportado → PDF; imagens/fotos → PDF; digitalizador com detecção de bordas (ML Kit; câmera comum como alternativa).

**Criação**: editor de documentos (negrito, itálico, sublinhado, tachado, títulos, listas, alinhamento, rascunho automático) que exporta
PDF, DOCX, HTML, Markdown e TXT; PDF em branco liso, pautado, quadriculado ou pontilhado.

**Outros formatos que o app lê**: DOCX, DOC*, ODT, RTF, XLSX, XLS*, ODS, CSV/TSV, PPTX, PPT*, ODP, EPUB (com sumário e capítulos),
FB2, CBZ (quadrinhos), Markdown, HTML, SVG, TXT/LOG/JSON/XML e código-fonte (com busca, números de linha, formatar JSON),
imagens (JPG, PNG, WebP, GIF animado, BMP, HEIC/AVIF conforme o Android) e ZIP (abre os arquivos de dentro).
\* formatos binários 97-2003: só o texto.

Também aparece em "Abrir com" e "Compartilhar" de outros apps e pode listar todos os documentos do aparelho (permissão opcional).

## Compilar

```bash
cd android
./gradlew assembleRelease        # APK em app/build/outputs/apk/release/
./gradlew testDebugUnitTest      # testes (Robolectric) de conversores, ferramentas de PDF e telas
```

Requer JDK 17 e Android SDK 35. Sem as variáveis `GPDF_KEYSTORE*`, o release é assinado com a chave de debug (instalável, mas
cada máquina gera uma assinatura diferente). Para assinatura fixa no CI, crie os secrets `GPDF_KEYSTORE_BASE64`
(`base64 -w0 sua-chave.jks`), `GPDF_KEYSTORE_PASSWORD`, `GPDF_KEY_ALIAS` e `GPDF_KEY_PASSWORD`.

## Arquitetura

| Pacote | Conteúdo |
|---|---|
| `viewer/` | `PdfViewerActivity` (leitor/editor), `PdfCore` (PdfRenderer), `PageView` (página + anotações), `ZoomLayout`, `PdfText` (texto com posições) |
| `edit/` | Modelo de anotações, `PdfSaver` (grava no PDF via PdfBox), assinatura, formulários, geometria de páginas giradas |
| `tools/` | `PdfTools` (todas as operações), `ToolActivity` (tela genérica de ferramentas), digitalizador |
| `convert/` | Leitores DOCX/XLSX/PPTX/ODF/EPUB/RTF/FB2/Markdown/CSV → HTML, `HtmlPdfWriter` (PDF vetorial), `DocxWriter` |
| `reader/` | Leitores de documentos (WebView offline), texto/código, imagens/CBZ e ZIP |
| `create/` | Editor de documentos |
| `organize/` | Organizar páginas |
| `ui/`, `util/` | Tela inicial, recentes/favoritos, roteamento por formato, diálogos |

Bibliotecas: AndroidX, Material Components, PdfBox-Android (Apache 2.0) e ML Kit via Google Play Services (OCR e digitalizador;
os modelos são baixados pelo sistema, então não pesam no APK). Sem bibliotecas nativas próprias: um único APK serve para todos os processadores.
