# Gooners PDF — app Android

Leitor, editor, player e conversor para quase todo tipo de arquivo, para Android 5.0+ (API 21 até 15).
APK universal de ~8,5 MB (ou ~6,5 MB na versão só para celulares arm64), sem anúncios, funciona offline.

## Download

Cada push que altera `android/` roda o workflow **App Android (APK)**, que executa os testes, gera os APKs e publica em
**Releases → `apk-latest`**:

| Arquivo | Para quem |
|---|---|
| `GoonersPDF.apk` | qualquer aparelho (universal) |
| `GoonersPDF-arm64.apk` | a maioria dos celulares atuais (menor) |
| `GoonersPDF-armv7.apk` | celulares de 32 bits mais antigos |

## Abrir e reproduzir

| Tipo | Formatos |
|---|---|
| PDF | leitura e edição completas (protegido por senha, formulários, reparo de arquivos danificados) |
| Documentos | DOCX, DOC, ODT, RTF, Markdown, HTML, TXT, XPS, iWork (pré-visualização), Jupyter `.ipynb` |
| Planilhas | XLSX, XLS, ODS, CSV/TSV, bancos SQLite |
| Apresentações | PPTX, PPT, ODP/ODG |
| E-books e quadrinhos | EPUB, MOBI, AZW, AZW3, PRC, FB2 · CBZ, CBR, CB7, CBT |
| E-mail e agenda | EML, MSG (Outlook), MBOX, MHT · contatos VCF · agenda ICS |
| Imagens | JPG, PNG, WebP, GIF animado, BMP, HEIC/AVIF*, SVG, TIFF multipágina (inclusive fax G3/G4), PSD, TGA, PBM/PGM/PPM, RAW de câmeras (CR2, NEF, ARW, DNG…), EPS |
| Vídeo | MP4, MKV, WebM, AVI, MOV, 3GP, TS/M2TS, FLV, MPEG, OGV* |
| Áudio | MP3, AAC/M4A, FLAC, OGG, Opus, WAV, AIFF, AMR, MIDI, AC3/E-AC3, TrueHD, ALAC* |
| Transmissões | listas M3U/M3U8 (IPTV), PLS, XSPF; HLS, DASH, RTSP, rádios e vídeos da web |
| Compactados | ZIP, 7z, RAR (até v4), TAR, GZ, BZ2, XZ, LZMA, Z, DEB/AR, CPIO, ARJ |
| Outros | código-fonte com realce de sintaxe, fontes TTF/OTF/WOFF, APK (informações e instalação), torrent (com link magnet) |

\* dependem dos decodificadores do aparelho e da versão do Android. O áudio AC3/E-AC3/TrueHD e similares usa o FFmpeg embutido.

O app aparece em "Abrir com" e "Compartilhar" para **qualquer** arquivo e também abre links compartilhados de navegadores.

## Player de vídeo e música

- Reprodução em segundo plano com controles na notificação, na tela de bloqueio e em fones Bluetooth.
- Gestos: deslizar à esquerda/direita da tela para brilho/volume, horizontal para avançar, toque duplo para ±10 s.
- Velocidade (0,25× a 3×), faixas de áudio e legendas embutidas, legendas externas (SRT, VTT, ASS), ajuste da imagem,
  janela flutuante (PiP), bloqueio de toques, giro automático, timer para desligar, equalizador, fila e repetição/aleatório.
- Continua de onde parou em vídeos e áudios longos.
- Se o player principal não reconhecer um arquivo, ele pode ser aberto no reprodutor do próprio Android.

## Editar e criar

- **PDF**: editar linhas de texto existentes, texto, caneta, marca-texto, formas, assinatura, imagens, carimbos, corretivo,
  tarja definitiva, formulários, organizar páginas; seleção de texto com toque longo (copiar, destacar, sublinhar, riscar, ouvir, pesquisar);
  miniaturas das páginas.
- **Documentos**: editor com negrito, itálico, sublinhado, cores, marca-texto, tamanhos, títulos, listas, alinhamento, imagens e
  localizar/substituir; salva de volta em DOCX, HTML, Markdown ou TXT, ou exporta para PDF.
- **Planilhas**: edita células, insere/exclui linhas e colunas, ordena, várias planilhas; salva em XLSX ou CSV.
- **Texto e código**: localizar/substituir, desfazer/refazer, realce de sintaxe, quebra de linha, salvar no arquivo original.
- **Imagens**: recortar (com proporções), girar, espelhar, redimensionar, filtro de documento preto e branco, brilho/contraste/saturação.
- Ferramentas de PDF (mesclar, dividir, comprimir, senha, marca d'água, numeração, OCR, conversões…), digitalizador, imagens → PDF,
  compactar em ZIP e extrair qualquer formato compactado (mantendo as pastas).

## Biblioteca e links

- Biblioteca do aparelho com abas de documentos, vídeos, músicas (com capas), imagens e compactados (permissões opcionais).
- "Abrir link": transmissões vão para o player; documentos são baixados e abertos no leitor certo.

## Compilar

```bash
cd android
./gradlew assembleRelease        # APKs em app/build/outputs/apk/release/ (universal e por processador)
./gradlew testDebugUnitTest      # 43 testes (Robolectric): formatos, ferramentas de PDF, compactados, imagens, playlists e telas
```

Requer JDK 17 e Android SDK 35. Sem as variáveis `GPDF_KEYSTORE*`, o release local é assinado com a chave de debug; no CI, com uma
chave gerada e guardada em cache. Para uma assinatura própria fixa, crie os secrets `GPDF_KEYSTORE_BASE64` (`base64 -w0 sua-chave.jks`),
`GPDF_KEYSTORE_PASSWORD`, `GPDF_KEY_ALIAS` e `GPDF_KEY_PASSWORD`.

## Arquitetura

| Pacote | Conteúdo |
|---|---|
| `viewer/` | Leitor/editor de PDF (`PdfViewerActivity`), renderização nativa, seleção de texto, zoom |
| `edit/` | Anotações, gravação no PDF (PdfBox), assinatura, formulários |
| `player/` | `PlaybackService` (ExoPlayer + sessão de mídia), `PlayerActivity`, listas de reprodução, player do sistema |
| `archive/` | Leitura de ZIP, 7z, RAR, TAR e demais formatos compactados |
| `image/` | Decodificadores (TIFF, PSD, TGA, Netpbm, RAW, EPS) e editor de imagens |
| `convert/` | Conversores para HTML (Office, OLE2/CFB para formatos 97-2003, Outlook, MIME, MOBI, XPS, EPUB…), gravadores DOCX/XLSX/PDF |
| `reader/` | Leitores de documentos, texto/código, imagens/quadrinhos e compactados |
| `create/` | Editores de documento, planilha e texto/código; realce de sintaxe |
| `tools/` | Ferramentas de PDF e a tela genérica de ferramentas |
| `ui/`, `util/` | Tela inicial, biblioteca, abrir link, roteamento por formato, recentes |

Bibliotecas: AndroidX, Material Components, Media3/ExoPlayer, decodificador FFmpeg do Jellyfin (áudio), PdfBox-Android,
Apache Commons Compress + XZ for Java, junrar e ML Kit via Google Play Services (OCR e digitalizador; modelos baixados pelo sistema).

## Limitações conhecidas

- RAR 5, DjVu, CAB e CHM ainda não abrem (há atalho para "abrir com outro app").
- Vídeo com codecs que o aparelho não decodifica em hardware (ex.: alguns WMV/RMVB/DivX antigos) depende do player do sistema.
- O editor de documentos regrava DOCX com formatação simplificada (por isso oferece salvar uma cópia); planilhas salvas perdem
  fórmulas e formatação, mantendo valores e textos.
- Arquivos 7z exigem Android 7 ou mais recente.
