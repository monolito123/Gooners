/**
 * SMA web app. Hash routes once unlocked: #/ (chats), #/chat/<fp>, #/invite, #/add,
 * #/contact/<fp>, #/settings. Using real history entries lets the Android back button work.
 */
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { generateRecoveryPhrase, recoveryPhraseToSeed } from '../../reference/src/index.ts';
import { h, icon, formatTime, toast } from './dom.ts';
import { MAX_TEXT, type Message, Messenger, extractInviteCode } from './messenger.ts';
import { DEFAULT_RELAYS } from './nostr.ts';
import { canScanQr, qrCanvas, scanQr } from './qr.ts';
import { Vault, vaultExists } from './vault.ts';

const WEB_URL = 'https://monolito123.github.io/Gooners/messenger/';
// Tells public/boot-check.js that the bundle parsed and started (old WebViews fail before this).
(globalThis as { __smaBooted?: boolean }).__smaBooted = true;
const root = document.getElementById('app')!;
let app: Messenger | null = null;
let pendingInvite = extractInviteCode(location.hash);
// Capacitor's bridge defines window.Capacitor; its WebView origin is https://localhost.
const isNative =
  Boolean((globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) ||
  (location.protocol === 'https:' && location.hostname === 'localhost');

// ─── Onboarding state (before the vault is open) ──────────────────────────────

type Pre =
  | { step: 'welcome' }
  | { step: 'create' }
  | { step: 'phrase'; name: string; phrase: string }
  | { step: 'confirm'; name: string; phrase: string; ask: number[] }
  | { step: 'password'; name: string; phrase: string }
  | { step: 'restore' }
  | { step: 'unlock' }
  | { step: 'busy'; text: string };
let pre: Pre = { step: 'welcome' };

function show(...nodes: Node[]): void {
  root.replaceChildren(...nodes);
}

function screen(title: string, ...body: Node[]): HTMLElement {
  return h('main', { class: 'screen narrow' }, h('div', { class: 'brand' }, icon('shield'), h('span', {}, 'SMA')), h('h1', {}, title), ...body);
}

let fieldSeq = 0;
/** Label bound with for=, hint bound with aria-describedby (so it is not part of the name). */
function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = `f${++fieldSeq}`;
  input.id = id;
  if (hint) input.setAttribute('aria-describedby', `${id}-hint`);
  return h('div', { class: 'field' }, h('label', { htmlFor: id }, label), input, hint ? h('small', { id: `${id}-hint` }, hint) : null);
}

function busy(text: string): void {
  pre = { step: 'busy', text };
  show(screen(text, h('div', { class: 'spinner', role: 'progressbar' }), h('p', { class: 'muted' }, 'Isto leva alguns segundos de propósito: dificulta adivinhar sua senha.')));
}

function errorBox(): HTMLElement {
  return h('p', { class: 'error', role: 'alert' });
}

function renderPre(): void {
  switch (pre.step) {
    case 'welcome':
      return show(
        screen(
          'Mensagens com criptografia pós-quântica',
          h('p', { class: 'lead' }, 'Sem servidor próprio: suas mensagens viajam cifradas por relays Nostr públicos, que só veem blocos opacos.'),
          h('button', { class: 'primary', onclick: () => go({ step: 'create' }) }, 'Criar conta'),
          h('button', { class: 'ghost', onclick: () => go({ step: 'restore' }) }, 'Restaurar com frase de recuperação'),
          h('p', { class: 'warn' }, 'Software experimental, ainda não auditado. Não use para nada em que sua segurança dependa disso.'),
        ),
      );
    case 'create': {
      const name = h('input', { type: 'text', maxLength: 64, placeholder: 'Ex.: Ana', autocomplete: 'nickname' });
      const err = errorBox();
      return show(
        screen(
          'Como você quer aparecer?',
          field('Seu nome', name, 'Só seus contatos veem, dentro de mensagens cifradas.'),
          err,
          h('button', {
            class: 'primary',
            onclick: () => {
              if (!name.value.trim()) return void (err.textContent = 'Digite um nome.');
              go({ step: 'phrase', name: name.value.trim(), phrase: generateRecoveryPhrase() });
            },
          }, 'Continuar'),
          h('button', { class: 'ghost', onclick: () => go({ step: 'welcome' }) }, 'Voltar'),
        ),
      );
    }
    case 'phrase': {
      const p = pre;
      const ok = h('input', { type: 'checkbox' });
      const next = h('button', { class: 'primary', disabled: true, onclick: () => go({ step: 'confirm', name: p.name, phrase: p.phrase, ask: pickThree() }) }, 'Já anotei');
      ok.addEventListener('change', () => (next.disabled = !ok.checked));
      return show(
        screen(
          'Sua frase de recuperação',
          h('p', {}, 'Anote as 24 palavras em papel, na ordem. Elas são a sua conta: com elas você recupera sua identidade em outro aparelho. Ninguém consegue recuperá-las por você.'),
          h('ol', { class: 'words' }, ...p.phrase.split(' ').map((w) => h('li', {}, w))),
          h('label', { class: 'check' }, ok, h('span', {}, 'Anotei em papel e guardei em lugar seguro')),
          next,
        ),
      );
    }
    case 'confirm': {
      const p = pre;
      const words = p.phrase.split(' ');
      const inputs = p.ask.map(() => h('input', { type: 'text', autocapitalize: 'none', autocomplete: 'off', spellcheck: false }));
      const err = errorBox();
      return show(
        screen(
          'Confirme a frase',
          h('p', {}, 'Digite as palavras pedidas para confirmar que você anotou certo.'),
          ...p.ask.map((i, k) => field(`Palavra nº ${i + 1}`, inputs[k]!)),
          err,
          h('button', {
            class: 'primary',
            onclick: () => {
              const good = p.ask.every((i, k) => inputs[k]!.value.trim().toLowerCase() === words[i]);
              if (!good) return void (err.textContent = 'Alguma palavra não confere. Confira sua anotação.');
              go({ step: 'password', name: p.name, phrase: p.phrase });
            },
          }, 'Confirmar'),
          h('button', { class: 'ghost', onclick: () => go({ step: 'phrase', name: p.name, phrase: p.phrase }) }, 'Ver a frase de novo'),
        ),
      );
    }
    case 'password': {
      const p = pre;
      const a = h('input', { type: 'password', autocomplete: 'new-password' });
      const b = h('input', { type: 'password', autocomplete: 'new-password' });
      const err = errorBox();
      return show(
        screen(
          'Senha deste aparelho',
          h('p', {}, 'A senha protege os dados guardados neste aparelho. Se esquecer, use a frase de recuperação.'),
          field('Senha', a, 'Pelo menos 10 caracteres. Uma frase curta funciona bem.'),
          field('Repita a senha', b),
          err,
          h('button', {
            class: 'primary',
            onclick: () => {
              if (a.value.length < 10) return void (err.textContent = 'Use pelo menos 10 caracteres.');
              if (a.value !== b.value) return void (err.textContent = 'As senhas não conferem.');
              void createAccount(p.phrase, p.name, a.value);
            },
          }, 'Criar conta'),
        ),
      );
    }
    case 'restore': {
      const phrase = h('textarea', { rows: 4, autocapitalize: 'none', autocomplete: 'off', spellcheck: false, placeholder: 'palavra1 palavra2 … palavra24' });
      const name = h('input', { type: 'text', maxLength: 64 });
      const a = h('input', { type: 'password', autocomplete: 'new-password' });
      const err = errorBox();
      return show(
        screen(
          'Restaurar conta',
          h('p', { class: 'muted' }, 'A identidade volta igual (mesmo número de segurança). Contatos e conversas antigos não são restaurados nesta versão: seus contatos verão uma nova sessão.'),
          field('Frase de recuperação (24 palavras)', phrase),
          field('Seu nome', name),
          field('Nova senha deste aparelho', a, 'Pelo menos 10 caracteres.'),
          err,
          h('button', {
            class: 'primary',
            onclick: () => {
              try {
                recoveryPhraseToSeed(phrase.value);
              } catch {
                return void (err.textContent = 'Frase inválida: confira as 24 palavras e a ordem.');
              }
              if (a.value.length < 10) return void (err.textContent = 'Use uma senha com pelo menos 10 caracteres.');
              void createAccount(phrase.value, name.value.trim() || 'Eu', a.value);
            },
          }, 'Restaurar'),
          h('button', { class: 'ghost', onclick: () => go({ step: 'welcome' }) }, 'Voltar'),
        ),
      );
    }
    case 'unlock': {
      const pw = h('input', { type: 'password', autocomplete: 'current-password' });
      const err = errorBox();
      const submit = async () => {
        busy('Desbloqueando…');
        try {
          app = await Messenger.unlock(pw.value);
          await enterApp();
        } catch {
          go({ step: 'unlock' });
          (root.querySelector('.error') as HTMLElement).textContent = 'Senha incorreta.';
        }
      };
      const form = h('form', { onsubmit: (e: Event) => (e.preventDefault(), void submit()) }, field('Senha', pw), err, h('button', { class: 'primary', type: 'submit' }, 'Desbloquear'));
      show(
        screen(
          'Bem-vindo de volta',
          form,
          h('button', {
            class: 'ghost danger',
            onclick: async () => {
              if (!confirm('Apagar a conta deste aparelho? Você só poderá voltar com a frase de recuperação.')) return;
              await Vault.wipe();
              go({ step: 'welcome' });
            },
          }, 'Esqueci a senha / usar outra conta'),
        ),
      );
      pw.focus();
      return;
    }
    case 'busy':
      return busy(pre.text);
  }
}

function go(next: Pre): void {
  pre = next;
  renderPre();
}

function pickThree(): number[] {
  const s = new Set<number>();
  while (s.size < 3) s.add(crypto.getRandomValues(new Uint32Array(1))[0]! % 24);
  return [...s].sort((a, b) => a - b);
}

async function createAccount(phrase: string, name: string, passphrase: string): Promise<void> {
  busy('Criando suas chaves e protegendo o cofre…');
  try {
    app = await Messenger.create(phrase, name, passphrase, DEFAULT_RELAYS);
    await enterApp();
  } catch (e) {
    console.error(e);
    go({ step: 'welcome' });
    toast('Não foi possível criar a conta.');
  }
}

async function enterApp(): Promise<void> {
  const a = app!;
  a.onChange = () => scheduleRender();
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/');
  if (pendingInvite) {
    history.pushState(null, '', '#/add');
  }
  render();
  await a.start();
  render();
}

// ─── Unlocked app ──────────────────────────────────────────────────────────────

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

window.addEventListener('hashchange', () => (app ? render() : undefined));

function render(): void {
  if (!app) return renderPre();
  const [, view, arg] = location.hash.split('/');
  if (view === 'chat' && arg && app.contact(arg)) return renderChat(arg);
  if (view === 'contact' && arg && app.contact(arg)) return renderContact(arg);
  if (view === 'invite') return renderInvite();
  if (view === 'add') return renderAdd();
  if (view === 'settings') return renderSettings();
  renderChats();
}

function topbar(title: Node | string, opts: { back?: boolean; actions?: Node[] } = {}): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    opts.back ? h('button', { class: 'iconbtn', 'aria-label': 'Voltar', onclick: () => history.back() }, icon('back')) : null,
    h('div', { class: 'title' }, title),
    ...(opts.actions ?? []),
  );
}

function relayDot(): HTMLElement {
  const st = app!.relayStatus();
  const up = st.filter((r) => r.connected).length;
  return h('span', { class: `dot ${up ? 'on' : 'off'}`, title: `${up}/${st.length} relays conectados` }, `${up}/${st.length}`);
}

function avatar(name: string): HTMLElement {
  return h('span', { class: 'avatar', 'aria-hidden': 'true' }, [...(name.trim() || '?')][0]!.toUpperCase());
}

function renderChats(): void {
  const a = app!;
  const list = a.contacts();
  const items = list.map((c) => {
    const msgs = a.messages(c.fp).filter((m) => m.dir !== 'system');
    const last = msgs[msgs.length - 1];
    return h(
      'a',
      { class: 'row', href: `#/chat/${c.fp}` },
      avatar(c.name),
      h('div', { class: 'rowmain' }, h('div', { class: 'rowtop' }, h('strong', {}, c.name), c.verified ? icon('check') : null, h('time', {}, last ? formatTime(last.ts) : '')), h('div', { class: 'preview' }, last ? `${last.dir === 'out' ? 'Você: ' : ''}${last.text}` : 'Sem mensagens ainda')),
      c.unread ? h('span', { class: 'badge' }, String(c.unread)) : null,
    );
  });
  document.title = list.some((c) => c.unread) ? `(${list.reduce((n, c) => n + c.unread, 0)}) SMA` : 'SMA';
  show(
    h(
      'div',
      { class: 'shell' },
      topbar(h('span', {}, 'Conversas'), {
        actions: [relayDot(), h('button', { class: 'iconbtn', 'aria-label': 'Configurações', onclick: () => (location.hash = '#/settings') }, icon('gear'))],
      }),
      h(
        'main',
        { class: 'list' },
        ...(items.length
          ? items
          : [h('div', { class: 'empty' }, h('p', {}, 'Nenhuma conversa ainda.'), h('p', { class: 'muted' }, 'Toque em "Convidar" para mostrar seu QR ou copiar seu link. Toque em "Adicionar" para usar o convite de alguém.'))]),
      ),
      h(
        'nav',
        { class: 'actions' },
        h('a', { class: 'button', href: '#/invite' }, icon('qr'), 'Convidar'),
        h('a', { class: 'button primary', href: '#/add' }, icon('plus'), 'Adicionar'),
      ),
    ),
  );
}

function statusMark(m: Message): string {
  return { pending: '🕓', sent: '✓', delivered: '✓✓', failed: '⚠' }[m.status];
}

let composerDraft = new Map<string, string>();

function renderChat(fp: string): void {
  const a = app!;
  const c = a.contact(fp)!;
  a.markRead(fp);
  const prevList = root.querySelector('.messages');
  const stick = !prevList || prevList.scrollHeight - prevList.scrollTop - prevList.clientHeight < 80;
  const prevInput = root.querySelector<HTMLTextAreaElement>('textarea.composer');
  if (prevInput && prevInput.dataset.fp === fp) composerDraft.set(fp, prevInput.value);
  const hadFocus = document.activeElement === prevInput;

  const msgs = a.messages(fp).map((m) =>
    m.dir === 'system'
      ? h('div', { class: 'sys' }, m.text)
      : h('div', { class: `msg ${m.dir}` }, h('p', {}, m.text), h('span', { class: 'meta' }, formatTime(m.ts), m.dir === 'out' ? ` ${statusMark(m)}` : '')),
  );
  const list = h('section', { class: 'messages', 'aria-live': 'polite' }, ...msgs);
  const input = h('textarea', { class: 'composer', rows: 1, maxLength: MAX_TEXT, placeholder: 'Mensagem', dataset: { fp }, value: composerDraft.get(fp) ?? '' });
  const send = () => {
    try {
      a.sendText(fp, input.value);
      input.value = '';
      composerDraft.set(fp, '');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isNative) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', () => composerDraft.set(fp, input.value));
  show(
    h(
      'div',
      { class: 'shell chat' },
      topbar(h('a', { class: 'chattitle', href: `#/contact/${fp}` }, avatar(c.name), h('span', {}, c.name), c.verified ? icon('check') : h('small', { class: 'unverified' }, 'não verificado')), {
        back: true,
        actions: [h('button', { class: 'iconbtn', 'aria-label': 'Informações do contato', onclick: () => (location.hash = `#/contact/${fp}`) }, icon('info'))],
      }),
      list,
      h('form', { class: 'composerbar', onsubmit: (e: Event) => (e.preventDefault(), send()) }, input, h('button', { class: 'iconbtn send', type: 'submit', 'aria-label': 'Enviar' }, icon('send'))),
    ),
  );
  if (stick) list.scrollTop = list.scrollHeight;
  if (hadFocus || !isNative) input.focus();
}

function renderContact(fp: string): void {
  const a = app!;
  const c = a.contact(fp)!;
  const name = h('input', { type: 'text', value: c.name, maxLength: 64 });
  const groups = a.safetyNumberWith(fp).split(' ');
  show(
    h(
      'div',
      { class: 'shell' },
      topbar('Contato', { back: true }),
      h(
        'main',
        { class: 'screen' },
        field('Nome', name),
        h('button', { onclick: () => (a.renameContact(fp, name.value), toast('Nome salvo.')) }, 'Salvar nome'),
        h('h2', {}, 'Número de segurança'),
        h('p', { class: 'muted' }, 'Compare estes números com os que aparecem no aparelho do seu contato, de preferência pessoalmente ou por chamada. Se forem iguais, ninguém está se passando por ele.'),
        h('div', { class: 'safety' }, ...groups.map((g) => h('span', {}, g))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.verified, onchange: (e: Event) => a.setVerified(fp, (e.target as HTMLInputElement).checked) }), h('span', {}, 'Conferi os números: contato verificado')),
        h('details', {}, h('summary', {}, 'Detalhes técnicos'), h('p', { class: 'mono' }, `Impressão digital: ${fp}`), h('p', { class: 'mono' }, `Relays: ${c.relays.join(', ') || '—'}`)),
        h('button', {
          class: 'danger',
          onclick: () => {
            if (confirm(`Apagar ${c.name} e toda a conversa deste aparelho?`)) {
              a.deleteContact(fp);
              location.hash = '#/';
            }
          },
        }, 'Apagar contato'),
      ),
    ),
  );
}

/** Clipboard API, with the execCommand fallback that Android WebViews still need. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { class: 'offscreen', value: text, readOnly: true });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function inviteLink(): string {
  const base = isNative || location.protocol === 'file:' ? WEB_URL : `${location.origin}${location.pathname}`;
  return `${base}#c=${app!.inviteCode()}`;
}

function renderInvite(): void {
  const link = inviteLink();
  const copy = async () => toast((await copyText(link)) ? 'Link copiado.' : 'Não consegui copiar; selecione o texto e copie manualmente.');
  const share = async () => {
    try {
      // Native share sheet in the APK, Web Share API in browsers.
      await Share.share({ title: 'Meu convite SMA', text: 'Fale comigo no SMA (criptografia pós-quântica):', url: link, dialogTitle: 'Compartilhar convite' });
    } catch {
      /* cancelled or unavailable */
    }
  };
  show(
    h(
      'div',
      { class: 'shell' },
      topbar('Seu convite', { back: true }),
      h(
        'main',
        { class: 'screen center' },
        h('p', {}, 'Peça para a outra pessoa escanear o QR ou abrir o link no SMA.'),
        qrCanvas(link, 280),
        h('p', { class: 'mono linkbox' }, link),
        h('div', { class: 'row-buttons' }, h('button', { onclick: copy }, icon('copy'), 'Copiar link'), isNative || 'share' in navigator ? h('button', { onclick: share }, icon('share'), 'Compartilhar') : null),
        h('p', { class: 'muted' }, 'Quem tiver este convite pode iniciar uma conversa com você. O convite só aponta para seu cartão cifrado nos relays; ninguém sem ele consegue lê-lo.'),
        h('button', { class: 'ghost', onclick: async () => toast((await app!.publishCard()) ? 'Cartão publicado nos relays.' : 'Nenhum relay aceitou o cartão agora.') }, 'Publicar cartão de novo'),
      ),
    ),
  );
}

function renderAdd(): void {
  const input = h('textarea', { rows: 3, placeholder: 'Cole aqui o link de convite', autocapitalize: 'none', spellcheck: false, value: pendingInvite ? `#c=${pendingInvite}` : '' });
  pendingInvite = null;
  const err = errorBox();
  const btn = h('button', { class: 'primary' }, 'Adicionar contato');
  const add = async (text: string) => {
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Buscando cartão nos relays…';
    try {
      const c = await app!.addContactFromInvite(text);
      toast(`${c.name} adicionado.`);
      location.replace(`#/chat/${c.fp}`);
    } catch (e) {
      err.textContent = (e as Error).message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Adicionar contato';
    }
  };
  btn.addEventListener('click', () => void add(input.value));
  const video = h('video', { class: 'scanner', muted: true });
  let abort: AbortController | null = null;
  const scanBtn = canScanQr()
    ? h('button', {
        onclick: async () => {
          if (abort) return abort.abort();
          abort = new AbortController();
          video.classList.add('on');
          try {
            const text = await scanQr(video, abort.signal);
            input.value = text;
            await add(text);
          } catch (e) {
            if ((e as Error).message !== 'cancelled') err.textContent = 'Não foi possível usar a câmera.';
          } finally {
            abort = null;
            video.classList.remove('on');
          }
        },
      }, icon('scan'), 'Escanear QR')
    : null;
  show(h('div', { class: 'shell' }, topbar('Adicionar contato', { back: true }), h('main', { class: 'screen' }, video, scanBtn, field('Link ou código do convite', input), err, btn)));
  if (input.value) void add(input.value);
}

function renderSettings(): void {
  const a = app!;
  const name = h('input', { type: 'text', value: a.name, maxLength: 64 });
  const relays = h('textarea', { rows: 4, value: a.relays.join('\n'), spellcheck: false, autocapitalize: 'none' });
  const err = errorBox();
  show(
    h(
      'div',
      { class: 'shell' },
      topbar('Configurações', { back: true }),
      h(
        'main',
        { class: 'screen' },
        field('Seu nome', name),
        field('Relays Nostr (um por linha)', relays, 'Seus contatos enviam para estes relays. Use pelo menos dois de operadores diferentes.'),
        err,
        h('button', {
          class: 'primary',
          onclick: async () => {
            try {
              await a.setProfile(name.value, relays.value.split(/\s+/).filter(Boolean));
              toast('Salvo. Seu cartão foi republicado.');
            } catch (e) {
              err.textContent = (e as Error).message;
            }
          },
        }, 'Salvar'),
        h('h2', {}, 'Conexões'),
        h('ul', { class: 'relays' }, ...a.relayStatus().map((r) => h('li', {}, h('span', { class: `dot ${r.connected ? 'on' : 'off'}` }), r.url))),
        a.pendingCount() ? h('p', { class: 'muted' }, `${a.pendingCount()} envio(s) aguardando relay.`) : null,
        h('h2', {}, 'Segurança'),
        h('p', { class: 'mono' }, `Sua impressão digital: ${a.fingerprint}`),
        h('p', { class: 'muted' }, 'Criptografia: X-Wing (ML-KEM-768 + X25519), assinaturas Ed25519 + ML-DSA-65, AES-256-GCM, cofre Argon2id. Software experimental, não auditado.'),
        h('button', { onclick: () => (a.lock(), location.reload()) }, icon('lock'), 'Bloquear agora'),
        h('button', {
          class: 'danger',
          onclick: async () => {
            if (!confirm('Apagar todos os dados deste aparelho? Sem a frase de recuperação, a conta será perdida.')) return;
            a.lock();
            await Vault.wipe();
            location.replace(location.pathname);
          },
        }, 'Apagar tudo deste aparelho'),
      ),
    ),
  );
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

/** Android: Back walks the hash history, and on the first screen sends the app to the background. */
function wireNativeShell(): void {
  if (!isNative) return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else void App.minimizeApp();
  }).catch(() => {});
  // Relays may have dropped while in the background: catch up and flush pending sends.
  void App.addListener('resume', () => app?.resume()).catch(() => {});
}

async function boot(): Promise<void> {
  wireNativeShell();
  if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (pendingInvite) history.replaceState(null, '', location.pathname);
  go((await vaultExists()) ? { step: 'unlock' } : { step: 'welcome' });
}

void boot();
