# Gooners

Dois sites estáticos, indexáveis por buscadores e prontos para o GitHub Pages:

| Caminho | O que é |
|---|---|
| `/` | **Gooners**: 62 ferramentas online gratuitas em 8 categorias (texto, geradores, validadores, consultas, conversores, calculadoras, desenvolvedor, tempo e produtividade). Cada ferramenta tem sua própria página. |
| `/law/` | **Gooners Law**: assistência jurídica em proteção patrimonial e assessoria offshore, com simuladores, portal de notícias jurídicas em tempo real, glossário e artigos. |
| `/messenger/` | **SMA**: arquitetura, especificação do protocolo e implementação de referência (TypeScript, testada) de um mensageiro sem servidores com criptografia pós-quântica (X-Wing/ML-KEM-768, ML-DSA-65). Não é publicado no site; veja [`messenger/README.md`](messenger/README.md). |
| `/payments/` | **InfinityPay+** (nome provisório): especificação de arquitetura e engenharia (REA/PRD) de uma plataforma de credenciamento Visa/Mastercard e BaaS, com ledger multi-nuvem, recibos e extratos assinados via Nostr, terminais Android (MPoC) e iOS, design system e uma verificação automática de tudo o que é calculável. Inclui uma implementação de referência em Go (`payments/platform`: switch ISO 8583, ledger, Pix via API Pix do BCB, recibos Nostr, API, simuladores) e um guia de integração com subcredenciadora, Visa, Mastercard e bancos para Pix (`payments/integration`). Não é publicado no site; veja [`payments/README.md`](payments/README.md). |

## Rodar localmente

```bash
python3 -m http.server 8000
# http://localhost:8000  e  http://localhost:8000/law/
```

## Estrutura

```
assets/js/tools.js        catálogo e lógica de todas as ferramentas
assets/js/app.js          busca, favoritos, recentes, paleta (Ctrl+K), atalhos, PWA
assets/css/gooners.css    design system do hub (tema claro/escuro)
assets/icons.svg          sprite de ícones (Lucide, licença ISC)
law/assets/               estilos e scripts da Gooners Law (config.js é gerado)
law/data/feeds.json       fontes do portal de notícias
law/data/news.json        notícias coletadas no servidor
scripts/build.mjs         gera home, categorias, páginas de ferramentas, sitemap, robots e manifest
scripts/build-law.mjs     gera as páginas da Gooners Law
scripts/fetch-news.mjs    coleta as notícias (sem dependências)
scripts/seo-content.mjs   textos de SEO das ferramentas (títulos, passo a passo, FAQ)
scripts/law-content.mjs   conteúdo da Gooners Law (áreas, jurisdições, FAQ, glossário, artigos)
```

As páginas HTML são **geradas**: edite os scripts ou o conteúdo e rode:

```bash
node scripts/fetch-news.mjs   # opcional: atualiza as notícias
node scripts/build-law.mjs
node scripts/build.mjs        # por último (o sitemap inclui as páginas da Gooners Law)
```

## SEO

- Página estática e indexável para cada ferramenta (`/ferramentas/<id>/`) e categoria (`/categorias/<id>/`), com título, descrição, canonical, Open Graph e Twitter Card próprios.
- Dados estruturados (JSON-LD): `WebSite` com `SearchAction`, `Organization`, `WebApplication`, `BreadcrumbList`, `FAQPage`, `CollectionPage`/`ItemList`, `LegalService`, `Article` e `DefinedTermSet`.
- Conteúdo editorial em cada ferramenta (passo a passo e perguntas frequentes) e links internos no rodapé.
- `sitemap.xml`, `robots.txt`, imagens de compartilhamento (1200×630) e manchetes pré-renderizadas no HTML do portal de notícias.
- A URL canônica vem de `scripts/site.config.json` (`siteUrl`). Se usar domínio próprio, altere ali, ou defina `SITE_URL`, e gere de novo.

## Gooners: recursos

- Novas ferramentas: QR Code Pix (BR Code), consulta CEP (ViaCEP) e CNPJ (BrasilAPI), conversor de moedas, feriados nacionais, link do WhatsApp, pessoas fictícias para testes, conversor e compressor de imagens, CSV ↔ JSON, números romanos, financiamento Price/SAC, calculadora de horas, estatística, editor Markdown, gerador de meta tags SEO, leitura em voz alta e bloco de notas. A diferença entre datas agora desconta feriados.
- Menu lateral com categorias e recentes, busca instantânea (também por `?q=`), favoritos, modo foco, compartilhamento, atalhos de teclado (`?`) e tema claro/escuro.
- PWA instalável com funcionamento offline (`sw.js` e `manifest.webmanifest`).

## Gooners Law: recursos

- Comparador de jurisdições com filtro por objetivo e comparação lado a lado.
- Simuladores: diagnóstico patrimonial, inventário × holding, tributação offshore (Lei 14.754/2023) e checklist de documentos da holding (salvo no navegador e imprimível).
- Agendamento: escolha do dia útil, horário e formato, com envio por e-mail ou WhatsApp e arquivo `.ics` para a agenda.
- Portal de notícias (`/law/noticias/`): busca, temas, filtro por período e fonte, grade ou lista, “ler depois”, marcação de lidas, compartilhamento, alertas no navegador e atualização automática.
- Glossário com 37 termos e 3 artigos (Lei 14.754/2023, holding familiar e proteção patrimonial lícita).

### Contato

Todos os contatos dos dois sites (formulários, botões de WhatsApp, rodapés, dados estruturados) vêm de `scripts/site.config.json`, em `contact`: e-mail **felipe@gooners.com.br** e WhatsApp **(61) 99403-2833**. Para trocar, edite esse arquivo e gere as páginas de novo; `law/assets/config.js` é gerado a partir dele. Falta incluir o registro na OAB no rodapé, em `scripts/build-law.mjs`.

### Publicação e notícias em tempo real

O site está no ar em https://monolito123.github.io/Gooners/ e é servido pelo GitHub Pages a partir do branch `gh-pages`, que contém só o site gerado.

O workflow `.github/workflows/pages.yml` roda a cada push e a cada 15 minutos. Ele coleta as notícias, mesclando com a coleta anterior para que uma fonte instável não esvazie um tema, gera as páginas e substitui o conteúdo do `gh-pages`. No navegador, o portal mostra primeiro esses dados e depois os complementa lendo os feeds diretamente.

> O conteúdo é informativo e não constitui aconselhamento jurídico. Revise textos e números com o responsável técnico do escritório antes de publicar (Provimento CFOAB nº 205/2021).
