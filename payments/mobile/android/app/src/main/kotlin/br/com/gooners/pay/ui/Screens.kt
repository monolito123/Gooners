package br.com.gooners.pay.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.com.gooners.pay.BuildConfig
import br.com.gooners.pay.MainViewModel
import br.com.gooners.pay.Screen
import br.com.gooners.pay.Tab as AppTab
import br.com.gooners.pay.core.Money
import br.com.gooners.pay.core.checkout.CheckoutState
import br.com.gooners.pay.core.nostr.Bech32
import br.com.gooners.pay.core.sandbox.EmvApplication
import br.com.gooners.pay.core.sandbox.SandboxCardReader
import br.com.gooners.pay.core.statements.Statement
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@Composable
fun AppRoot(vm: MainViewModel) {
    val screen by vm.screen.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.dismissMessage()
        }
    }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth()) else Spacer(Modifier.height(4.dp))
            when (val s = screen) {
                Screen.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                Screen.Setup -> SetupScreen(vm, busy)
                is Screen.Backup -> BackupScreen(s.nsec, busy, vm::backedUp)
                is Screen.AwaitingApproval -> AwaitingApprovalScreen(s, busy, vm::checkApproval, vm::unpair)
                Screen.Home -> HomeScreen(vm)
            }
        }
    }
}

@Composable
private fun Page(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) { content() }
}

@Composable
private fun Title(text: String) = Text(text, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)

@Composable
private fun Hint(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) =
    Button(onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.TouchMin)) { Text(text) }

// ---- pairing ----

@Composable
private fun SetupScreen(vm: MainViewModel, busy: Boolean) = Page {
    var url by rememberSaveable { mutableStateOf(BuildConfig.DEFAULT_API_URL) }
    var code by rememberSaveable { mutableStateOf("") }
    var cardKey by rememberSaveable { mutableStateOf("") }
    Title("Parear este aparelho")
    Hint("Peça ao seu parceiro (ou ao dono da loja, no app dele) um código de pareamento. Ele vale 15 minutos e só pode ser usado uma vez.")
    if (vm.needsScreenLock) {
        Text("Este aparelho não tem bloqueio de tela. Configure um PIN, padrão ou biometria para proteger as chaves.", color = MaterialTheme.colorScheme.error)
    }
    OutlinedTextField(code, { code = it.uppercase() }, label = { Text("Código de pareamento") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(url, { url = it }, label = { Text("Endereço da plataforma") }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
    if (BuildConfig.DEBUG) {
        OutlinedTextField(cardKey, { cardKey = it }, label = { Text("Chave de cartão do sandbox (opcional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Hint("Com a chave de desenvolvimento do sandbox, o app simula a leitura de cartões de teste.")
    }
    PrimaryButton("Parear", enabled = !busy && code.isNotBlank() && !vm.needsScreenLock) { vm.pair(url, code, cardKey) }
}

@Composable
private fun BackupScreen(nsec: String, busy: Boolean, done: () -> Unit) = Page {
    var confirmed by rememberSaveable { mutableStateOf(false) }
    Title("Guarde a chave da sua loja")
    Hint("Esta é a chave raiz da loja. Só ela autoriza novos aparelhos. Anote no papel e guarde em lugar seguro: quem tiver esta chave controla os aparelhos da loja. Ninguém da goonersPAY vai pedi-la.")
    Card(Modifier.fillMaxWidth()) {
        Text(nsec.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace, fontSize = 18.sp, lineHeight = 28.sp,
            modifier = Modifier.padding(16.dp).semantics { contentDescription = "Chave raiz: " + nsec.toList().joinToString(" ") })
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(confirmed, { confirmed = it })
        Text("Anotei a chave em lugar seguro")
    }
    PrimaryButton("Continuar", enabled = confirmed && !busy, onClick = done)
}

@Composable
private fun AwaitingApprovalScreen(s: Screen.AwaitingApproval, busy: Boolean, check: () -> Unit, cancel: () -> Unit) = Page {
    Title("Autorize este aparelho")
    Hint("No celular do dono da ${s.tradeName}, abra Aparelhos › Adicionar e leia este código. Depois toque em Continuar.")
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { QrCode(s.npub, "Código deste aparelho") }
    Text(s.npub, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
    PrimaryButton("Continuar", enabled = !busy, onClick = check)
    TextButton(cancel, Modifier.fillMaxWidth()) { Text("Cancelar pareamento") }
}

// ---- home ----

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScreen(vm: MainViewModel) {
    val tab by vm.tab.collectAsStateWithLifecycle()
    val tabs = AppTab.entries.filter { it != AppTab.DEVICES || vm.isOwner }
    Column(Modifier.fillMaxSize()) {
        PrimaryTabRow(selectedTabIndex = tabs.indexOf(tab).coerceAtLeast(0)) {
            tabs.forEach { t -> Tab(t == tab, { vm.select(t) }, text = { Text(t.label) }) }
        }
        when (tab) {
            AppTab.CHARGE -> ChargeTab(vm)
            AppTab.MONEY -> MoneyTab(vm)
            AppTab.DEVICES -> DevicesTab(vm)
            AppTab.SETTINGS -> SettingsTab(vm)
        }
    }
}

@Composable
private fun Amount(m: Money) = Text(m.format(), style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Bold,
    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite })

@Composable
private fun ChargeTab(vm: MainViewModel) {
    val state by vm.checkout.state.collectAsStateWithLifecycle()
    val co = vm.checkout
    FillColumn {
        when (val s = state) {
            is CheckoutState.Entering -> {
                Amount(s.amount)
                Spacer(Modifier.weight(1f))
                Keypad(onDigit = co::digit, onBackspace = co::backspace)
                PrimaryButton("Cobrar", enabled = s.amount.centavos > 0, onClick = co::charge)
            }
            is CheckoutState.ChoosingMethod -> {
                Amount(s.amount)
                Hint("Como o cliente vai pagar?")
                vm.sandboxReader?.let { TestCardPicker(it) }
                Spacer(Modifier.weight(1f))
                PrimaryButton("Crédito") { co.card(EmvApplication.CREDIT) }
                PrimaryButton("Débito") { co.card(EmvApplication.DEBIT) }
                PrimaryButton("Pix", onClick = co::pix)
                TextButton(co::back, Modifier.fillMaxWidth()) { Text("Voltar") }
            }
            is CheckoutState.WaitingForCard -> Waiting(s.amount, "Aproxime o cartão", s.readerName)
            is CheckoutState.Authorizing -> Waiting(s.amount, "Autorizando…", null)
            is CheckoutState.PixQr -> {
                Amount(s.amount)
                Hint("Peça ao cliente para ler o QR com o app do banco.")
                QrCode(s.brCode, "QR Code Pix de ${s.amount.format()}")
                Text("Aguardando o pagamento…", modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Spacer(Modifier.weight(1f))
                TextButton(co::back, Modifier.fillMaxWidth()) { Text("Cancelar") }
            }
            is CheckoutState.Approved -> {
                Text("Aprovado", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
                Amount(s.amount)
                Hint(s.method)
                if (s.held) {
                    Text("Valor retido para análise de segurança. Você é avisado quando for liberado.", textAlign = TextAlign.Center)
                } else {
                    s.netAvailable?.let { Text((if (s.instant) "Disponível agora: " else "Você recebe: ") + Money(it).format()) }
                }
                s.claimUrl?.let {
                    Hint("Recibo para o cliente:")
                    QrCode(it, "QR Code do recibo", 180.dp)
                }
                Spacer(Modifier.weight(1f))
                PrimaryButton("Nova venda", onClick = co::nextSale)
            }
            is CheckoutState.Declined -> {
                Text("Não aprovado", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
                Amount(s.amount)
                Text(s.message, textAlign = TextAlign.Center)
                Spacer(Modifier.weight(1f))
                PrimaryButton("Tentar de novo", onClick = co::back)
                TextButton(co::nextSale, Modifier.fillMaxWidth()) { Text("Nova venda") }
            }
        }
    }
}

/** A column that fills the screen (weights push buttons down) and scrolls when the screen is short. */
@Composable
private fun FillColumn(content: @Composable ColumnScope.() -> Unit) = BoxWithConstraints(Modifier.fillMaxSize()) {
    Column(
        Modifier.verticalScroll(rememberScrollState()).heightIn(min = maxHeight).fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        content = content,
    )
}

@Composable
private fun Waiting(amount: Money, title: String, detail: String?) {
    Amount(amount)
    Spacer(Modifier.height(32.dp))
    CircularProgressIndicator(Modifier.size(64.dp))
    Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    detail?.let { Hint(it) }
}

@Composable
private fun TestCardPicker(reader: SandboxCardReader) {
    var card by remember { mutableStateOf(reader.card) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SandboxCardReader.TestCard.entries.forEach { c ->
            FilterChip(card == c, { reader.card = c; card = c }, label = { Text(c.label) })
        }
    }
}

@Composable
private fun Keypad(onDigit: (Int) -> Unit, onBackspace: () -> Unit) {
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("00", "0", "⌫"))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { k ->
                    OutlinedButton(
                        onClick = {
                            when (k) {
                                "⌫" -> onBackspace()
                                "00" -> { onDigit(0); onDigit(0) }
                                else -> onDigit(k.toInt())
                            }
                        },
                        modifier = Modifier.size(width = 96.dp, height = Tokens.KeypadKey)
                            .semantics { contentDescription = if (k == "⌫") "Apagar" else k },
                    ) { Text(k, fontSize = 26.sp) }
                }
            }
        }
    }
}

// ---- receivables and payouts ----

@Composable
private fun MoneyTab(vm: MainViewModel) {
    val m by vm.money.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var amount by rememberSaveable { mutableStateOf("") }
    var keyType by rememberSaveable { mutableStateOf("cpf") }
    var key by rememberSaveable { mutableStateOf("") }
    m.statement?.let { StatementDialog(it, vm::closeStatement) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Spacer(Modifier.height(8.dp))
            val b = m.balance
            Text("Disponível", style = MaterialTheme.typography.labelLarge)
            Text(b?.let { Money(it.available).format() } ?: "—", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
            if (b != null) {
                Hint("A receber: ${Money(b.pending).format()}   Reservado: ${Money(b.reserved).format()}")
                if (b.held > 0) Hint("Retido para análise de segurança: ${Money(b.held).format()}")
                b.pendingByDate.forEach { Hint("${it.date}: ${Money(it.amount).format()}") }
            }
            TextButton(vm::refreshMoney) { Text("Atualizar") }
            HorizontalDivider()
        }
        item {
            Text("Sacar por Pix", style = MaterialTheme.typography.titleMedium)
            val q = m.quote
            if (q == null) {
                OutlinedTextField(amount, { amount = it }, label = { Text("Valor (ex.: 150,00)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("cpf" to "CPF", "cnpj" to "CNPJ", "email" to "E-mail", "phone" to "Telefone", "evp" to "Aleatória").forEach { (v, l) ->
                        FilterChip(keyType == v, { keyType = v }, label = { Text(l) })
                    }
                }
                OutlinedTextField(key, { key = it }, label = { Text("Chave Pix") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                val parsed = Money.parseReais(amount)
                PrimaryButton("Simular saque", enabled = !busy && parsed != null && parsed.centavos > 0 && key.isNotBlank()) {
                    vm.quotePayout(parsed!!, keyType, key)
                }
            } else {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Saque de ${Money(q.amount).format()}")
                        Text("Tarifa: ${Money(q.feeTotal).format()}")
                        Text("Chega na conta: ${Money(q.netToDestination).format()}", fontWeight = FontWeight.SemiBold)
                        Hint("Para ${m.destination?.key.orEmpty()}. Válido até ${q.expiresAt}.")
                    }
                }
                PrimaryButton("Confirmar saque", enabled = !busy, onClick = vm::confirmPayout)
                TextButton(vm::cancelQuote, Modifier.fillMaxWidth()) { Text("Cancelar") }
            }
            m.lastPayout?.let { Text(it) }
            HorizontalDivider()
            Text("Extratos diários", style = MaterialTheme.typography.titleMedium)
            Hint("Assinados pela goonersPAY e conferidos neste aparelho contra a raiz pública do dia.")
            if (m.settlements.isEmpty()) Hint("O extrato de um dia sai depois da 1h do dia seguinte.")
        }
        items(m.settlements) { s ->
            Row(Modifier.fillMaxWidth().clickable { vm.openStatement(s) }.padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(s.date)
                    Hint("${s.transactionCount} vendas")
                }
                Text(Money(s.net).format(), fontWeight = FontWeight.SemiBold)
            }
        }
        item {
            HorizontalDivider()
            Text("Movimentações", style = MaterialTheme.typography.titleMedium)
        }
        items(m.entries) { e ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(e.type.replace('_', ' '))
                    Hint(e.postedAt.take(16).replace('T', ' '))
                }
                val sign = if (e.direction == "credit") "+" else "−"
                Text(sign + Money(e.amount).format(), color = if (e.direction == "credit") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/** A day's statement and what the phone checked about it (docs/03 §6.5). */
@Composable
private fun StatementDialog(s: Statement, onClose: () -> Unit) {
    val c = s.check
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClose) { Text("Fechar") } },
        title = { Text("Extrato de ${s.date}") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                item {
                    Text(if (c.ok) "Conferido: este extrato está na raiz pública do dia." else "Não conferiu. Não use este extrato e fale com o suporte.",
                        color = if (c.ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
                    listOf(
                        "Assinado pela goonersPAY" to c.statementSigned,
                        "É desta loja" to c.forThisMerchant,
                        "Totais batem com as vendas" to c.totalsAddUp,
                        "Resumo (hash) confere" to c.commitmentMatches,
                        "Raiz pública do dia assinada" to c.rootSigned,
                        "Incluído na raiz pública" to c.inPublicRoot,
                    ).forEach { (label, ok) -> Text((if (ok) "✓ " else "✗ ") + label, color = if (ok) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error) }
                    HorizontalDivider()
                    Text("Bruto: ${Money(s.gross).format()}")
                    Text("Tarifas: ${Money(s.fees).format()}")
                    if (s.refunds > 0) Text("Estornos: ${Money(s.refunds).format()}")
                    if (s.chargebacks > 0) Text("Contestações: ${Money(s.chargebacks).format()}")
                    Text("Líquido: ${Money(s.net).format()}", fontWeight = FontWeight.SemiBold)
                    HorizontalDivider()
                }
                items(s.lines) { l ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(Money(l.amount).format())
                        Hint("tarifa ${Money(l.fee).format()}")
                    }
                }
            }
        },
    )
}

// ---- devices (owner) ----

@Composable
private fun DevicesTab(vm: MainViewModel) {
    val devices by vm.devices.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var npub by rememberSaveable { mutableStateOf("") }
    var label by rememberSaveable { mutableStateOf("") }
    var platform by rememberSaveable { mutableStateOf("android") }
    Page {
        Title("Aparelhos autorizados")
        Hint("A chave raiz da loja assina esta lista. Quem sai da lista perde o acesso na hora.")
        val own = vm.ownNpub
        devices.forEach { d ->
            val dn = Bech32.npub(d.pubkeyHex)
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(d.label + if (dn == own) " (este aparelho)" else "")
                        Hint("${d.platform} · ${dn.take(16)}…")
                    }
                    if (dn != own) TextButton({ vm.removeDevice(d.pubkeyHex) }, enabled = !busy) { Text("Remover") }
                }
            }
        }
        HorizontalDivider()
        Text("Adicionar aparelho", style = MaterialTheme.typography.titleMedium)
        Hint("No novo aparelho, use um código de pareamento. Ele mostra um código npub: leia-o com a câmera ou cole-o aqui.")
        OutlinedButton(vm::newEnrollmentCode, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Gerar código de pareamento") }
        val scan = rememberLauncherForActivityResult(ScanContract()) { result ->
            result.contents?.trim()?.takeIf { it.startsWith("npub1") }?.let { npub = it }
        }
        OutlinedButton({
            scan.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Leia o código do novo aparelho")
                .setBeepEnabled(false).setOrientationLocked(false))
        }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Ler o código do novo aparelho") }
        OutlinedTextField(npub, { npub = it }, label = { Text("Código do aparelho (npub…)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(label, { label = it }, label = { Text("Nome (ex.: Caixa 2)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("android" to "Android", "ios" to "iPhone").forEach { (v, l) -> FilterChip(platform == v, { platform = v }, label = { Text(l) }) }
        }
        PrimaryButton("Autorizar aparelho", enabled = !busy && npub.startsWith("npub1")) {
            vm.addDevice(npub, platform, label)
            npub = ""
            label = ""
        }
    }
}

// ---- settings ----

@Composable
private fun SettingsTab(vm: MainViewModel) = Page {
    var confirm by remember { mutableStateOf(false) }
    Title(vm.settings.tradeName.ifEmpty { "goonersPAY" })
    Hint("Loja ${vm.settings.merchantId}")
    Hint("Aparelho ${vm.settings.deviceId}")
    Hint("Plataforma ${vm.settings.apiUrl}")
    vm.ownNpub?.let { Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) }
    HorizontalDivider()
    if (!confirm) {
        OutlinedButton({ confirm = true }, Modifier.fillMaxWidth()) { Text("Desparear este aparelho") }
    } else {
        Text("As chaves deste aparelho serão apagadas." + if (vm.isOwner) " Sem a chave raiz anotada, você não poderá autorizar novos aparelhos." else "",
            color = MaterialTheme.colorScheme.error)
        Button(vm::unpair, Modifier.fillMaxWidth()) { Text("Apagar chaves e desparear") }
        TextButton({ confirm = false }, Modifier.fillMaxWidth()) { Text("Cancelar") }
    }
    Hint("goonersPAY ${BuildConfig.VERSION_NAME}")
}
