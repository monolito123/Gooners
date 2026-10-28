# Gooners

Este repositório tem dois sites estáticos, sem etapa de build:

| Caminho | O que é |
|---|---|
| `/` | **Gooners**: hub com 45 ferramentas online (texto, geradores, validadores, conversores, calculadoras, ferramentas de desenvolvedor e de tempo). Tudo roda no navegador. |
| `/law/` | **Gooners Law**: site de assistência jurídica em proteção patrimonial e assessoria offshore, com simuladores e um portal de notícias jurídicas atualizado em tempo real. |

## Rodar localmente

```bash
python3 -m http.server 8000
# abra http://localhost:8000 e http://localhost:8000/law/
```

## Gooners: ferramentas

- **Texto:** inverter texto, contador de caracteres, maiúsculas/minúsculas, letras diferentes (Unicode), remover acentos, slug, ordenar/limpar linhas, remover espaços, localizar e substituir, comparar textos (diff), Lorem Ipsum, número por extenso.
- **Geradores:** senha forte, CPF, CNPJ (inclusive alfanumérico), UUID v4/v7, sorteador de números, sorteador de nomes e times, cara ou coroa e dados, QR Code.
- **Validadores:** CPF/CNPJ em lote, cartão (Luhn + bandeira), e-mails, testador de regex.
- **Conversores:** Base64, URL, texto ↔ binário/hex, bases numéricas, unidades, cores, Morse (com áudio), timestamp Unix.
- **Calculadoras:** porcentagem, idade, diferença entre datas e prazos (dias úteis), regra de três, juros compostos, IMC.
- **Dev:** JSON, hash (MD5/SHA), JWT, escapar HTML. **Tempo:** cronômetro, timer/Pomodoro, relógio mundial.

O hub também tem busca instantânea, filtro por categoria, favoritos, ferramentas recentes, paleta de comandos (`Ctrl+K`), tema claro/escuro e links compartilháveis (`#/ferramenta/<id>`).

Para criar uma ferramenta, adicione um bloco `add({ id, name, cat, icon, desc, keys, render(root) { … } })` em `assets/js/tools.js`.

## Gooners Law

- Áreas de atuação, metodologia, comparador de jurisdições offshore, FAQ e formulário de contato (por e-mail ou WhatsApp).
- Três simuladores: **diagnóstico patrimonial**, **custo de inventário × holding** e **tributação offshore (Lei 14.754/2023)**.
- **Notícias em tempo real:** faixa de manchetes ao vivo, abas por tema, busca, selo “NOVO”, atualização automática a cada 3 minutos, alertas no navegador e cache local.

### Configuração

Edite `law/assets/config.js` com o e-mail e o WhatsApp reais do escritório (o e-mail atual é provisório). Também vale incluir o registro na OAB no rodapé de `law/index.html`.

### Como as notícias são atualizadas

1. **No servidor:** o workflow `.github/workflows/pages.yml` roda `scripts/fetch-news.mjs` a cada 15 minutos. O script lê as fontes de `law/data/feeds.json` (buscas temáticas no Google Notícias, Migalhas, Conjur, JOTA e STF), gera `law/data/news.json` e publica o site no GitHub Pages.
2. **No navegador:** a página lê `news.json` e também tenta ler os feeds diretamente, por proxies CORS públicos, para captar o que saiu entre duas coletas. Se os proxies falharem, o site continua funcionando com os dados do servidor.

Para ativar, vá em **Settings → Pages → Source: GitHub Actions** e faça merge na branch `main`. Para incluir ou remover fontes, edite `law/data/feeds.json`.

> O conteúdo do site é informativo e não constitui aconselhamento jurídico. Revise os textos com o responsável técnico do escritório para garantir a conformidade com o Provimento CFOAB nº 205/2021.
