package br.com.gooners.pay.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.gooners.pay.core.Money
import br.com.gooners.pay.core.api.DaySummary
import br.com.gooners.pay.core.api.MethodTotal
import br.com.gooners.pay.core.api.RecentPayment
import br.com.gooners.pay.core.today.Today
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// The building blocks the screens share (docs/06 §6): a card per section, small caps labels,
// figures with tabular digits, status chips whose word carries the meaning, and the day's
// charts in the chart colours of the tokens.

/** A section on its own surface; one primary action at most. */
@Composable
fun SectionCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) = Column(
    modifier.fillMaxWidth()
        .clip(RoundedCornerShape(Radius.Lg))
        .background(semantic.surface)
        .border(1.dp, semantic.border, RoundedCornerShape(Radius.Lg))
        .padding(Space.Lg),
    verticalArrangement = Arrangement.spacedBy(Space.Sm),
    content = content,
)

/** A small caps label over a figure. */
@Composable
fun Overline(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(Locale.forLanguageTag("pt-BR")), style = TypeScale.Overline, color = semantic.textSecondary, modifier = modifier)

/** A card's heading, with an optional link on the right. */
@Composable
fun CardHeader(title: String, trailing: String? = null, onTrailing: (() -> Unit)? = null) =
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).semantics { heading() })
        if (trailing != null) {
            val m = if (onTrailing != null) Modifier.heightIn(min = Tokens.TouchMin).clickable(role = Role.Button, onClick = onTrailing) else Modifier
            Box(m, contentAlignment = Alignment.Center) {
                Text(trailing, style = TypeScale.Label, color = if (onTrailing != null) semantic.infoText else semantic.textSecondary)
            }
        }
    }

/** A key figure: a label, the number, and a line under it. */
@Composable
fun Kpi(label: String, value: String, modifier: Modifier = Modifier, lead: Boolean = false, color: Color = semantic.textPrimary,
    spoken: String? = null, below: @Composable () -> Unit = {}) = Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Overline(label)
    // A figure never truncates: it shrinks to fit its column instead (docs/06 §4).
    val style = (if (lead) TypeScale.Kpi else TypeScale.Title.copy(fontFeatureSettings = "tnum")).copy(color = color)
    BasicText(value, style = style, maxLines = 1, autoSize = TextAutoSize.StepBased(minFontSize = 14.sp, maxFontSize = style.fontSize),
        modifier = Modifier.semantics { contentDescription = "$label: ${spoken ?: value}" })
    below()
}

/** The colour of a chip's tone. */
@Composable
fun toneColor(t: Today.Tone): Color = when (t) {
    Today.Tone.POSITIVE -> semantic.successText
    Today.Tone.ATTENTION -> semantic.attentionText
    Today.Tone.ALERT -> semantic.alertText
    Today.Tone.INFO -> semantic.infoText
    Today.Tone.NEUTRAL -> semantic.textSecondary
}

/** A payment's state: a dot and a word on a raised pill. */
@Composable
fun StatusChip(status: String) {
    val (label, tone) = Today.status(status)
    val c = toneColor(tone)
    Row(Modifier.clip(RoundedCornerShape(Radius.Pill)).background(semantic.surfaceRaised).padding(horizontal = 10.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(c))
        Text(label, style = TypeScale.Caption.copy(fontWeight = TypeScale.Label.fontWeight), color = c)
    }
}

/** A payment method's chart colour (tokens: chart-*). */
@Composable
fun methodColor(method: String): Color = when (Today.chart(method)) {
    "credit" -> semantic.chartCredit
    "debit" -> semantic.chartDebit
    "pix" -> semantic.chartPix
    "crypto" -> semantic.chartCrypto
    else -> semantic.chartOther
}

/** The day's sales per hour as bars; empty hours keep a short baseline so the day's shape reads. */
@Composable
fun HourlyBars(hourly: List<Long>, modifier: Modifier = Modifier) {
    val peak = Today.peakHour(hourly)
    val bar = semantic.actionBorder
    val empty = semantic.border
    val description = if (peak == null) "Sem vendas por hora" else "Vendas por hora; o pico foi às ${peak}h, com ${Money(hourly[peak]).format()}"
    Column(modifier.clearAndSetSemantics { contentDescription = description }) {
        Canvas(Modifier.fillMaxWidth().height(64.dp)) {
            if (hourly.isEmpty()) return@Canvas
            val max = (hourly.maxOrNull() ?: 0L).coerceAtLeast(1L)
            val slot = size.width / hourly.size
            val w = slot * 0.7f
            hourly.forEachIndexed { i, v ->
                val h = if (v > 0) maxOf(3.dp.toPx(), v.toFloat() / max * (size.height - 4.dp.toPx())) else 2.dp.toPx()
                drawRoundRect(if (v > 0) bar else empty, Offset(i * slot + (slot - w) / 2, size.height - h), Size(w, h), CornerRadius(2.dp.toPx()))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = Space.Xs), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("0h", "6h", "12h", "18h", "23h").forEach { Text(it, style = TypeScale.Caption, color = semantic.textSecondary) }
        }
    }
}

/** How customers paid: one bar split by method, then a legend with amounts and shares. */
@Composable
fun MethodMix(parts: List<MethodTotal>, modifier: Modifier = Modifier) {
    val shares = Today.shares(parts.map { it.gross })
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.Sm)) {
        Row(Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(Radius.Pill)).background(semantic.surfaceRaised)
            .clearAndSetSemantics { contentDescription = parts.zip(shares).joinToString(", ") { (p, s) -> "${Today.method(p.method)} $s%" } },
            horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            parts.forEach { p -> Box(Modifier.weight(p.gross.coerceAtLeast(1L).toFloat()).height(12.dp).background(methodColor(p.method))) }
        }
        parts.zip(shares).forEach { (p, s) ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Sm)) {
                Box(Modifier.size(12.dp).clip(RoundedCornerShape(3.dp)).background(methodColor(p.method)))
                Text(Today.method(p.method), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Text(Money(p.gross).format(), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"))
                Text("$s%", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"), color = semantic.textSecondary,
                    modifier = Modifier.width(44.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
            }
        }
    }
}

private val Brt = ZoneId.of("America/Sao_Paulo")
private val HourMinute = DateTimeFormatter.ofPattern("HH:mm")
private val LongDay = DateTimeFormatter.ofPattern("EEEE, d 'de' MMMM", Locale.forLanguageTag("pt-BR"))

/**
 * Today in one card (docs/06 §6): what was sold and what the merchant keeps, against the same
 * weekday last week, the shape of the day, how customers paid and what still waits.
 */
@Composable
fun TodayCard(d: DaySummary) = SectionCard {
    val isToday = d.date == LocalDate.now(Brt).toString()
    val day = runCatching { LocalDate.parse(d.date).format(LongDay) }.getOrDefault(d.date)
    CardHeader(if (isToday) "Hoje" else "Dia", day)
    Kpi("Vendido", Money(d.gross).format(), lead = true, spoken = Money(d.gross).spoken()) {
        val lw = d.lastWeek
        val change = Today.change(lw?.changePct)
        if (lw == null || change == null) {
            Text("Sem vendas no mesmo dia da semana passada", style = TypeScale.Caption, color = semantic.textSecondary)
        } else {
            val pct = lw.changePct ?: 0.0
            val c = when {
                pct > 0 -> semantic.successText
                pct < 0 -> semantic.alertText
                else -> semantic.textSecondary
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Xs)) {
                if (pct != 0.0) Icon(if (pct > 0) AppIcons.Up else AppIcons.Down, null, tint = c, modifier = Modifier.size(16.dp))
                Text(change, style = TypeScale.Label.copy(fontFeatureSettings = "tnum"), color = c)
                Text(Today.versus(lw.date, isToday), style = TypeScale.Caption, color = semantic.textSecondary)
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(top = Space.Sm), horizontalArrangement = Arrangement.spacedBy(Space.Lg)) {
        Kpi("Você recebe", Money(d.net).format(), Modifier.weight(1.4f), color = semantic.successText, spoken = Money(d.net).spoken()) {
            Text(if (d.fees > 0) "${Money(d.fees).format()} de taxas" else "Sem taxas", style = TypeScale.Caption, color = semantic.textSecondary)
        }
        Kpi("Vendas", d.sales.toString(), Modifier.weight(0.8f))
        Kpi("Ticket médio", Money(d.averageTicket).format(), Modifier.weight(1.2f), spoken = Money(d.averageTicket).spoken())
    }
    if (d.sales > 0) {
        Spacer(Modifier.height(Space.Sm))
        Overline("Por hora")
        HourlyBars(d.hourly)
        Spacer(Modifier.height(Space.Sm))
        Overline("Como pagaram")
        MethodMix(d.byMethod)
    } else {
        Text(if (isToday) "Nenhuma venda ainda hoje. A primeira aparece aqui na hora." else "Nenhuma venda neste dia.",
            style = MaterialTheme.typography.bodyMedium, color = semantic.textSecondary)
    }
    if (d.waiting.count > 0) {
        val label = if (d.waiting.count == 1L) "1 cobrança aguardando" else "${d.waiting.count} cobranças aguardando"
        Row(Modifier.fillMaxWidth().padding(top = Space.Sm).clip(RoundedCornerShape(Radius.Md)).background(semantic.surfaceRaised)
            .heightIn(min = Tokens.TouchMin).padding(horizontal = Space.Lg),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Sm)) {
            Icon(AppIcons.Clock, null, tint = semantic.attentionText, modifier = Modifier.size(20.dp))
            Text(label, style = TypeScale.Label, modifier = Modifier.weight(1f))
            Text(Money(d.waiting.amount).format(), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"))
        }
    }
}

/** The day's latest payments with their state. */
@Composable
fun RecentSales(rows: List<RecentPayment>) = SectionCard {
    CardHeader("Últimas vendas")
    rows.forEachIndexed { i, p ->
        if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(semantic.border))
        Row(Modifier.fillMaxWidth().padding(vertical = Space.Xs), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Md)) {
            Box(Modifier.size(36.dp).clip(CircleShape).background(semantic.surfaceRaised), contentAlignment = Alignment.Center) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(methodColor(p.method)))
            }
            Column(Modifier.weight(1f)) {
                Text(p.card ?: Today.method(p.method), style = TypeScale.Label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val at = runCatching { Instant.parse(p.createdAt).atZone(Brt).format(HourMinute) }.getOrDefault("")
                Text(listOfNotNull(at, if (p.card != null) Today.method(p.method) else null).joinToString(" · "), style = TypeScale.Caption, color = semantic.textSecondary)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(Money(p.amount).format(), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"))
                StatusChip(p.status)
            }
        }
    }
}
