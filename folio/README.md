# Fólio Judiciário

Mesa de trabalho do analista judiciário: um conversor de PDF para Markdown e ferramentas de apoio ao trabalho em gabinetes e secretarias do TJDFT. Site estático, sem build e sem servidor: os arquivos são processados no navegador e não são enviados a lugar nenhum.

Projeto independente, sem vínculo oficial com o TJDFT. Prazos e cálculos são auxiliares; confira-os nos sistemas oficiais, na legislação e na portaria de feriados do ano.

Publicado em `/folio/` junto com o restante do site (veja o README da raiz). Para rodar localmente:

```bash
python3 -m http.server 8000
# http://localhost:8000/folio/
```

## Ferramentas

| Grupo | Ferramenta | O que faz |
|---|---|---|
| Converter | **PDF para Markdown** | Títulos, parágrafos (inclusive os que continuam na página seguinte), negrito e itálico, citações recuadas (`>`), listas, tabelas (juntadas quando quebram de página) e duas colunas. Remove cabeçalhos e rodapés repetidos e os carimbos de assinatura do PJe, SEI e e-SAJ, guardando em Detalhes os IDs dos documentos do PJe, quem assinou e quando. Marca as páginas (`<!-- página 3 · ID 123456789, p. 2 -->`), separa os documentos de autos completos pelo ID, aceita vários arquivos (download em .zip), intervalo de páginas, cabeçalho YAML e OCR em português para páginas digitalizadas. |
| | Word para Markdown | `.docx` → Markdown (Mammoth + Turndown), com o estilo "Citação" do Word virando `>`. |
| | Texto formatado para Markdown | Cole do Word, do editor do PJe ou de um site; também abre `.html`. |
| | Markdown para Word | Gera `.docx` próprio (fonte, entrelinha, recuo da 1ª linha, margens ABNT, numeração de páginas, citação recuada de 4 cm) ou copia o texto formatado para colar no PJe. |
| | Limpar texto de PDF | Junta linhas quebradas, desfaz hifenização, remove carimbos e números de página, corrige ligaduras. |
| PDF | Juntar PDFs | Une arquivos na ordem escolhida. |
| | Dividir e extrair páginas | Extrair, separar em vários arquivos (.zip), girar e excluir páginas, com miniaturas clicáveis. |
| | Imagens para PDF | JPG/PNG/WebP em A4, com redução para 150 dpi e tons de cinza. |
| Prazos e cálculos | **Prazos processuais** | Dias úteis (CPC, art. 219; Juizados, Lei 9.099/1995, art. 12-A) ou corridos (CPP, art. 798, com a Súmula 310 do STF). Marcos: disponibilização no DJe, ciência no PJe, intimação tácita (10 dias), citação eletrônica (art. 231, IX), juntada e outros. Prazo em dobro, recesso (20/12 a 06/01), suspensão de 20/12 a 20/01 (CPC, art. 220; CPP, art. 798-A, com as exceções), feriados nacionais e do DF editáveis, dias de expediente reduzido ou indisponibilidade (art. 224, § 1º), calendário, dia a dia e texto de certidão. |
| | Dosimetria e prescrição | Frações das três fases em anos/meses/dias (2ª fase sobre a pena-base, limitada pela Súmula 231; 3ª em cascata), regime inicial, substituição, sursis, detração e prescrição (arts. 109, 110 e 115 do CP) com a data final. |
| | Valor por extenso | Reais, números (masculino e feminino), percentuais e datas (inclusive "aos sete dias do mês…"), e inserção automática do extenso em todos os valores de uma minuta. |
| Texto e dados | Número CNJ | Valida, decompõe e calcula o dígito verificador (Resolução CNJ 65/2008); limpa listas inteiras e exporta .csv. |
| | Extrair dados do texto | Processos, IDs do PJe, dispositivos legais, leis e súmulas, valores (com soma), datas, CPF/CNPJ válidos, OAB, e-mails, telefones e CEPs. |
| | Anonimizar (LGPD) | Nomes por iniciais ou etiquetas (com sugestões tiradas do texto), CPF, RG, contatos, contas, placas, nascimento e endereços, com relatório das trocas. |
| | Comparar versões | Diferenças por palavra ou letra entre duas minutas. |
| | Ementa padronizada | Estrutura da Recomendação CNJ 154/2024 (caso em exame, questão em discussão, razões de decidir, dispositivo e tese), com numeração contínua, cópia formatada e .docx. |

## Estrutura

```
folio/index.html            página (carrega os scripts abaixo; rotas por #id-da-ferramenta)
folio/assets/folio.css      estilos (tema claro e escuro)
folio/assets/core.js        registro de ferramentas, rotas, cópia, download e carregamento das bibliotecas
folio/assets/pdf2md.js      motor PDF → Markdown (independente da interface)
folio/assets/conversores.js PDF/Word/HTML ↔ Markdown, gerador de .docx e limpeza de texto
folio/assets/pdf-tools.js   juntar, dividir/extrair/girar/excluir e imagens para PDF
folio/assets/calculos.js    prazos, dosimetria e prescrição, extenso
folio/assets/texto.js       número CNJ, extração, anonimização, comparação e ementa
folio/assets/exemplo.pdf    sentença fictícia carregada como exemplo
```

As bibliotecas são carregadas só quando a ferramenta precisa delas, em versões fixas: pdf.js 3.11.174, pdf-lib 1.17.1, Mammoth 1.8.0, Turndown 7.1.2 (+ GFM 1.0.2), marked 12.0.2, DOMPurify 3.1.6, JSZip 3.10.1, diff-match-patch e Tesseract.js 5.1.1 (OCR, com o modelo `por`).

## Calendário de prazos

O calendário-padrão traz os feriados nacionais, os do DF (Fundação de Brasília, Dia do Evangélico) e os dias sem expediente forense da Lei 5.010/1966, art. 62 (Semana Santa, Carnaval, 11/8, 1º/11, 8/12 e recesso). Corpus Christi, Quarta-feira de Cinzas (expediente reduzido) e o Dia do Servidor (28/10, que costuma ser transferido) vêm marcados, mas variam: desmarque o que não se aplica e acrescente os pontos facultativos e as indisponibilidades do PJe da portaria do ano. As escolhas ficam salvas no navegador.
