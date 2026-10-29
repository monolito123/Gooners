# SMA: app (web/PWA e Android)

Mensageiro com criptografia pós-quântica de ponta a ponta, sem servidor próprio. A mesma interface roda no navegador (PWA instalável) e como APK Android (Capacitor).

- **Criptografia:** X-Wing (ML-KEM-768 + X25519), assinaturas Ed25519 + ML-DSA-65, AES-256-GCM, ratchet híbrido. Tudo vem de [`../reference`](../reference).
- **Transporte:** relays Nostr públicos (padrão: `relay.damus.io`, `nos.lol`, `relay.primal.net`). Eles guardam só blocos opacos de 4 KiB, 8 KiB, 16 KiB…, com uma etiqueta que muda a cada hora e uma chave descartável por evento.
- **Cofre local:** IndexedDB cifrado com XChaCha20-Poly1305. A chave do cofre é protegida pela sua senha via Argon2id (64 MiB).

> Software experimental, **não auditado**. Não use para nada em que sua segurança dependa disso.

## Instalar

| Plataforma | Como |
|---|---|
| Android (APK) | Baixe o `app-debug.apk` gerado pelo workflow **SMA messenger** (aba *Actions* → execução mais recente → *Artifacts*). No aparelho, permita "instalar apps desconhecidos" para o navegador ou gerenciador de arquivos e abra o APK. |
| Navegador / PWA | Depois do merge no `main`, o app fica em `https://monolito123.github.io/Gooners/messenger/`. No Android ou iOS, use "Adicionar à tela inicial". |

## Usar

1. **Criar conta:** escolha um nome, anote as 24 palavras da frase de recuperação (é a sua conta) e defina uma senha para este aparelho.
2. **Convidar:** em *Convidar*, mostre o QR ou envie o link. O convite carrega só a impressão digital da sua identidade e uma chave para buscar seu cartão cifrado nos relays.
3. **Adicionar:** em *Adicionar*, cole o link ou escaneie o QR (onde o navegador suporta `BarcodeDetector`).
4. **Verificar:** abra o contato e compare o **número de segurança** com o do outro aparelho. Se for igual, marque como verificado.

## Desenvolver

```bash
cd messenger/reference && npm ci          # biblioteca de criptografia
cd ../app && npm ci
npm run build                             # gera dist/
npm run serve                             # http://localhost:8080
npm run relay                             # relay Nostr local em ws://localhost:7777 (para testes)
npm run test:e2e                          # dois navegadores conversando via relay local (precisa do Playwright)
```

Para usar o relay local, abra *Configurações* e troque os relays por `ws://localhost:7777`.

### APK

Requisitos: JDK 21 e Android SDK (platform 36, build-tools 36). Defina `ANDROID_HOME`.

```bash
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

O APK de debug é assinado com a chave de debug do Android: serve para instalar e testar, não para a Play Store. Para um APK de release assinado, crie um keystore (fora do repositório) e configure no GitHub os secrets `SMA_KEYSTORE_BASE64`, `SMA_KEYSTORE_PASSWORD`, `SMA_KEY_ALIAS` e `SMA_KEY_PASSWORD`. O workflow gera então `app-release.apk`.

```bash
keytool -genkeypair -v -keystore sma.keystore -alias sma -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 sma.keystore   # valor de SMA_KEYSTORE_BASE64
```

Proteções do APK: `FLAG_SECURE` (sem capturas de tela nem prévia em "apps recentes"), backup do Android desligado (restaurar o estado das sessões em outro aparelho reutilizaria chaves) e permissão de câmera opcional, só para o QR.

## Estrutura

| Arquivo | Função |
|---|---|
| `src/main.ts` | Telas e rotas (`#/`, `#/chat/<id>`, `#/invite`, `#/add`, `#/contact/<id>`, `#/settings`) |
| `src/messenger.ts` | Núcleo: sessões, contatos, mensagens, fila de envio, recibos, convites |
| `src/nostr.ts` | Cliente Nostr mínimo (NIP-01, NIP-40), pool de relays com reconexão |
| `src/vault.ts` | Cofre cifrado no IndexedDB |
| `src/qr.ts`, `src/dom.ts` | QR (gerar e escanear) e utilitários de DOM sem `innerHTML` |
| `public/` | HTML com CSP estrita, CSS, manifest e ícones |
| `scripts/build.mjs` | Bundle (esbuild) + service worker versionado |
| `test/` | Relay Nostr local e teste ponta a ponta com Playwright |
| `android/` | Projeto Capacitor (gerado por `cap add android`, com ícones, splash e ajustes de segurança) |

## Limitações desta versão

- **Sem notificações em segundo plano.** Sem servidor próprio não há push (FCM). As mensagens chegam quando o app está aberto, e as que chegaram enquanto ele estava fechado são buscadas ao abrir (até 7 dias; os relays apagam após 14).
- Só texto. Arquivos, grupos e chamadas estão especificados em `../docs`, mas ainda não implementados no app.
- Restaurar pela frase recupera a identidade (mesmo número de segurança), mas não os contatos nem as conversas.
- Um aparelho por conta.
