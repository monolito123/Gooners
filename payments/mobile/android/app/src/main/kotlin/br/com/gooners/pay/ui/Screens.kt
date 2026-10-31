package br.com.gooners.pay.ui

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.unit.IntOffset
import br.com.gooners.pay.AssetsState
import br.com.gooners.pay.MoneyState
import br.com.gooners.pay.core.checkout.CheckoutController
import br.com.gooners.pay.core.checkout.PayMethod
import br.com.gooners.pay.core.wording.Wording
import kotlinx.coroutines.delay
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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

private val Glyphs = mapOf(AppTab.CHARGE to "R$", AppTab.MONEY to "≡", AppTab.ASSETS to "◆", AppTab.DEVICES to "▣", AppTab.SETTINGS to "⚙")

@Composable
private fun HomeScreen(vm: MainViewModel) {
    val tab by vm.tab.collectAsStateWithLifecycle()
    val tabs = AppTab.entries.filter { it != AppTab.DEVICES || vm.isOwner }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (tab) {
                AppTab.CHARGE -> ChargeTab(vm)
                AppTab.MONEY -> MoneyTab(vm)
                AppTab.ASSETS -> AssetsTab(vm)
                AppTab.DEVICES -> DevicesTab(vm)
                AppTab.SETTINGS -> SettingsTab(vm)
            }
        }
        // At the bottom, in thumb reach (docs/06 §4).
        NavigationBar {
            tabs.forEach { t ->
                NavigationBarItem(t == tab, { vm.select(t) }, icon = { Text(Glyphs.getValue(t), fontWeight = FontWeight.Bold) }, label = { Text(t.label) })
            }
        }
    }
}

/**
 * The amount: tabular figures so digits do not jump while typing, shrinking to a 32 sp floor
 * instead of truncating, and spoken as words to screen readers (docs/06 §4).
 */
@Composable
private fun Amount(m: Money, modifier: Modifier = Modifier, scale: Float = 1f) = BasicText(
    m.format(),
    style = MaterialTheme.typography.displayMedium.copy(fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum", textAlign = TextAlign.Center,
        color = MaterialTheme.colorScheme.onBackground),
    maxLines = 1,
    autoSize = TextAutoSize.StepBased(minFontSize = 32.sp, maxFontSize = 56.sp),
    modifier = modifier.fillMaxWidth().graphicsLayer { scaleX = scale; scaleY = scale }
        .semantics { contentDescription = m.spoken(); liveRegion = LiveRegionMode.Polite },
)

@Composable
private fun SecondaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) =
    OutlinedButton(onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.CtaHeight)) { Text(text) }

@Composable
private fun ChargeTab(vm: MainViewModel) {
    val state by vm.checkout.state.collectAsStateWithLifecycle()
    val co = vm.checkout
    val view = LocalView.current
    FillColumn {
        when (val s = state) {
            is CheckoutState.Entering -> {
                Amount(s.amount)
                if (s.amount.isZero) QuickAmounts(co::set)
                Spacer(Modifier.weight(1f))
                Keypad(onDigit = co::digit, onBackspace = co::backspace)
                ChargeButton(!s.amount.isZero, s.repeat, onClick = co::charge, onLongClick = co::repeatLast)
            }
            is CheckoutState.ChoosingMethod -> {
                Amount(s.amount)
                Hint("Como o cliente vai pagar?")
                vm.sandboxReader?.let { TestCardPicker(it) }
                Spacer(Modifier.weight(1f))
                var parcelas by remember(s.amount) { mutableIntStateOf(1) }
                if (PayMethod.CREDIT in s.methods) InstallmentPicker(s.amount, parcelas) { parcelas = it }
                // The last method first, under the thumb, and the only filled button (docs/06 §5).
                s.methods.forEachIndexed { i, m ->
                    val label = when (m) {
                        PayMethod.CREDIT -> if (parcelas > 1) "Crédito em ${parcelas}×" else "Crédito"
                        PayMethod.CRYPTO -> "Cripto (USDT)"
                        else -> m.label
                    }
                    if (i == 0) PrimaryButton(label) { co.choose(m, parcelas) } else SecondaryButton(label) { co.choose(m, parcelas) }
                }
                TextButton(co::back, Modifier.fillMaxWidth()) { Text("Voltar") }
            }
            is CheckoutState.WaitingForCard -> {
                Amount(s.amount)
                Spacer(Modifier.height(24.dp))
                TapTarget(vm.feedback.reduceMotion())
                Text("Aproxime o cartão", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Hint(s.readerName)
                Spacer(Modifier.weight(1f))
                TextButton(co::back, Modifier.fillMaxWidth()) { Text("Cancelar") }
            }
            is CheckoutState.Authorizing -> {
                LaunchedEffect(Unit) { vm.feedback.cardDetected(view) }
                Waiting(s.amount, "Autorizando…", "Não remova o cartão ainda.")
            }
            is CheckoutState.PixQr -> {
                Amount(s.amount)
                Hint("Peça ao cliente para ler o QR com o app do banco.")
                QrCode(s.brCode, "QR Code Pix de ${s.amount.spoken()}")
                Text("Aguardando o pagamento. A tela muda sozinha quando cair.", textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Spacer(Modifier.weight(1f))
                TextButton(co::back, Modifier.fillMaxWidth()) { Text("Cancelar") }
            }
            is CheckoutState.CryptoQr -> {
                Amount(s.amount)
                Hint("Peça ao cliente para ler com a carteira dele e enviar exatamente:")
                Text("${s.units.replace('.', ',')} ${s.asset}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                Hint("Na rede ${s.network.replaceFirstChar { it.uppercase() }}. Outra rede ou outro valor não é reconhecido.")
                QrCode(s.uri, "QR Code da cobrança em ${s.asset}")
                s.memo?.let { Text("Memo: $it", fontFamily = FontFamily.Monospace) }
                Countdown(s.expiresAt)
                Text("Aguardando a transferência. Você recebe em reais.", textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Spacer(Modifier.weight(1f))
                if (BuildConfig.DEBUG) SecondaryButton("Simular pagamento (sandbox)") { vm.simulateCrypto(s.intentId) }
                TextButton(co::back, Modifier.fillMaxWidth()) { Text("Cancelar") }
            }
            is CheckoutState.Approved -> ApprovedView(s, co, vm.feedback)
            is CheckoutState.Undoing -> Waiting(s.amount, "Cancelando a venda…", null)
            is CheckoutState.Cancelled -> {
                Text(when { s.done -> "Venda cancelada"; s.sale == null -> "Venda mantida"; else -> "Não foi possível cancelar" }, style = MaterialTheme.typography.headlineMedium,
                    color = if (s.done || s.sale == null) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
                Amount(s.amount)
                Text(s.message, textAlign = TextAlign.Center)
                Spacer(Modifier.weight(1f))
                if (!s.done && s.sale != null) PrimaryButton("Tentar de novo", onClick = co::cancelSale)
                if (s.done) PrimaryButton("Nova venda", onClick = co::nextSale) else TextButton(co::nextSale, Modifier.fillMaxWidth()) { Text("Voltar ao teclado") }
            }
            is CheckoutState.Declined -> DeclinedView(s, co, vm.feedback)
            is CheckoutState.Reviewing -> {
                // Neither approved nor declined: no tone, no red, one calm next step.
                Text("Pagamento em verificação", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Amount(s.amount)
                Text(s.message, textAlign = TextAlign.Center)
                Spacer(Modifier.weight(1f))
                PrimaryButton("Nova venda", onClick = co::nextSale)
            }
        }
    }
}

/** Cobrar: a tap opens the method sheet; a long press repeats the last method, one tap in all. */
@Composable
private fun ChargeButton(enabled: Boolean, repeat: PayMethod?, onClick: () -> Unit, onLongClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(
        color = if (enabled) colors.primary else colors.surfaceVariant,
        contentColor = if (enabled) colors.onPrimary else colors.onSurfaceVariant,
        shape = MaterialTheme.shapes.extraLarge,
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.CtaHeight).combinedClickable(
            enabled = enabled, role = Role.Button, onClickLabel = "Escolher a forma de pagamento",
            onLongClickLabel = repeat?.let { "Cobrar direto no ${it.label}" }, onLongClick = repeat?.let { { onLongClick() } }, onClick = onClick,
        ),
    ) {
        Box(Modifier.padding(16.dp), contentAlignment = Alignment.Center) {
            Text("Cobrar", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
    }
    if (repeat != null && enabled) Hint("Segure Cobrar para ir direto ao ${repeat.label}")
}

/** The amounts a counter types most, one tap each. */
@Composable
private fun QuickAmounts(set: (Money) -> Unit) = Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    listOf(1_000L, 2_000L, 5_000L, 10_000L).forEach { c -> SuggestionChip({ set(Money(c)) }, label = { Text(Money(c).format().removeSuffix(",00")) }) }
}

/** Parcelas: 1× unless the cashier taps another, and only for credit (docs/06 §5). */
@Composable
private fun InstallmentPicker(amount: Money, selected: Int, onSelect: (Int) -> Unit) {
    Text("Parcelas no crédito", style = MaterialTheme.typography.labelLarge, modifier = Modifier.fillMaxWidth())
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(1, 2, 3, 4, 6, 10, 12).forEach { n ->
            val each = Money(amount.centavos / n)
            FilterChip(selected == n, { onSelect(n) }, label = { Text(if (n == 1) "À vista" else "${n}× ${each.format()}") })
        }
    }
}

/** Where to tap the card, pulsing unless the system asks for less motion. */
@Composable
private fun TapTarget(reduceMotion: Boolean) {
    val pulse = rememberInfiniteTransition(label = "tap").animateFloat(1f, 1.12f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "pulse")
    val color = MaterialTheme.colorScheme.primary
    Box(
        Modifier.size(140.dp).graphicsLayer { val k = if (reduceMotion) 1f else pulse.value; scaleX = k; scaleY = k }
            .border(4.dp, color, CircleShape).semantics { contentDescription = "Área do cartão" },
        contentAlignment = Alignment.Center,
    ) { Text("Aproxime\naqui", color = color, textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold) }
}

/** The check draws in 400 ms and the amount scales 1.0 → 1.04 → 1.0 (motion.approve, docs/06 §7). */
@Composable
private fun ColumnScope.ApprovedView(s: CheckoutState.Approved, co: CheckoutController, feedback: Feedback) {
    val view = LocalView.current
    val reduce = remember { feedback.reduceMotion() }
    val draw = remember(s.intentId) { Animatable(if (reduce) 1f else 0f) }
    val bounce = remember(s.intentId) { Animatable(1f) }
    LaunchedEffect(s.intentId) {
        feedback.approved(view)
        if (!reduce) {
            draw.animateTo(1f, tween(400))
            bounce.animateTo(1.04f, tween(120))
            bounce.animateTo(1f, tween(160))
        }
    }
    CheckMark(draw.value)
    Text("Aprovado", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
    Amount(s.amount, scale = bounce.value)
    Hint(s.method)
    if (s.held) {
        Text("Valor retido para análise de segurança. Seu dinheiro está seguro; você é avisado quando for liberado.", textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.tertiary)
    } else {
        s.netAvailable?.let { Text((if (s.instant) "Disponível agora: " else "Você recebe: ") + Money(it).format(), fontWeight = FontWeight.SemiBold) }
    }
    s.claimUrl?.let {
        Hint("Recibo para o cliente. Toque no código para mantê-lo na tela.")
        QrCode(it, "QR Code do recibo", Modifier.clickable(onClickLabel = "Manter na tela") { co.stay() }, 180.dp)
    }
    Spacer(Modifier.weight(1f))
    s.returnsInMillis?.let { ReturnBar(s.intentId, it) }
    PrimaryButton("Nova venda", onClick = co::nextSale)
    TextButton(co::cancelSale, Modifier.fillMaxWidth().heightIn(min = Tokens.TouchMin)) { Text("Cancelar venda", color = MaterialTheme.colorScheme.error) }
}

@Composable
private fun CheckMark(progress: Float) {
    val color = MaterialTheme.colorScheme.primary
    Canvas(Modifier.size(80.dp).semantics { contentDescription = "Aprovado" }) {
        drawCircle(color, style = Stroke(width = 6.dp.toPx()))
        val path = Path().apply {
            moveTo(size.width * 0.28f, size.height * 0.52f)
            lineTo(size.width * 0.44f, size.height * 0.68f)
            lineTo(size.width * 0.74f, size.height * 0.36f)
        }
        val measure = PathMeasure().apply { setPath(path, false) }
        val part = Path()
        measure.getSegment(0f, measure.length * progress, part, true)
        drawPath(part, color, style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** The 4 s before the keypad comes back, drawn so it is never a surprise. */
@Composable
private fun ReturnBar(key: String, millis: Long) {
    val left = remember(key) { Animatable(1f) }
    LaunchedEffect(key, millis) { left.animateTo(0f, tween(millis.toInt(), easing = LinearEasing)) }
    LinearProgressIndicator(progress = { left.value }, modifier = Modifier.fillMaxWidth())
    Hint("Volta para o teclado sozinho")
}

/** Declined: the amount shakes 2 dp once, a double pulse, one low note (docs/06 §7). */
@Composable
private fun ColumnScope.DeclinedView(s: CheckoutState.Declined, co: CheckoutController, feedback: Feedback) {
    val view = LocalView.current
    val shake = remember(s) { Animatable(0f) }
    LaunchedEffect(s) {
        feedback.declined(view)
        if (!feedback.reduceMotion()) listOf(2f, -2f, 2f, 0f).forEach { shake.animateTo(it, tween(50)) }
    }
    Text("Não aprovado", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.error,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
    Amount(s.amount, modifier = Modifier.offset { IntOffset(shake.value.dp.roundToPx(), 0) })
    Text(s.message, textAlign = TextAlign.Center)
    Spacer(Modifier.weight(1f))
    PrimaryButton("Tentar de novo", onClick = co::back)
    TextButton(co::nextSale, Modifier.fillMaxWidth()) { Text("Nova venda") }
}

@Composable
private fun Countdown(expiresAt: String) {
    val end = remember(expiresAt) { runCatching { Instant.parse(expiresAt).toEpochMilli() }.getOrNull() } ?: return
    var left by remember(end) { mutableLongStateOf(end - System.currentTimeMillis()) }
    LaunchedEffect(end) {
        while (left > 0) {
            delay(1_000)
            left = end - System.currentTimeMillis()
        }
    }
    val sec = (left / 1000).coerceAtLeast(0)
    Hint(if (sec > 0) "Vale por %d:%02d".format(sec / 60, sec % 60) else "Expirou: peça outra")
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

// ---- money ----

private val Brasilia = ZoneId.of("America/Sao_Paulo")

@Composable
private fun SectionTitle(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
    modifier = Modifier.padding(top = 8.dp).semantics { heading() })

@Composable
private fun MoneyTab(vm: MainViewModel) {
    val m by vm.money.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var payout by rememberSaveable { mutableStateOf(false) }
    val today = LocalDate.now(Brasilia)
    m.statement?.let { StatementDialog(it, vm::closeStatement) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Spacer(Modifier.height(8.dp))
            val b = m.balance
            // One number first (docs/06 §6).
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Disponível agora", style = MaterialTheme.typography.labelLarge)
                    Text(b?.let { Money(it.available).format() } ?: "—", style = MaterialTheme.typography.displaySmall.copy(fontFeatureSettings = "tnum"),
                        fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.semantics { b?.let { contentDescription = "Disponível agora: " + Money(it.available).spoken() } })
                    if (!payout && m.quote == null) PrimaryButton("Sacar por Pix", enabled = (b?.available ?: 0) > 0) { payout = true }
                }
            }
        }
        if (payout || m.quote != null) item { PayoutCard(vm, m, busy) { payout = false } }
        item {
            val b = m.balance ?: return@item
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("A receber", style = MaterialTheme.typography.labelLarge)
                    Text(Money(b.pending).format(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    // Time, not jargon: "amanhã", "28/11", never "D+30".
                    b.pendingByDate.take(6).forEach {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(Wording.day(it.date, today).replaceFirstChar { c -> c.uppercase() })
                            Text(Money(it.amount).format())
                        }
                    }
                    if (b.pendingByDate.isEmpty()) Hint("Nada a receber por enquanto.")
                    if (b.held > 0) Text("Retido para análise: ${Money(b.held).format()}. Seu dinheiro está seguro; avisamos quando for liberado.",
                        color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodyMedium)
                    if (b.reserved > 0) Hint("Reserva de garantia: ${Money(b.reserved).format()}")
                }
            }
            TextButton(vm::refreshMoney) { Text("Atualizar") }
        }
        item {
            SectionTitle("Extratos diários")
            Hint("Assinados pela goonersPAY e conferidos neste aparelho contra a raiz pública do dia.")
            if (m.settlements.isEmpty()) Hint("O extrato de um dia sai depois da 1h do dia seguinte.")
        }
        items(m.settlements) { s ->
            Row(Modifier.fillMaxWidth().heightIn(min = Tokens.TouchMin).clickable(onClickLabel = "Conferir o extrato") { vm.openStatement(s) }.padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(Wording.day(s.date, today).replaceFirstChar { it.uppercase() })
                    Hint("${s.transactionCount} vendas · conferir ›")
                }
                Text(Money(s.net).format(), fontWeight = FontWeight.SemiBold)
            }
        }
        item { SectionTitle("Movimentações") }
        items(m.entries) { e ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(Wording.entry(e.type))
                    Hint(Wording.day(e.postedAt, today) + " " + e.postedAt.drop(11).take(5))
                }
                val credit = e.direction == "credit"
                Text((if (credit) "+" else "−") + Money(e.amount).format(), color = if (credit) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

/** Prices before commitment: the fee and what arrives, then a biometric confirmation. */
@Composable
private fun PayoutCard(vm: MainViewModel, m: MoneyState, busy: Boolean, close: () -> Unit) {
    var amount by rememberSaveable { mutableStateOf("") }
    var keyType by rememberSaveable { mutableStateOf("cpf") }
    var key by rememberSaveable { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Sacar por Pix", style = MaterialTheme.typography.titleMedium)
            val q = m.quote
            if (q == null) {
                OutlinedTextField(amount, { amount = it }, label = { Text("Valor (ex.: 150,00)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("cpf" to "CPF", "cnpj" to "CNPJ", "email" to "E-mail", "phone" to "Telefone", "evp" to "Aleatória").forEach { (v, l) ->
                        FilterChip(keyType == v, { keyType = v }, label = { Text(l) })
                    }
                }
                OutlinedTextField(key, { key = it }, label = { Text("Chave Pix") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                val parsed = Money.parseReais(amount)
                PrimaryButton("Ver tarifa e valor final", enabled = !busy && parsed != null && parsed.centavos > 0 && key.isNotBlank()) {
                    vm.quotePayout(parsed!!, keyType, key)
                }
                TextButton(close, Modifier.fillMaxWidth()) { Text("Fechar") }
            } else {
                Text("Saque de ${Money(q.amount).format()}")
                Text("Tarifa: ${Money(q.feeTotal).format()}")
                Text("Chega na conta: ${Money(q.netToDestination).format()}", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                Hint("Para ${m.destination?.key.orEmpty()}.")
                Countdown(q.expiresAt)
                PrimaryButton("Confirmar saque", enabled = !busy, onClick = vm::confirmPayout)
                TextButton(vm::cancelQuote, Modifier.fillMaxWidth()) { Text("Desistir") }
            }
            m.lastPayout?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        }
    }
}

// ---- crypto, foreign currency and B3 ----

/** "352453.50" as "R$ 352.453,50"; small prices keep four decimals ("R$ 5,4123"). */
private fun priceText(price: String): String = runCatching {
    val p = BigDecimal(price)
    if (p >= BigDecimal(100)) Money(p.movePointRight(2).setScale(0, RoundingMode.HALF_EVEN).toLong()).format()
    else "R$ " + p.setScale(4, RoundingMode.HALF_EVEN).toPlainString().replace('.', ',')
}.getOrDefault(price)

private fun units(amount: String) = amount.replace('.', ',')

@Composable
private fun AssetsTab(vm: MainViewModel) {
    val a by vm.assets.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val today = LocalDate.now(Brasilia)
    val copy = { label: String, text: String ->
        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(label, text))
        Unit
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Spacer(Modifier.height(8.dp))
            SectionTitle("Cripto")
            val crypto = a.holdings.filter { it.kind == "crypto" }
            if (crypto.isEmpty()) Hint("Sem cripto. Ative \"Aceitar cripto\" em Ajustes para receber em USDT, ou compre abaixo.")
            crypto.forEach { h ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${units(h.amount)} ${h.asset}", fontWeight = FontWeight.SemiBold)
                    Hint(h.valueBrl?.let { "≈ " + Money(it).format() } ?: "sem cotação")
                }
            }
        }
        item { ConvertCard(vm, a, busy) }
        item {
            SectionTitle("Contas internacionais")
            Hint("Receba de clientes no exterior em dólar, euro ou libra. Converter para reais tem IOF de 0,38%.")
        }
        items(a.accounts) { acc ->
            var open by rememberSaveable(acc.currency) { mutableStateOf(false) }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("Conta em ${acc.currency}", style = MaterialTheme.typography.titleSmall)
                        Text("${units(acc.amount)} ${acc.currency}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    }
                    // Progressive disclosure: the bank details one tap down.
                    TextButton({ open = !open }) { Text(if (open) "Ocultar dados para receber" else "Dados para receber do exterior") }
                    if (open) {
                        val r = acc.receive
                        listOfNotNull("Titular" to r.holder, "Banco" to r.bank, r.iban?.let { "IBAN" to it }, r.bic?.let { "BIC/SWIFT" to it },
                            r.routingNumber?.let { "Routing (ABA)" to it }, r.accountNumber?.let { "Conta" to it }, r.sortCode?.let { "Sort code" to it },
                            "Referência (obrigatória)" to r.reference).forEach { (k, v) ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Hint(k); Text(v, fontFamily = FontFamily.Monospace) }
                        }
                        SecondaryButton("Copiar referência") { copy("Referência", r.reference) }
                    }
                }
            }
        }
        item {
            SectionTitle("Investimentos B3")
            if (a.portfolio.positions.isEmpty()) Hint("Sem posições. Compre ações, FIIs e ETFs pelo console do parceiro.")
        }
        items(a.portfolio.positions) { p ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text("${p.ticker} · ${p.quantity}", fontWeight = FontWeight.SemiBold)
                    Hint(p.name)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(p.value?.let { Money(it).format() } ?: "—")
                    p.result?.let {
                        Text((if (it >= 0) "+" else "") + Money(it).format(), style = MaterialTheme.typography.bodySmall,
                            color = if (it >= 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        items(a.portfolio.orders.filter { it.status != "settled" }) { o ->
            Hint("${if (o.side == "buy") "Compra" else "Venda"} de ${o.quantity} ${o.ticker}: liquida ${Wording.day(o.settlesOn, today)}")
        }
        item {
            TextButton(vm::refreshAssets) { Text("Atualizar") }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/** Buy or sell: the price, fee and IOF before any commitment, valid for the countdown. */
@Composable
private fun ConvertCard(vm: MainViewModel, a: AssetsState, busy: Boolean) {
    var side by rememberSaveable { mutableStateOf("buy") }
    var asset by rememberSaveable { mutableStateOf("USDT") }
    var amount by rememberSaveable { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Comprar ou vender", style = MaterialTheme.typography.titleMedium)
            val q = a.quote
            if (q == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(side == "buy", { side = "buy" }, label = { Text("Comprar com reais") })
                    FilterChip(side == "sell", { side = "sell" }, label = { Text("Vender por reais") })
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("USDT", "USDC", "BTC", "ETH", "USD", "EUR", "GBP").forEach { x -> FilterChip(asset == x, { asset = x }, label = { Text(x) }) }
                }
                OutlinedTextField(amount, { amount = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    label = { Text(if (side == "buy") "Quanto em reais (ex.: 150,00)" else "Quanto em $asset") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                PrimaryButton("Ver cotação", enabled = !busy && amount.isNotBlank()) { vm.quoteConversion(side, asset, amount) }
            } else {
                Text((if (q.side == "buy") "Você recebe " else "Você vende ") + "${units(q.amount)} ${q.asset}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Preço: ${priceText(q.price)} por ${q.asset}")
                Text("Valor: ${Money(q.brlUnits).format()}")
                Text("Tarifa: ${Money(q.fee).format()}")
                if (q.tax > 0) Text("IOF: ${Money(q.tax).format()}")
                Text((if (q.side == "buy") "Sai da conta: " else "Entra na conta: ") + Money(q.total).format(), fontWeight = FontWeight.Bold)
                Countdown(q.expiresAt)
                PrimaryButton("Confirmar", enabled = !busy, onClick = vm::confirmConversion)
                TextButton(vm::cancelConversion, Modifier.fillMaxWidth()) { Text("Desistir") }
            }
            a.done?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
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
    var tone by remember { mutableStateOf(vm.settings.approvalTone) }
    var crypto by remember { mutableStateOf(vm.settings.acceptsCrypto) }
    SwitchRow("Som de aprovação sempre ligado", "Toca mesmo no silencioso: útil num balcão movimentado.", tone) { tone = it; vm.setApprovalTone(it) }
    SwitchRow("Aceitar cripto", "O cliente paga em USDT na rede Tron; você recebe em reais, com tarifa de 1,5%.", crypto) { crypto = it; vm.setAcceptsCrypto(it) }
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

@Composable
private fun SwitchRow(title: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = Tokens.TouchMin).toggleable(checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            Hint(detail)
        }
        Switch(checked, onCheckedChange = null)
    }
}
